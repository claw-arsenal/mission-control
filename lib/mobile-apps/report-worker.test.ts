import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));
// Keep the real report-jobs (reap is pure SQL) â€” only sync/rollups are injected.

import {
  acquireWorkerLock,
  claimQueuedJobs,
  finishJob,
  processQueuedJobs,
  runReportSyncJob,
  runReportWorkerTick,
  type WorkerDeps,
} from "@/lib/mobile-apps/report-worker";

/** Router fake that returns rows by query shape and records calls + values. */
function routerSql(opts: { locked?: boolean; claimed?: unknown[] } = {}) {
  const calls: Array<{ q: string; values: unknown[] }> = [];
  const queued = [...(opts.claimed ?? [])];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(" ? ");
    calls.push({ q, values });
    if (/pg_try_advisory_lock/i.test(q)) return Promise.resolve([{ locked: opts.locked ?? true }]);
    if (/update mobile_app_report_sync_jobs/i.test(q) && /set status\s*=\s*'running'/i.test(q))
      return Promise.resolve(queued.splice(0, Number(values[0] ?? 10)));
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import("@/lib/local-db").getSql>;
  return { fn, calls, find: (re: RegExp) => calls.filter((c) => re.test(c.q)) };
}

afterEach(() => vi.clearAllMocks());

describe("worker advisory lock", () => {
  it("acquires and releases on the same reserved connection, including skipped ticks", async () => {
    for (const locked of [true, false]) {
      const { fn: pool, calls: poolCalls } = routerSql();
      const { fn: connection, calls: lockCalls } = routerSql({ locked });
      const release = vi.fn();
      Object.assign(connection, { release });
      pool.reserve = vi.fn(async () => connection) as never;
      const result = await runReportWorkerTick(pool);
      expect(result.skipped).toBe(!locked);
      expect(poolCalls.some(c => /pg_.*advisory/.test(c.q))).toBe(false);
      expect(lockCalls.filter(c => /pg_.*advisory/.test(c.q))).toHaveLength(locked ? 2 : 1);
      expect(release).toHaveBeenCalledOnce();
    }
  });
  it("acquireWorkerLock returns true when the lock is granted", async () => {
    const { fn } = routerSql({ locked: true });
    expect(await acquireWorkerLock(fn as never)).toBe(true);
  });
  it("acquireWorkerLock returns false when another worker holds it", async () => {
    const { fn } = routerSql({ locked: false });
    expect(await acquireWorkerLock(fn as never)).toBe(false);
  });
});

describe("report job lifecycle regressions", () => {
  const job = { id: "j1", mode: "incremental", store: null, mobileAppId: "A1", listingId: null } as const;
  const result = (store: string, status: string, reportsStatus = "success") => ({
    listingId: store === "google" ? "L1" : "L2", store, status, reportsStatus,
    reportWarnings: [], fetched: 1, inserted: 1,
  });
  const dependencies = (results: unknown[]): WorkerDeps => ({
    syncApp: vi.fn(async () => results) as never,
    refreshReportRollups: vi.fn(async () => {}),
    updateFreshness: vi.fn(async () => {}),
  });

  it("finishes the job before checking freshness and notifying readers", async () => {
    const { fn, calls } = routerSql({ claimed: [job] });
    const deps = dependencies([result("google", "success")]);
    let terminalAtFreshness = false;
    deps.updateFreshness = async () => {
      terminalAtFreshness = calls.some(c => /finished_at/.test(c.q) && c.values[0] === "success");
      // Job status may stream, but no data change may be announced before the terminal write.
      expect(calls.some(c => /pg_notify/.test(c.q) && /"kind":"(reports|reviews|listing)"/.test(String(c.values[0])))).toBe(false);
    };
    await processQueuedJobs(fn, deps);
    expect(terminalAtFreshness).toBe(true);
  });

  it("classifies failed reports as failed even when reviews succeed", async () => {
    const { fn } = routerSql();
    const outcome = await runReportSyncJob(fn, job, dependencies([result("google", "success", "failed")]));
    expect(outcome.status).toBe("failed");
  });

  it("classifies one failed listing in a two-store app as partial", async () => {
    const { fn } = routerSql();
    const outcome = await runReportSyncJob(fn, job, dependencies([result("google", "success"), result("apple", "failed")]));
    expect(outcome.status).toBe("partial");
  });

  it("preserves partial report outcomes and skips empty targets", async () => {
    const { fn } = routerSql();
    expect((await runReportSyncJob(fn, job, dependencies([result("google", "success", "partial")]))).status).toBe("partial");
    expect((await runReportSyncJob(fn, job, dependencies([]))).status).toBe("skipped");
  });

  it("does not mark waiting jobs running before the preceding job completes", async () => {
    const { fn, calls } = routerSql({ claimed: [job, { ...job, id: "j2" }] });
    const deps = dependencies([result("google", "success")]);
    await processQueuedJobs(fn, deps);
    const claims = calls.filter(c => /set status\s*=\s*'running'/.test(c.q));
    expect(claims.every(c => c.values[0] === 1)).toBe(true);
    expect(vi.mocked(deps.syncApp)).toHaveBeenCalledTimes(2);
    expect(calls.indexOf(claims[1])).toBeGreaterThan(calls.findIndex(c => c.values.includes("success")));
  });

  it("passes the listing target and bounds heavy listing concurrency", async () => {
    const { fn } = routerSql();
    const deps = dependencies([result("google", "success")]);
    await runReportSyncJob(fn, { ...job, listingId: "L1" }, deps);
    expect(deps.syncApp).toHaveBeenCalledWith("A1", expect.objectContaining({ listingId: "L1", listingConcurrency: 1 }));
  });
});

describe("claimQueuedJobs", () => {
  it("flips queued jobs to running and returns them", async () => {
    const { fn, find } = routerSql({ claimed: [{ id: "j1", mode: "incremental", store: "google", mobileAppId: "A1", listingId: null }] });
    const jobs = await claimQueuedJobs(fn as never);
    expect(jobs).toHaveLength(1);
    const claim = find(/update mobile_app_report_sync_jobs/i)[0]!;
    expect(claim.q).toMatch(/status\s*=\s*'running'/i);
    expect(claim.q).toMatch(/where status\s*=\s*'queued'/i);
  });
});

describe("finishJob", () => {
  it("sets the terminal status and finished_at", async () => {
    const { fn, calls } = routerSql();
    await finishJob(fn as never, "j1", { status: "success" });
    const upd = calls[0]!;
    expect(upd.q).toMatch(/finished_at\s*=\s*now\(\)/i);
    expect(upd.values).toContain("success");
  });
});

describe("processQueuedJobs orchestration", () => {
  it("runs the HEAVY sync path, refreshes rollups, and finishes the job success", async () => {
    const { fn, calls } = routerSql({
      claimed: [{ id: "j1", mode: "incremental", store: "google", mobileAppId: "A1", listingId: null }],
    });
    const syncApp = vi.fn(async () => [
      { listingId: "L1", store: "google", status: "success", reportWarnings: [], fetched: 3, inserted: 1 },
    ]);
    const refreshReportRollups = vi.fn(async () => {});
    const updateFreshness = vi.fn(async () => {});
    const deps: WorkerDeps = { syncApp: syncApp as never, refreshReportRollups, updateFreshness };

    const result = await processQueuedJobs(fn as never, deps);

    expect(result.processed).toBe(1);
    // Heavy flags are ON in the worker (the whole point â€” this is the only caller allowed to).
    expect(syncApp).toHaveBeenCalledTimes(1);
    const opts = (syncApp.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(opts).toMatchObject({ force: true, syncReports: true, syncAppleStorefronts: true });
    // Rollups refreshed + real freshness recomputed for the google listing.
    expect(refreshReportRollups).toHaveBeenCalledWith(fn, "L1");
    expect(updateFreshness).toHaveBeenCalledWith(fn, "L1");
    // Job finished success.
    const finish = calls.find((c) => /update mobile_app_report_sync_jobs/i.test(c.q) && c.values.includes("success"));
    expect(finish, "a success finish update was issued").toBeTruthy();
    // UI notified with typed changes: job running, job terminal, reports per Google listing.
    const published = calls.filter((c) => /pg_notify\('mobile_apps_change'/i.test(c.q)).map((c) => JSON.parse(String(c.values[0])));
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "job", jobId: "j1", jobStatus: "running" }),
      expect.objectContaining({ kind: "job", jobId: "j1", jobStatus: "success" }),
      expect.objectContaining({ kind: "reports", appId: "A1", listingId: "L1" }),
    ]));
  });

  it("backfill jobs re-ingest the FULL history: refreshReports + allReportMonths on", async () => {
    const { fn } = routerSql({
      claimed: [{ id: "j1", mode: "backfill", store: "google", mobileAppId: "A1", listingId: null }],
    });
    const syncApp = vi.fn(async () => [
      { listingId: "L1", store: "google", status: "success", reportWarnings: [], fetched: 0, inserted: 0 },
    ]);
    const deps: WorkerDeps = { syncApp: syncApp as never, refreshReportRollups: vi.fn(async () => {}), updateFreshness: vi.fn(async () => {}) };

    await processQueuedJobs(fn as never, deps);

    const opts = (syncApp.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(opts).toMatchObject({ refreshReports: true, allReportMonths: true });
  });

  it("incremental jobs stay lookback-bounded: refreshReports + allReportMonths off", async () => {
    const { fn } = routerSql({
      claimed: [{ id: "j1", mode: "incremental", store: "google", mobileAppId: "A1", listingId: null }],
    });
    const syncApp = vi.fn(async () => [
      { listingId: "L1", store: "google", status: "success", reportWarnings: [], fetched: 0, inserted: 0 },
    ]);
    const deps: WorkerDeps = { syncApp: syncApp as never, refreshReportRollups: vi.fn(async () => {}), updateFreshness: vi.fn(async () => {}) };

    await processQueuedJobs(fn as never, deps);

    const opts = (syncApp.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(opts).toMatchObject({ refreshReports: false, allReportMonths: false });
  });

  it("marks the job failed when the sync throws, and does not crash the loop", async () => {
    const { fn, calls } = routerSql({
      claimed: [{ id: "j1", mode: "incremental", store: "google", mobileAppId: "A1", listingId: null }],
    });
    const deps: WorkerDeps = {
      syncApp: (async () => {
        throw new Error("boom");
      }) as never,
      refreshReportRollups: vi.fn(async () => {}),
      updateFreshness: vi.fn(async () => {}),
    };
    const result = await processQueuedJobs(fn as never, deps);
    expect(result.processed).toBe(1);
    const finish = calls.find((c) => /update mobile_app_report_sync_jobs/i.test(c.q) && c.values.includes("failed"));
    expect(finish, "a failed finish update was issued").toBeTruthy();
  });
});
