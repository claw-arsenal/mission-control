"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { normalizeAppDetail, type AppDetailData } from "@/lib/mobile-apps/detail-data";

type State = { data: AppDetailData | null; loading: boolean; syncing: boolean; refreshingReports: boolean; error: string | null; refreshKey: number };

function appDetailResource(appId: string) {
  let state: State = { data: null, loading: true, syncing: false, refreshingReports: false, error: null, refreshKey: 0 };
  let active = false;
  let detailRequest: AbortController | null = null;
  let refreshRequest: AbortController | null = null;
  let reportRequest: AbortController | null = null;
  let jobRequest: AbortController | null = null;
  let pendingJobId: string | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<State>) => {
    if (!active) return;
    if (patch.data && pendingJobId) {
      patch.data = { ...patch.data, freshness: { ...patch.data.freshness, googleReports: {
        latestOfficialMonth: null, latestProcessedMonth: null, checkedAt: null, processedAt: null,
        ...patch.data.freshness?.googleReports, status: "refreshing",
      } } };
    }
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request failed. Try again.";

  async function request(url: string, controller: AbortController, body?: unknown) {
    const response = await fetch(url, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(body === undefined ? 30_000 : 120_000)]), cache: "no-store",
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || `Request failed (${response.status}). Try again.`);
    return json;
  }

  async function load() {
    detailRequest?.abort();
    const controller = new AbortController();
    detailRequest = controller;
    update({ loading: true });
    try {
      const json = await request(`/api/mobile-apps/${appId}`, controller);
      if (controller.signal.aborted || detailRequest !== controller) return;
      update({ data: normalizeAppDetail(json), error: null });
    } catch (error) {
      if (!controller.signal.aborted) update({ error: errorMessage(error) });
    } finally {
      if (!controller.signal.aborted && detailRequest === controller) update({ loading: false });
    }
  }

  async function refresh(manual: boolean) {
    if (refreshRequest) return null;
    const controller = new AbortController();
    refreshRequest = controller;
    update({ syncing: true });
    let failure: string | null = null;
    try {
      const json = manual
        ? await request("/api/mobile-apps/sync", controller, { appId, force: true, syncReports: false, syncAppleStorefronts: false })
        : await request(`/api/mobile-apps/${appId}/ensure-fresh`, controller, { consistency: "available", includeReports: true });
      if (controller.signal.aborted) return null;
      if (typeof json.jobId === "string") pendingJobId = json.jobId;
      const failedStores = Object.values(json.byStore ?? {}) as Array<{ failed?: number; error?: string }>;
      if (json.liveFresh === false || failedStores.some(store => (store.failed ?? 0) > 0)) {
        failure = failedStores.find(store => store.failed)?.error || json.freshness?.liveReviews?.error || "Some stores could not be refreshed. Showing the last available data.";
      }
    } catch (error) {
      if (!controller.signal.aborted) failure = errorMessage(error);
    } finally {
      if (!controller.signal.aborted) {
        await load();
        update({ syncing: false, refreshKey: state.refreshKey + 1, ...(failure ? { error: failure } : {}) });
      }
      if (refreshRequest === controller) refreshRequest = null;
    }
    return controller.signal.aborted ? null : { ok: !failure, error: failure };
  }

  async function refreshReports() {
    if (reportRequest) return null;
    const controller = new AbortController();
    reportRequest = controller;
    update({ refreshingReports: true });
    try {
      const json = await request("/api/mobile-apps/reports/sync", controller, { appId, store: "google", mode: "incremental", reason: "manual" });
      if (controller.signal.aborted) return null;
      if (typeof json.jobId === "string") pendingJobId = json.jobId;
      if (state.data) update({ data: { ...state.data, freshness: { ...state.data.freshness, googleReports: { latestOfficialMonth: null, latestProcessedMonth: null, checkedAt: null, processedAt: null, ...state.data.freshness?.googleReports, status: "refreshing" } } } });
      return { ok: true, message: json.message || "Report sync queued." };
    } catch (error) {
      if (!controller.signal.aborted) update({ error: errorMessage(error) });
      return null;
    } finally {
      if (!controller.signal.aborted) update({ refreshingReports: false });
      if (reportRequest === controller) reportRequest = null;
    }
  }

  async function pollReportJob() {
    if (!pendingJobId || jobRequest) return;
    const controller = new AbortController();
    jobRequest = controller;
    try {
      const json = await request(`/api/mobile-apps/reports/status?jobId=${encodeURIComponent(pendingJobId)}`, controller);
      if (controller.signal.aborted) return;
      const job = json.jobs?.[0];
      if (job?.status === "queued" || job?.status === "running") return;
      pendingJobId = null;
      await load();
      update({ refreshKey: state.refreshKey + 1 });
      if (!job || job.status === "failed" || job.status === "partial") {
        update({ error: job?.errorMessage || "Report sync did not finish successfully. Retry the report refresh." });
      }
    } catch (error) {
      if (!controller.signal.aborted) update({ error: errorMessage(error) });
    } finally { if (jobRequest === controller) jobRequest = null; }
  }

  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load, refresh, refreshReports,
    start: () => {
      active = true;
      void load();
      void refresh(false);
      const events = new EventSource("/api/mobile-apps/stream");
      const invalidate = () => { void load(); update({ refreshKey: state.refreshKey + 1 }); };
      events.addEventListener("change", event => {
        try {
          const change = JSON.parse((event as MessageEvent).data || "{}");
          if (!change.appId || change.appId === appId) invalidate();
        } catch { /* Malformed notifications carry no usable invalidation. */ }
      });
      let connected = false;
      events.addEventListener("open", () => { if (connected) invalidate(); connected = true; });
      const poll = setInterval(() => {
        if (pendingJobId) void pollReportJob();
        else if (state.data?.freshness?.googleReports?.status === "refreshing") invalidate();
      }, 5000);
      return () => {
        active = false;
        detailRequest?.abort(); refreshRequest?.abort(); reportRequest?.abort(); jobRequest?.abort();
        refreshRequest = null; reportRequest = null; jobRequest = null;
        events.close(); clearInterval(poll);
      };
    },
  };
}

export function useMobileAppDetail(appId: string, enabled = true) {
  const resource = useMemo(() => appDetailResource(appId), [appId]);
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => enabled ? resource.start() : undefined, [resource, enabled]);
  const refreshNow = useCallback(() => resource.refresh(true), [resource]);
  return { ...state, load: resource.load, refreshNow, refreshGoogleReports: resource.refreshReports };
}
