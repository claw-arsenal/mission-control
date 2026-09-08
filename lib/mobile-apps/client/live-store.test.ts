import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAppsStore, persist, type PersistedSnapshot, type StoreDeps, type StreamHandlers } from "./live-store";
import type { AppDetailData } from "@/lib/mobile-apps/detail-data";

const core = (name: string, extra: Partial<AppDetailData> = {}): Record<string, unknown> => ({
  ok: true, app: { id: "A1", name, icon_url: null }, listings: [], summary: [], trend: [], syncRuns: [], negativeThreshold: 3,
  freshness: { googleReports: { status: "fresh", latestOfficialMonth: "202609", latestProcessedMonth: "202609", checkedAt: null, processedAt: null } },
  asOf: "2026-09-08T10:00:00.000Z", ...extra,
});
const reports = () => ({ installs: [{ date: "2026-09-01", metrics: { daily_device_installs: 5 } }], crashes: [], store_performance: [], traffic_sources: [], files: [{ report: "installs" }], breakdowns: [{ report: "installs", dimension: "country", dimension_value: "nl", date: "2026-09-01", metrics: {} }] });

type Deferred = { promise: Promise<Record<string, unknown>>; resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
function deferred(): Deferred {
  let resolve!: Deferred["resolve"]; let reject!: Deferred["reject"];
  const promise = new Promise<Record<string, unknown>>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(opts: { saved?: PersistedSnapshot | null; online?: boolean } = {}) {
  const calls: Array<{ url: string; init?: Parameters<StoreDeps["fetchJson"]>[1] }> = [];
  let router: (url: string, init?: Parameters<StoreDeps["fetchJson"]>[1]) => Promise<Record<string, unknown>> = async (url) => {
    if (url.startsWith("/api/mobile-apps/A1?")) return url.includes("reports") ? { ...core("App one"), reports: reports() } : core("App one");
    if (url === "/api/mobile-apps") return { ok: true, apps: [{ id: "A1", name: "App one", listings: [], facts: { reviewsLast7d: 1 } }], asOf: "2026-09-08T10:00:00.000Z", negativeThreshold: 3 };
    if (url.includes("reports/status")) return { ok: true, jobs: [{ status: "success" }] };
    return { ok: true };
  };
  let handlers: StreamHandlers | null = null;
  const closed = vi.fn();
  const saved: PersistedSnapshot[] = [];
  let online = opts.online ?? true;
  const deps: StoreDeps = {
    fetchJson: (url, init) => { calls.push({ url, init }); return router(url, init); },
    openStream: (_url, h) => { handlers = h; return closed; },
    storage: { read: () => opts.saved ?? null, write: (s) => { saved.push(s); } },
    now: () => Date.parse("2026-09-08T10:00:00.000Z"),
    online: () => online,
  };
  const store = createMobileAppsStore(deps);
  return {
    store, calls, saved, closed,
    stream: () => handlers!,
    route: (fn: typeof router) => { router = fn; },
    setOnline: (v: boolean) => { online = v; },
    urls: () => calls.map((c) => c.url),
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("hydration and persistence", () => {
  it("starts from the persisted snapshot so pages never skeleton when a cache exists", () => {
    const savedCore = { app: { id: "A1", name: "Cached" }, listings: [], summary: [], trend: [], syncRuns: [], negativeThreshold: 3, reports: reports() } as unknown as AppDetailData;
    const { store } = harness({ saved: { version: 1, savedAt: "x", list: { apps: [{ id: "A1", name: "Cached", icon_url: null, notes: null, listings: [] }], loadedAt: "2026-09-08T09:00:00.000Z", negativeThreshold: 3 }, apps: { A1: { core: savedCore, reports: null, loadedAt: "2026-09-08T09:00:00.000Z", reportsLoadedAt: null } } } });
    const snap = store.snapshot();
    expect(snap.list.apps[0].name).toBe("Cached");
    expect(snap.list.loadedAt).toBe("2026-09-08T09:00:00.000Z");
    expect(snap.apps.A1.core?.app.name).toBe("Cached");
    expect(snap.apps.A1.loadedAt).toBe("2026-09-08T09:00:00.000Z");
    expect(snap.apps.A1.loading).toBe(false);
    expect(snap.connection).toBe("idle");
  });

  it("saves after loads, keeping report series but dropping breakdowns and the file index", async () => {
    const { store, saved } = harness();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    await store.ensureReports("A1");
    await vi.advanceTimersByTimeAsync(300);
    const last = saved.at(-1)!;
    expect(last.apps.A1.core.app.name).toBe("App one");
    expect(last.apps.A1.reports?.installs).toHaveLength(1);
    expect(last.apps.A1.reports?.breakdowns).toEqual([]);
    expect(last.apps.A1.reports?.files).toEqual([]);
  });

  it("persist() ignores apps without a core payload", () => {
    const out = persist({ connection: "idle", serverTime: null, list: { apps: [], loadedAt: null, loading: false, error: null, negativeThreshold: 3 }, apps: { A9: { core: null, reports: null, loadedAt: null, reportsLoadedAt: null, loading: true, loadingReports: false, refreshing: false, refreshingReports: false, job: null, error: null, coreRev: 0, reportsRev: 0, reviewsRev: 0, newReviews: 0 } } }, "t");
    expect(out.apps).toEqual({});
    expect(out.list).toBeNull();
  });
});

describe("loading and superseding", () => {
  it("openApp loads only the core slice; ensureReports fetches reports once", async () => {
    const { store, urls } = harness();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    expect(urls()).toEqual(["/api/mobile-apps/A1?include=core"]);
    expect(store.snapshot().apps.A1.core?.app.name).toBe("App one");
    expect(store.snapshot().apps.A1.reports).toBeNull();
    await store.ensureReports("A1");
    await store.ensureReports("A1");
    expect(urls().filter((u) => u.includes("include=reports"))).toHaveLength(1);
    expect(store.snapshot().apps.A1.reports?.installs).toHaveLength(1);
    expect(store.snapshot().apps.A1.core?.reports.installs).toHaveLength(1);
  });

  it("discards a stale core response that resolves after a newer one", async () => {
    const { store, route } = harness();
    const first = deferred();
    let n = 0;
    route(async () => (++n === 1 ? first.promise : core("new")));
    store.openApp("A1");
    await store.loadApp("A1");
    expect(store.snapshot().apps.A1.core?.app.name).toBe("new");
    first.resolve(core("old"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot().apps.A1.core?.app.name).toBe("new");
  });

  it("keeps cached data and records the error when a load fails", async () => {
    const { store, route } = harness();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    route(async () => { throw new Error("Database unavailable"); });
    await store.loadApp("A1");
    expect(store.snapshot().apps.A1.core?.app.name).toBe("App one");
    expect(store.snapshot().apps.A1.error).toBe("Database unavailable");
    expect(store.snapshot().apps.A1.loading).toBe(false);
  });
});

describe("change routing", () => {
  it("reviews change reloads core only, bumps reviewsRev and counts new reviews", async () => {
    const { store, urls, stream } = harness();
    store.connect();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    await store.ensureReports("A1");
    const before = urls().length;
    stream().onChange({ kind: "reviews", appId: "A1", inserted: 3, at: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls().slice(before)).toEqual(["/api/mobile-apps/A1?include=core"]);
    expect(store.snapshot().apps.A1.reviewsRev).toBe(1);
    expect(store.snapshot().apps.A1.newReviews).toBe(3);
    expect(store.snapshot().apps.A1.reports?.installs).toHaveLength(1);
    store.acknowledgeReviews("A1");
    expect(store.snapshot().apps.A1.newReviews).toBe(0);
  });

  it("reports change reloads the reports slice only when it is held", async () => {
    const { store, urls, stream } = harness();
    store.connect();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    let before = urls().length;
    stream().onChange({ kind: "reports", appId: "A1", listingId: "L1", at: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls().slice(before)).toEqual(["/api/mobile-apps/A1?include=core"]);
    await store.ensureReports("A1");
    before = urls().length;
    stream().onChange({ kind: "reports", appId: "A1", listingId: "L1", at: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls().slice(before)).toEqual(["/api/mobile-apps/A1?include=core,reports"]);
    expect(store.snapshot().apps.A1.reportsRev).toBe(2);
  });

  it("a global change (appId null) touches every mounted app but not unmounted ones", async () => {
    const { store, urls, stream } = harness();
    store.connect();
    const release = store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    release();
    const before = urls().length;
    stream().onChange({ kind: "reviews", appId: null, at: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls().slice(before)).toEqual([]);
    expect(store.snapshot().apps.A1.reviewsRev).toBe(1);
  });

  it("app change reloads the list while the list is open", async () => {
    const { store, urls, stream } = harness();
    store.connect();
    store.openList();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot().list.apps[0].name).toBe("App one");
    const before = urls().length;
    stream().onChange({ kind: "app", appId: "A2", at: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls().slice(before)).toEqual(["/api/mobile-apps"]);
  });
});

describe("jobs", () => {
  it("follows job events and reloads reports when the job ends; polls only after a quiet period", async () => {
    const { store, urls, stream } = harness();
    store.connect();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    await store.ensureReports("A1");
    stream().onHello("t");
    stream().onChange({ kind: "job", appId: "A1", jobId: "J1", jobStatus: "running", at: "t" });
    expect(store.snapshot().apps.A1.job).toMatchObject({ id: "J1", status: "running" });
    expect(store.snapshot().apps.A1.core?.freshness?.googleReports?.status).toBe("refreshing");
    const before = urls().length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(urls().slice(before)).toEqual([]);
    stream().onChange({ kind: "job", appId: "A1", jobId: "J1", jobStatus: "success", at: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls().slice(before)).toEqual(["/api/mobile-apps/A1?include=core,reports"]);
    expect(store.snapshot().apps.A1.job?.status).toBe("success");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(urls().some((u) => u.includes("reports/status"))).toBe(false);
  });

  it("falls back to polling when the stream is quiet and surfaces a failed job", async () => {
    const { store, urls, route, stream } = harness();
    route(async (url) => url.includes("reports/sync") ? { ok: true, jobId: "J2", status: "queued", message: "Report sync queued." }
      : url.includes("reports/status") ? { ok: true, jobs: [{ status: "failed", errorMessage: "Worker unavailable" }] }
      : core("App one"));
    store.connect();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    stream().onHello("t");
    const outcome = await store.refreshReports("A1");
    expect(outcome).toMatchObject({ ok: true });
    expect(store.snapshot().apps.A1.job).toMatchObject({ id: "J2", status: "queued" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(urls().some((u) => u.includes("reports/status?jobId=J2"))).toBe(true);
    expect(store.snapshot().apps.A1.job?.status).toBe("failed");
    expect(store.snapshot().apps.A1.error).toBe("Worker unavailable");
    expect(store.snapshot().apps.A1.core?.app.name).toBe("App one");
  });
});

describe("refresh intents", () => {
  it("manual refresh forces the stores, keeps cached data and reports partial failures", async () => {
    const { store, route, calls } = harness();
    route(async (url) => url.endsWith("/sync") ? { ok: true, byStore: { google: { failed: 1, error: "Google is unavailable" } } } : core("cached"));
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    const outcome = await store.refreshApp("A1", { manual: true });
    expect(outcome).toEqual({ ok: false, error: "Google is unavailable" });
    const sync = calls.find((c) => c.url.endsWith("/sync"));
    expect(sync?.init?.body).toMatchObject({ appId: "A1", force: true, syncReports: false });
    expect(store.snapshot().apps.A1.core?.app.name).toBe("cached");
    expect(store.snapshot().apps.A1.error).toBe("Google is unavailable");
    expect(store.snapshot().apps.A1.refreshing).toBe(false);
    expect(store.snapshot().apps.A1.reviewsRev).toBe(1);
  });

  it("automatic refresh uses ensure-fresh without force", async () => {
    const { store, calls } = harness();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    await store.refreshApp("A1", { manual: false });
    const ensure = calls.find((c) => c.url.endsWith("ensure-fresh"));
    expect(ensure?.init?.body).toMatchObject({ force: false, consistency: "available" });
  });

  it("ignores a second refresh while one is in flight", async () => {
    const { store, route, calls } = harness();
    const pending = deferred();
    route(async (url) => url.endsWith("/sync") ? pending.promise : core("x"));
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    const first = store.refreshApp("A1", { manual: true });
    expect(await store.refreshApp("A1", { manual: true })).toBeNull();
    pending.resolve({ ok: true, byStore: {} });
    expect(await first).toEqual({ ok: true, error: null });
    expect(calls.filter((c) => c.url.endsWith("/sync"))).toHaveLength(1);
  });

  it("removeApp deletes on the server and drops the app from the cache", async () => {
    const { store, calls } = harness();
    store.openList();
    await vi.advanceTimersByTimeAsync(0);
    await store.removeApp("A1");
    expect(calls.at(-1)).toMatchObject({ url: "/api/mobile-apps", init: { method: "DELETE", body: { id: "A1" } } });
    expect(store.snapshot().list.apps).toEqual([]);
    expect(store.snapshot().apps.A1).toBeUndefined();
  });
});

describe("connection", () => {
  it("tracks connecting → live → reconnecting → live and revalidates on recovery", async () => {
    const { store, urls, stream } = harness();
    const release = store.connect();
    expect(store.snapshot().connection).toBe("connecting");
    stream().onOpen();
    expect(store.snapshot().connection).toBe("live");
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    stream().onError();
    expect(store.snapshot().connection).toBe("reconnecting");
    const before = urls().length;
    stream().onOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot().connection).toBe("live");
    expect(urls().slice(before)).toEqual(["/api/mobile-apps/A1?include=core"]);
    release();
  });

  it("goes offline when the browser is offline and a request fails, and revalidates when back online", async () => {
    const { store, route, setOnline, urls, stream } = harness();
    store.connect();
    store.openApp("A1");
    await vi.advanceTimersByTimeAsync(0);
    setOnline(false);
    stream().onError();
    expect(store.snapshot().connection).toBe("offline");
    route(async () => { throw new Error("Failed to fetch"); });
    await store.loadApp("A1");
    expect(store.snapshot().connection).toBe("offline");
    expect(store.snapshot().apps.A1.core?.app.name).toBe("App one");
    setOnline(true);
    route(async () => core("fresh"));
    const before = urls().length;
    store.notifyOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls().slice(before)).toEqual(["/api/mobile-apps/A1?include=core"]);
    expect(store.snapshot().apps.A1.core?.app.name).toBe("fresh");
  });

  it("closes the stream when the last subscriber leaves and revalidates after a long hidden tab", async () => {
    const { store, closed, urls } = harness();
    const a = store.connect();
    const b = store.connect();
    a();
    expect(closed).not.toHaveBeenCalled();
    b();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(store.snapshot().connection).toBe("idle");
    store.openList();
    await vi.advanceTimersByTimeAsync(0);
    const before = urls().length;
    store.notifyVisible(30_000);
    expect(urls().length).toBe(before);
    store.notifyVisible(120_000);
    expect(urls().length).toBe(before + 1);
  });
});
