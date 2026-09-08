import { normalizeAppDetail, type AppDetailData } from "@/lib/mobile-apps/detail-data";
import type { MobileAppsChange, JobStatus } from "@/lib/mobile-apps/change-events";

/**
 * The one client-side module behind both Mobile Applications pages.
 *
 * Interface: a snapshot you can subscribe to, plus a handful of intents
 * (open an app, refresh, ask for reports, acknowledge new reviews). Behind it:
 * one shared change stream, a cache that survives navigation and reloads,
 * per-slice request superseding, connection state, revalidation on
 * reconnect/online/visibility, a job-progress fallback poll, and persistence.
 *
 * Framework-free so it is testable through its interface with fake deps.
 */

export type Connection = "idle" | "connecting" | "live" | "reconnecting" | "offline";

export type AppListing = {
  id: string;
  store: string;
  storeAppId: string;
  country: string;
  currentRating: number | null;
  ratingsCount: number | null;
  lastSyncedAt: string | null;
  syncFailed?: boolean;
  reportsStatus?: string | null;
};

export type AppFacts = {
  reviewsLast7d: number;
  negativeLast7d: number;
  lastCheckedAt: string | null;
  latestFetchedAt?: string | null;
  syncFailed: boolean;
  reportsStatus: string | null;
};

export type AppSummary = {
  id: string;
  name: string;
  icon_url: string | null;
  notes: string | null;
  listings: AppListing[];
  facts?: AppFacts;
};

export type JobState = {
  id: string;
  status: JobStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  updatedAt: string;
};

export type AppReports = AppDetailData["reports"];

export type AppEntry = {
  core: AppDetailData | null;
  reports: AppReports | null;
  loadedAt: string | null;
  reportsLoadedAt: string | null;
  loading: boolean;
  loadingReports: boolean;
  refreshing: boolean;
  refreshingReports: boolean;
  job: JobState | null;
  error: string | null;
  coreRev: number;
  reportsRev: number;
  reviewsRev: number;
  /** Reviews announced by change events since the last acknowledgement. */
  newReviews: number;
};

export type ListState = { apps: AppSummary[]; loadedAt: string | null; loading: boolean; error: string | null; negativeThreshold: number };

export type Snapshot = {
  connection: Connection;
  serverTime: string | null;
  list: ListState;
  apps: Record<string, AppEntry>;
};

export type PersistedSnapshot = {
  version: 1;
  savedAt: string;
  list: { apps: AppSummary[]; loadedAt: string | null; negativeThreshold: number } | null;
  apps: Record<string, { core: AppDetailData; reports: AppReports | null; loadedAt: string | null; reportsLoadedAt: string | null }>;
};

export type FetchInit = { method?: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal; timeoutMs?: number };

export type StreamHandlers = {
  onHello(serverTime: string): void;
  onChange(change: MobileAppsChange): void;
  onOpen(): void;
  onError(): void;
};

export type StoreDeps = {
  /** Resolves with the parsed JSON body; rejects with an Error carrying a user-facing message. */
  fetchJson(url: string, init?: FetchInit): Promise<Record<string, unknown>>;
  /** Opens the change stream; returns a closer. */
  openStream(url: string, handlers: StreamHandlers): () => void;
  storage: { read(): PersistedSnapshot | null; write(snapshot: PersistedSnapshot): void };
  now(): number;
  online(): boolean;
  /** Timer seam so tests can drive time. */
  setTimer?(fn: () => void, ms: number): () => void;
};

export type RefreshOutcome = { ok: boolean; error: string | null } | null;

const STREAM_URL = "/api/mobile-apps/stream";
const JOB_POLL_MS = 5_000;
const JOB_QUIET_MS = 10_000;
const SAVE_DEBOUNCE_MS = 250;
const TERMINAL: JobStatus[] = ["success", "partial", "failed", "skipped"];

const emptyEntry = (): AppEntry => ({
  core: null, reports: null, loadedAt: null, reportsLoadedAt: null,
  loading: false, loadingReports: false, refreshing: false, refreshingReports: false,
  job: null, error: null, coreRev: 0, reportsRev: 0, reviewsRev: 0, newReviews: 0,
});

const emptyReports = (): AppReports => ({ installs: [], crashes: [], store_performance: [], traffic_sources: [], files: [], breakdowns: [] });

const message = (error: unknown) => error instanceof Error ? error.message : "The request failed. Try again.";

export function createMobileAppsStore(deps: StoreDeps) {
  const setTimer = deps.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });

  let state: Snapshot = hydrate(deps.storage.read());
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const set = (patch: Partial<Snapshot>) => { state = { ...state, ...patch }; emit(); };
  const setApp = (appId: string, patch: Partial<AppEntry>) => {
    const prev = state.apps[appId] ?? emptyEntry();
    state = { ...state, apps: { ...state.apps, [appId]: { ...prev, ...patch } } };
    emit();
  };
  const entry = (appId: string) => state.apps[appId] ?? emptyEntry();

  // ── Mount bookkeeping: which apps and whether the list are on screen ──
  const mountedApps = new Map<string, number>();
  let listMounted = 0;
  let streamUsers = 0;

  // ── Request discipline: one in-flight controller per app per slice ──
  const inflight = new Map<string, AbortController>();
  const begin = (key: string) => {
    inflight.get(key)?.abort();
    const controller = new AbortController();
    inflight.set(key, controller);
    return controller;
  };
  const isCurrent = (key: string, controller: AbortController) => inflight.get(key) === controller && !controller.signal.aborted;
  const finish = (key: string, controller: AbortController) => { if (inflight.get(key) === controller) inflight.delete(key); };

  const request = async (url: string, init?: FetchInit) => {
    try {
      return await deps.fetchJson(url, init);
    } catch (error) {
      if (!deps.online() && !(init?.signal?.aborted)) set({ connection: "offline" });
      throw error;
    }
  };

  // ── Persistence ──
  let saveTimer: (() => void) | null = null;
  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimer(() => {
      saveTimer = null;
      deps.storage.write(persist(state, new Date(deps.now()).toISOString()));
    }, SAVE_DEBOUNCE_MS);
  };

  // ── Loading ──
  async function loadList(): Promise<void> {
    const key = "list";
    const controller = begin(key);
    set({ list: { ...state.list, loading: true } });
    try {
      const json = await request("/api/mobile-apps", { signal: controller.signal });
      if (!isCurrent(key, controller)) return;
      const apps = Array.isArray(json.apps) ? (json.apps as AppSummary[]) : [];
      const negativeThreshold = typeof json.negativeThreshold === "number" ? json.negativeThreshold : state.list.negativeThreshold;
      set({ list: { apps, loadedAt: typeof json.asOf === "string" ? json.asOf : new Date(deps.now()).toISOString(), loading: false, error: null, negativeThreshold } });
      scheduleSave();
    } catch (error) {
      if (!isCurrent(key, controller)) return;
      set({ list: { ...state.list, loading: false, error: message(error) } });
    } finally {
      finish(key, controller);
    }
  }

  async function loadApp(appId: string, slices: { core?: boolean; reports?: boolean } = { core: true }): Promise<void> {
    const wantCore = slices.core !== false;
    const wantReports = slices.reports === true;
    const include = [wantCore ? "core" : null, wantReports ? "reports" : null].filter(Boolean).join(",");
    const key = `app:${appId}:${include}`;
    const controller = begin(key);
    const before = entry(appId);
    setApp(appId, { ...(wantCore ? { loading: !before.core } : {}), ...(wantReports ? { loadingReports: !before.reports } : {}) });
    try {
      const json = await request(`/api/mobile-apps/${appId}?include=${include}`, { signal: controller.signal });
      if (!isCurrent(key, controller)) return;
      const asOf = typeof json.asOf === "string" ? json.asOf : new Date(deps.now()).toISOString();
      const patch: Partial<AppEntry> = { error: null };
      if (wantCore) {
        const normalized = normalizeAppDetail(json as unknown as AppDetailData);
        const current = entry(appId);
        // Keep the reports slice we already hold unless this response carried one.
        patch.core = { ...normalized, reports: wantReports ? normalized.reports : current.reports ?? emptyReports() };
        patch.loadedAt = asOf;
        patch.loading = false;
        patch.coreRev = current.coreRev + 1;
      }
      if (wantReports) {
        const reports = normalizeAppDetail({ ...(json as unknown as AppDetailData), app: (json.app as AppDetailData["app"]) ?? entry(appId).core?.app ?? { id: appId, name: "", icon_url: null } }).reports;
        const current = entry(appId);
        patch.reports = reports;
        patch.reportsLoadedAt = asOf;
        patch.loadingReports = false;
        patch.reportsRev = current.reportsRev + 1;
        if (!wantCore && current.core) patch.core = { ...current.core, reports };
        if (json.freshness && current.core && !wantCore) patch.core = { ...(patch.core ?? current.core), freshness: json.freshness as AppDetailData["freshness"] };
      }
      setApp(appId, patch);
      if (state.connection === "offline" && deps.online()) set({ connection: streamUsers > 0 ? "reconnecting" : "idle" });
      scheduleSave();
    } catch (error) {
      if (!isCurrent(key, controller)) return;
      setApp(appId, { loading: false, loadingReports: false, error: message(error) });
    } finally {
      finish(key, controller);
    }
  }

  const ensureReports = (appId: string) => {
    const app = entry(appId);
    if (app.reports || app.loadingReports) return Promise.resolve();
    return loadApp(appId, { core: false, reports: true });
  };

  // ── Refresh intents ──
  async function refreshApp(appId: string, opts: { manual: boolean }): Promise<RefreshOutcome> {
    const key = `refresh:${appId}`;
    if (inflight.has(key)) return null;
    const controller = begin(key);
    setApp(appId, { refreshing: true });
    let failure: string | null = null;
    try {
      const json = opts.manual
        ? await request("/api/mobile-apps/sync", { method: "POST", body: { appId, force: true, syncReports: false, syncAppleStorefronts: false }, signal: controller.signal, timeoutMs: 120_000 })
        : await request(`/api/mobile-apps/${appId}/ensure-fresh`, { method: "POST", body: { consistency: "available", includeReports: true, force: false }, signal: controller.signal, timeoutMs: 120_000 });
      if (!isCurrent(key, controller)) return null;
      if (typeof json.jobId === "string") trackJob(appId, json.jobId, "queued");
      const stores = Object.values((json.byStore as Record<string, { failed?: number; error?: string }> | undefined) ?? {});
      if (json.liveFresh === false || stores.some((s) => (s.failed ?? 0) > 0)) {
        failure = stores.find((s) => s.failed)?.error
          || ((json.freshness as { liveReviews?: { error?: string } } | undefined)?.liveReviews?.error)
          || "Some stores could not be refreshed. Showing the last available data.";
      }
    } catch (error) {
      if (controller.signal.aborted) return null;
      failure = message(error);
    } finally {
      finish(key, controller);
    }
    if (controller.signal.aborted) return null;
    // Whatever the outcome, re-read: the server may have stored partial results.
    await loadApp(appId, { core: true });
    setApp(appId, { refreshing: false, reviewsRev: entry(appId).reviewsRev + 1, ...(failure ? { error: failure } : {}) });
    return { ok: !failure, error: failure };
  }

  async function refreshReports(appId: string): Promise<{ ok: boolean; message: string } | null> {
    const key = `reports:${appId}`;
    if (inflight.has(key)) return null;
    const controller = begin(key);
    setApp(appId, { refreshingReports: true });
    try {
      const json = await request("/api/mobile-apps/reports/sync", { method: "POST", body: { appId, store: "google", mode: "incremental", reason: "manual" }, signal: controller.signal });
      if (!isCurrent(key, controller)) return null;
      if (typeof json.jobId === "string") trackJob(appId, json.jobId, (json.status as JobStatus) ?? "queued");
      setApp(appId, { refreshingReports: false, error: null });
      return { ok: true, message: typeof json.message === "string" ? json.message : "Report sync queued." };
    } catch (error) {
      if (controller.signal.aborted) return null;
      setApp(appId, { refreshingReports: false, error: message(error) });
      return null;
    } finally {
      finish(key, controller);
    }
  }

  async function removeApp(appId: string): Promise<void> {
    await request("/api/mobile-apps", { method: "DELETE", body: { id: appId } });
    const apps = { ...state.apps };
    delete apps[appId];
    set({ apps, list: { ...state.list, apps: state.list.apps.filter((a) => a.id !== appId) } });
    scheduleSave();
  }

  // ── Jobs: stream-driven, with a quiet-period poll fallback ──
  const jobTimers = new Map<string, () => void>();
  function trackJob(appId: string, jobId: string, status: JobStatus, extra: Partial<JobState> = {}) {
    const now = new Date(deps.now()).toISOString();
    const prev = entry(appId).job;
    const job: JobState = { ...(prev?.id === jobId ? prev : { id: jobId }), id: jobId, status, updatedAt: now, ...extra };
    const wasTerminal = prev?.id === jobId && TERMINAL.includes(prev.status);
    const freshness = entry(appId).core?.freshness;
    const core = entry(appId).core;
    setApp(appId, {
      job,
      ...(core && !TERMINAL.includes(status)
        ? { core: { ...core, freshness: { ...freshness, googleReports: { latestOfficialMonth: null, latestProcessedMonth: null, checkedAt: null, processedAt: null, ...freshness?.googleReports, status: "refreshing" } } } }
        : {}),
    });
    if (TERMINAL.includes(status)) {
      stopJobPoll(appId);
      if (!wasTerminal) {
        // Terminal: charts and freshness changed. Reload what is held.
        const failure = status === "failed" || status === "partial" ? job.error || "Report sync did not finish successfully. Retry the report refresh." : null;
        void loadApp(appId, { core: true, reports: Boolean(entry(appId).reports) || mountedApps.has(appId) })
          .then(() => { if (failure && !entry(appId).error) setApp(appId, { error: failure }); });
      }
    } else {
      armJobPoll(appId);
    }
  }
  function armJobPoll(appId: string) {
    stopJobPoll(appId);
    jobTimers.set(appId, setTimer(() => { jobTimers.delete(appId); void pollJob(appId); }, state.connection === "live" ? JOB_QUIET_MS : JOB_POLL_MS));
  }
  function stopJobPoll(appId: string) { jobTimers.get(appId)?.(); jobTimers.delete(appId); }
  async function pollJob(appId: string) {
    const job = entry(appId).job;
    if (!job || TERMINAL.includes(job.status)) return;
    try {
      const json = await request(`/api/mobile-apps/reports/status?jobId=${encodeURIComponent(job.id)}`);
      const row = (json.jobs as Array<Record<string, unknown>> | undefined)?.[0];
      if (!row) { trackJob(appId, job.id, "failed", { error: "The report job could not be found." }); return; }
      trackJob(appId, job.id, row.status as JobStatus, {
        startedAt: (row.startedAt as string | null) ?? null, finishedAt: (row.finishedAt as string | null) ?? null, error: (row.errorMessage as string | null) ?? null,
      });
      if (!TERMINAL.includes(row.status as JobStatus)) { stopJobPoll(appId); jobTimers.set(appId, setTimer(() => { jobTimers.delete(appId); void pollJob(appId); }, JOB_POLL_MS)); }
    } catch {
      if (entry(appId).job?.id === job.id) { stopJobPoll(appId); jobTimers.set(appId, setTimer(() => { jobTimers.delete(appId); void pollJob(appId); }, JOB_POLL_MS)); }
    }
  }

  // ── Change routing ──
  function applyChange(change: MobileAppsChange) {
    // A global change (no app id) concerns every app we know about: mounted ones
    // reload now, cached ones learn their reviews moved so they refetch on return.
    const targets = change.appId ? [change.appId] : [...new Set([...mountedApps.keys(), ...Object.keys(state.apps)])];
    switch (change.kind) {
      case "reviews":
      case "listing": {
        for (const appId of targets) {
          if (!mountedApps.has(appId) && !state.apps[appId]) continue;
          const app = entry(appId);
          setApp(appId, { reviewsRev: app.reviewsRev + 1, newReviews: app.newReviews + (change.kind === "reviews" ? change.inserted ?? 1 : 0) });
          if (mountedApps.has(appId)) void loadApp(appId, { core: true });
        }
        if (listMounted > 0) void loadList();
        return;
      }
      case "reports": {
        for (const appId of targets) {
          if (!mountedApps.has(appId)) continue;
          void loadApp(appId, { core: true, reports: Boolean(entry(appId).reports) });
        }
        if (listMounted > 0) void loadList();
        return;
      }
      case "job": {
        if (!change.jobId || !change.jobStatus) return;
        for (const appId of targets) {
          if (!mountedApps.has(appId) && entry(appId).job?.id !== change.jobId) continue;
          trackJob(appId, change.jobId, change.jobStatus);
        }
        if (listMounted > 0 && TERMINAL.includes(change.jobStatus)) void loadList();
        return;
      }
      case "app": {
        if (listMounted > 0) void loadList();
        if (change.appId && mountedApps.has(change.appId)) void loadApp(change.appId, { core: true });
        return;
      }
    }
  }

  // ── Stream and connection ──
  let closeStream: (() => void) | null = null;
  let hadError = false;
  function openStream() {
    if (closeStream) return;
    set({ connection: deps.online() ? "connecting" : "offline" });
    closeStream = deps.openStream(STREAM_URL, {
      onHello: (serverTime) => set({ serverTime, connection: "live" }),
      onOpen: () => {
        const recovering = hadError || state.connection === "offline";
        hadError = false;
        set({ connection: "live" });
        if (recovering) revalidate();
      },
      onChange: (change) => { if (state.connection !== "live") set({ connection: "live" }); applyChange(change); },
      onError: () => { hadError = true; set({ connection: deps.online() ? "reconnecting" : "offline" }); },
    });
  }
  function releaseStream() {
    if (streamUsers > 0 || !closeStream) return;
    closeStream();
    closeStream = null;
    set({ connection: "idle" });
  }

  function revalidate() {
    if (listMounted > 0) void loadList();
    for (const appId of mountedApps.keys()) void loadApp(appId, { core: true, reports: Boolean(entry(appId).reports) });
  }

  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /** Keep the shared stream open while the caller is mounted. */
    connect(): () => void {
      streamUsers += 1;
      openStream();
      return () => { streamUsers = Math.max(0, streamUsers - 1); releaseStream(); };
    },

    /** The list page is on screen: load it and follow app-level changes. */
    openList(): () => void {
      listMounted += 1;
      void loadList();
      return () => { listMounted = Math.max(0, listMounted - 1); };
    },

    /** An app detail is on screen: load its core slice and follow its changes. */
    openApp(appId: string): () => void {
      mountedApps.set(appId, (mountedApps.get(appId) ?? 0) + 1);
      if (!state.apps[appId]) setApp(appId, {});
      void loadApp(appId, { core: true });
      const job = entry(appId).job;
      if (job && !TERMINAL.includes(job.status)) armJobPoll(appId);
      return () => {
        const count = (mountedApps.get(appId) ?? 1) - 1;
        if (count <= 0) { mountedApps.delete(appId); inflight.get(`app:${appId}:core`)?.abort(); stopJobPoll(appId); } else mountedApps.set(appId, count);
      };
    },

    loadList,
    loadApp,
    ensureReports,
    refreshApp,
    refreshReports,
    removeApp,
    revalidate,
    acknowledgeReviews(appId: string) { if (entry(appId).newReviews) setApp(appId, { newReviews: 0 }); },

    /** Window-level signals: online/offline and tab visibility. */
    notifyOnline(online: boolean) {
      if (online) { if (state.connection === "offline") set({ connection: closeStream ? "reconnecting" : "idle" }); revalidate(); }
      else set({ connection: "offline" });
    },
    notifyVisible(hiddenForMs: number) { if (hiddenForMs >= 60_000) revalidate(); },
  };
}

export type MobileAppsStore = ReturnType<typeof createMobileAppsStore>;

// ── Persistence helpers ──

function hydrate(saved: PersistedSnapshot | null): Snapshot {
  const base: Snapshot = { connection: "idle", serverTime: null, list: { apps: [], loadedAt: null, loading: false, error: null, negativeThreshold: 3 }, apps: {} };
  if (!saved || saved.version !== 1) return base;
  const apps: Record<string, AppEntry> = {};
  for (const [id, app] of Object.entries(saved.apps ?? {})) {
    if (!app?.core?.app?.id) continue;
    apps[id] = { ...emptyEntry(), core: { ...app.core, reports: app.reports ?? emptyReports() }, reports: app.reports ?? null, loadedAt: app.loadedAt ?? null, reportsLoadedAt: app.reportsLoadedAt ?? null };
  }
  return {
    ...base,
    list: saved.list ? { apps: saved.list.apps ?? [], loadedAt: saved.list.loadedAt ?? null, loading: false, error: null, negativeThreshold: saved.list.negativeThreshold ?? 3 } : base.list,
    apps,
  };
}

/** Bounded: report series are kept, breakdowns and the file index are not. */
export function persist(state: Snapshot, savedAt: string): PersistedSnapshot {
  const apps: PersistedSnapshot["apps"] = {};
  for (const [id, app] of Object.entries(state.apps)) {
    if (!app.core) continue;
    // The series is stored once, under `reports`; hydrate merges it back into
    // `core`. Breakdowns and the file index are not worth the quota.
    const reports = app.reports ? { ...app.reports, breakdowns: [], files: [] } : null;
    apps[id] = { core: { ...app.core, reports: emptyReports() }, reports, loadedAt: app.loadedAt, reportsLoadedAt: app.reportsLoadedAt };
  }
  return { version: 1, savedAt, list: state.list.loadedAt ? { apps: state.list.apps, loadedAt: state.list.loadedAt, negativeThreshold: state.list.negativeThreshold } : null, apps };
}
