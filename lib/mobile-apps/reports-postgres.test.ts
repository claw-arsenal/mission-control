import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));
vi.mock("./providers", () => ({ getProvider: vi.fn() }));
vi.mock("./config", async original => ({ ...await original<typeof import("./config")>(), loadMobileReviewsConfig: vi.fn() }));
import { getSql } from "@/lib/local-db";
import { getProvider } from "./providers";
import { loadMobileReviewsConfig } from "./config";
import { syncApp } from "./sync";
import { ensureMobileAppsSchema, resetMobileAppsSchemaCache } from "./ensure-schema";
import { enqueueReportSyncJob } from "./report-jobs";
import { acquireWorkerLock, finishJob, releaseWorkerLock, runReportWorkerTick, type WorkerDeps } from "./report-worker";
import { checkOfficialReportFreshness, type FreshnessDeps } from "./report-freshness";
import { ingestReportFiles } from "./report-ingestion";
import { refreshReportRollups } from "./report-rollups";
import { repairMobileAppsJsonStorage } from "./repair-json-storage";
import type { GoogleConfig } from "./config";
import type { ReportFile } from "./providers/google-play-reports";

// Opt in with a disposable PostgreSQL database. Each run owns a unique schema.
const databaseUrl = process.env.MOBILE_REPORTS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("report processing on PostgreSQL", () => {
  const schema = `mobile_reports_test_${randomUUID().replaceAll("-", "")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let appId: string;
  let listingId: string;
  const file: ReportFile = { kind: "installs", dimension: "overview", path: "installs.csv", yyyyMM: "202606", generation: "2", sizeBytes: 20, updated: null };
  const cfg = { reportsMaxFileBytes: 1024, reportsBucket: "fixture" } as GoogleConfig;
  const metadata: FreshnessDeps = {
    loadConfig: () => ({ google: cfg }),
    listReportFiles: async (_cfg, kind) => kind === "installs" ? [file] : [],
    listReviewReportFiles: async () => [],
  };
  const deps: WorkerDeps = {
    syncApp: async () => [{ listingId, store: "google", appIdentifier: "com.fixture", status: "success", reportsStatus: "success", fetched: 0, inserted: 0,
      ratingCaptured: false, skipped: false, error: null, reportWarnings: [], ratingSource: null, ratingAsOf: null,
      ratingSourceLabel: "Unknown", ratingFreshnessLabel: null, ratingSourceHelperText: "Fixture" }],
    refreshReportRollups,
    updateFreshness: async db => { await checkOfficialReportFreshness(db, listingId, metadata); },
  };

  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(databaseUrl!, { max: 6, prepare: false, connection: { search_path: schema }, onnotice: () => {} });
    await sql`create table workspaces (id uuid primary key default gen_random_uuid())`;
    resetMobileAppsSchemaCache();
    await ensureMobileAppsSchema(sql);
    const [workspace] = await sql`insert into workspaces default values returning id`;
    const [app] = await sql`insert into mobile_apps (workspace_id, name) values (${workspace.id}, 'Fixture') returning id`;
    appId = app.id;
    const [listing] = await sql`insert into mobile_app_listings (mobile_app_id, store, store_app_id) values (${appId}, 'google', 'com.fixture') returning id`;
    listingId = listing.id;
  });
  beforeEach(async () => {
    vi.mocked(getSql).mockReturnValue(sql);
    await sql`truncate mobile_app_report_sync_jobs, mobile_app_report_freshness, mobile_app_report_files, mobile_app_report_metrics, mobile_app_report_daily_rollups, mobile_app_report_latest_breakdowns cascade`;
  });
  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin.unsafe(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
    resetMobileAppsSchemaCache();
  });

  async function insertMetric(db: postgres.Sql, value: number, date = "2026-06-01") {
    await db`insert into mobile_app_report_metrics (listing_id, report, dimension, metric_date, report_month, metrics)
      values (${listingId}, 'installs', 'overview', ${date}, '202606', ${JSON.stringify({ installs: value })}::text::jsonb)`;
  }

  it("keeps the advisory lock on one connection and releases it after the tick", async () => {
    const holder = await sql.reserve();
    try {
      expect(await acquireWorkerLock(holder)).toBe(true);
      expect(await runReportWorkerTick(sql, undefined, deps)).toMatchObject({ skipped: true });
    } finally { await releaseWorkerLock(holder); holder.release(); }
    expect(await runReportWorkerTick(sql, undefined, deps)).toMatchObject({ skipped: false, processed: 0 });
    const check = await sql.reserve();
    try { expect(await acquireWorkerLock(check)).toBe(true); }
    finally { await releaseWorkerLock(check); check.release(); }
  });

  it("deduplicates concurrent enqueue requests", async () => {
    const jobs = await Promise.all(Array.from({ length: 8 }, () => enqueueReportSyncJob(sql, { appId, store: "google" })));
    expect(new Set(jobs.map(result => result.job.id)).size).toBe(1);
  });

  it("leaves waiting jobs queued and publishes terminal status before freshness", async () => {
    await enqueueReportSyncJob(sql, { appId, mode: "incremental" });
    await enqueueReportSyncJob(sql, { appId, mode: "backfill" });
    let calls = 0;
    const result = await runReportWorkerTick(sql, undefined, {
      ...deps,
      syncApp: async () => {
        const rows = await sql`select status from mobile_app_report_sync_jobs`;
        expect(rows.filter(row => row.status === "running")).toHaveLength(1);
        if (calls++ === 0) expect(rows.filter(row => row.status === "queued")).toHaveLength(1);
        return deps.syncApp(appId);
      },
      updateFreshness: async () => {
        const running = await sql`select id from mobile_app_report_sync_jobs where status = 'running'`;
        expect(running).toHaveLength(0);
      },
    });
    expect(result.processed).toBe(2);
  });

  it("rolls back a failed file without exposing partial metrics", async () => {
    await insertMetric(sql, 10);
    const result = await ingestReportFiles(sql, listingId, cfg, { files: [file], label: "installs", force: false,
      consume: async db => { await insertMetric(db, 20); throw new Error("interrupted stream"); },
    });
    expect(result.filesFailed).toBe(1);
    const [metric] = await sql`select metrics from mobile_app_report_metrics`;
    expect(metric.metrics).toEqual({ installs: 10 });
    const [record] = await sql`select status, generation from mobile_app_report_files`;
    expect(record).toMatchObject({ status: "failed", generation: "2" });
  });

  it("atomically replaces removed rows, skips cached generations, and rebuilds charts", async () => {
    await insertMetric(sql, 10);
    await insertMetric(sql, 15, "2026-06-02");
    let downloads = 0;
    const input = { files: [file], label: "installs", force: false, consume: async (db: postgres.Sql) => {
      downloads++; await insertMetric(db, 30); return { rows: 1 };
    } };
    await ingestReportFiles(sql, listingId, cfg, input);
    await ingestReportFiles(sql, listingId, cfg, input);
    expect(downloads).toBe(1);
    await refreshReportRollups(sql, listingId);
    const rollups = await sql`select metrics from mobile_app_report_daily_rollups`;
    expect(rollups).toHaveLength(1);
    expect(rollups[0].metrics).toEqual({ installs: 30 });
  });

  it("treats empty parsed files as current and prefers active jobs over newer finished jobs", async () => {
    await ingestReportFiles(sql, listingId, cfg, { files: [file], label: "installs", force: false, consume: async () => ({ rows: 0 }) });
    expect((await checkOfficialReportFreshness(sql, listingId, metadata)).status).toBe("fresh");
    const active = await enqueueReportSyncJob(sql, { appId });
    const done = await enqueueReportSyncJob(sql, { appId, mode: "backfill" });
    await finishJob(sql, done.job.id, { status: "success" });
    const result = await checkOfficialReportFreshness(sql, listingId, metadata);
    expect(result).toMatchObject({ status: "refreshing", activeJobId: active.job.id });
  });

  it("does not call charts fresh when their rebuild failed after successful ingestion", async () => {
    await ingestReportFiles(sql, listingId, cfg, { files: [file], label: "installs", force: false, consume: async () => ({ rows: 0 }) });
    await enqueueReportSyncJob(sql, { appId });
    await runReportWorkerTick(sql, undefined, { ...deps, refreshReportRollups: async () => { throw new Error("rollup unavailable"); } });
    expect(await checkOfficialReportFreshness(sql, listingId, metadata)).toMatchObject({ status: "failed", needsWorker: true });
  });

  it("persists live review payloads and rating histograms as structured JSON through syncApp", async () => {
    vi.mocked(loadMobileReviewsConfig).mockReturnValue({ google: { reportsBucket: null }, sync: { concurrency: 1 } } as never);
    vi.mocked(getProvider).mockReturnValue({ fetchReviews: async () => [{
      storeReviewId: "fixture-review", author: "Operator", rating: 5, title: null, body: "Useful dashboard",
      appVersion: null, country: "nl", submittedAt: "2026-06-01T10:00:00Z", storeResponse: null, raw: { reviewId: "fixture-review" },
    }] });
    const [result] = await syncApp(appId, { force: true, syncReports: false });
    expect(result.status, result.error ?? "sync completes").toBe("success");
    const [review] = await sql`select raw_json from app_reviews where listing_id = ${listingId}`;
    expect(review.raw_json).toEqual({ reviewId: "fixture-review" });
    const [snapshot] = await sql`select histogram from app_rating_snapshots where listing_id = ${listingId}`;
    expect(snapshot.histogram).toMatchObject({ "5": 1 });
  });

  it("repairs legacy JSON strings once, preserves malformed values, and keeps numeric chart aggregation working", async () => {
    await sql`delete from mobile_apps_migrations where name = 'json_storage_v1'`;
    await sql`update mobile_app_listings set official_ratings = ${JSON.stringify([{ territory: "nl", avg: 4.5 }])}::jsonb,
      store_metadata = ${"invalid legacy JSON"}::jsonb where id = ${listingId}`;
    await sql`insert into mobile_app_report_metrics (listing_id, report, dimension, dimension_value, metric_date, metrics)
      values (${listingId}, 'store_performance', 'country', 'nl', '2026-06-01', ${JSON.stringify({ visitors: 10 })}::jsonb)`;
    await repairMobileAppsJsonStorage(sql);
    await repairMobileAppsJsonStorage(sql);
    const [listing] = await sql`select official_ratings, store_metadata from mobile_app_listings where id = ${listingId}`;
    expect(listing.official_ratings).toEqual([{ territory: "nl", avg: 4.5 }]);
    expect(listing.store_metadata).toBe("invalid legacy JSON");
    const repairJobs = await sql`select id from mobile_app_report_sync_jobs where reason = 'json-storage-repair'`;
    expect(repairJobs).toHaveLength(1);
    await refreshReportRollups(sql, listingId);
    const [rollup] = await sql`select metrics from mobile_app_report_daily_rollups`;
    expect(rollup.metrics).toEqual({ visitors: 10 });
  });
});
