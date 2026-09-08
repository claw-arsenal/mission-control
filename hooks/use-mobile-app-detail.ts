"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useMobileAppsStore } from "@/components/mobile-apps/store-provider";
import type { AppEntry, Connection, RefreshOutcome } from "@/lib/mobile-apps/client/live-store";
import type { AppDetailData } from "@/lib/mobile-apps/detail-data";

const EMPTY_ENTRY: AppEntry = {
  core: null, reports: null, loadedAt: null, reportsLoadedAt: null,
  loading: true, loadingReports: false, refreshing: false, refreshingReports: false,
  job: null, error: null, coreRev: 0, reportsRev: 0, reviewsRev: 0, newReviews: 0,
};

export type MobileAppDetail = {
  data: AppDetailData | null;
  loading: boolean;
  syncing: boolean;
  refreshingReports: boolean;
  loadingReports: boolean;
  reportsLoaded: boolean;
  error: string | null;
  /** Bumps whenever reviews may have changed; the reviews hook fetches a delta. */
  refreshKey: number;
  loadedAt: string | null;
  job: AppEntry["job"];
  newReviews: number;
  connection: Connection;
  load: () => Promise<void>;
  refreshNow: () => Promise<RefreshOutcome>;
  refreshGoogleReports: () => Promise<{ ok: boolean; message: string } | null>;
  ensureReports: () => Promise<void>;
  acknowledgeReviews: () => void;
  removeApp: () => Promise<void>;
};

/**
 * Thin adapter over the shared store for one app. Mounting opens the app
 * (loads its core slice, follows its changes) and asks for a cheap freshness
 * check once; unmounting releases it. Data stays cached across navigations.
 */
export function useMobileAppDetail(appId: string, enabled = true): MobileAppDetail {
  const store = useMobileAppsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const entry = snapshot.apps[appId] ?? EMPTY_ENTRY;

  useEffect(() => {
    if (!enabled) return;
    const releaseStream = store.connect();
    const releaseApp = store.openApp(appId);
    void store.refreshApp(appId, { manual: false });
    return () => { releaseApp(); releaseStream(); };
  }, [store, appId, enabled]);

  const load = useCallback(() => store.loadApp(appId, { core: true, reports: Boolean(store.snapshot().apps[appId]?.reports) }), [store, appId]);
  const refreshNow = useCallback(() => store.refreshApp(appId, { manual: true }), [store, appId]);
  const refreshGoogleReports = useCallback(() => store.refreshReports(appId), [store, appId]);
  const ensureReports = useCallback(() => store.ensureReports(appId), [store, appId]);
  const acknowledgeReviews = useCallback(() => store.acknowledgeReviews(appId), [store, appId]);
  const removeApp = useCallback(() => store.removeApp(appId), [store, appId]);

  const data = useMemo(() => entry.core, [entry.core]);

  return {
    data,
    loading: entry.loading && !entry.core,
    syncing: entry.refreshing,
    refreshingReports: entry.refreshingReports,
    loadingReports: entry.loadingReports,
    reportsLoaded: Boolean(entry.reports),
    error: entry.error,
    refreshKey: entry.reviewsRev,
    loadedAt: entry.loadedAt,
    job: entry.job,
    newReviews: entry.newReviews,
    connection: snapshot.connection,
    load, refreshNow, refreshGoogleReports, ensureReports, acknowledgeReviews, removeApp,
  };
}
