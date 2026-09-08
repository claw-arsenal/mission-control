import { getSql } from "@/lib/local-db";
import { syncApp } from "@/lib/mobile-apps/sync";
import { refreshReportRollups } from "@/lib/mobile-apps/report-rollups";
import { enqueueReportSyncJob, reapStaleReportJobs, type EnqueueReportSyncInput } from "@/lib/mobile-apps/report-jobs";
import { checkOfficialReportFreshness } from "@/lib/mobile-apps/report-freshness";
import { publishChange } from "@/lib/mobile-apps/change-events";

type Sql = ReturnType<typeof getSql>;

/** Single advisory-lock key so only one heavy worker runs cluster-wide. */
export const WORKER_LOCK_KEY = "mobile_reports_sync_worker";

export type ClaimedJob = {
  id: string;
  mode: "incremental" | "backfill";
  store: "google" | "apple" | null;
  mobileAppId: string | null;
  listingId: string | null;
  reason?: string | null;
};

export type JobOutcome = {
  status: "success" | "partial" | "failed" | "skipped";
  error?: string | null;
  warnings?: string[];
  stats?: Record<string, unknown>;
};

export type WorkerDeps = {
  syncApp: typeof syncApp;
  refreshReportRollups: (sql: Sql, listingId: string) => Promise<void>;
  updateFreshness: (sql: Sql, listingId: string) => Promise<void>;
};

const defaultDeps: WorkerDeps = {
  syncApp,
  refreshReportRollups,
  // Recompute the real freshness verdict from GCS generations after processing, so
  // the row reflects exactly what was just parsed (fresh when caught up).
  updateFreshness: async (sql, listingId) => {
    await checkOfficialReportFreshness(sql, listingId);
  },
};

/** Try to grab the global worker lock. Returns false if another worker holds it. */
export async function acquireWorkerLock(sql: Sql): Promise<boolean> {
  const rows = (await sql`select pg_try_advisory_lock(hashtext(${WORKER_LOCK_KEY})) as locked`) as unknown as Array<{
    locked: boolean;
  }>;
  return rows[0]?.locked === true;
}

export async function releaseWorkerLock(sql: Sql): Promise<void> {
  await sql`select pg_advisory_unlock(hashtext(${WORKER_LOCK_KEY}))`.catch(() => null);
}

/** Atomically flip up to `limit` queued jobs to running and return them. */
export async function claimQueuedJobs(sql: Sql, limit = 10): Promise<ClaimedJob[]> {
  const rows = (await sql`
    update mobile_app_report_sync_jobs
    set status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now()
    where id in (
      select id from mobile_app_report_sync_jobs
      where status = 'queued'
      order by created_at asc
      for update skip locked
      limit ${limit}
    )
    returning id::text, mode, store,
              mobile_app_id::text as "mobileAppId", listing_id::text as "listingId", reason
  `) as unknown as ClaimedJob[];
  return rows;
}

export async function heartbeatJob(sql: Sql, jobId: string): Promise<void> {
  await sql`update mobile_app_report_sync_jobs set heartbeat_at = now() where id = ${jobId}::uuid and status = 'running'`.catch(() => null);
}

/**
 * Heartbeat interval while a job runs. Must be comfortably under STALE_JOB_MS
 * (report-jobs.ts) or a long single-app CSV sync — which has no internal await
 * points where we could beat manually — gets reaped as stalled mid-run.
 */
const HEARTBEAT_INTERVAL_MS = 60_000;

export async function finishJob(sql: Sql, jobId: string, outcome: JobOutcome): Promise<void> {
  await sql`
    update mobile_app_report_sync_jobs
    set status = ${outcome.status},
        finished_at = now(),
        heartbeat_at = now(),
        error_message = ${outcome.error ?? null},
        warnings = ${JSON.stringify(outcome.warnings ?? [])}::text::jsonb,
        stats = ${JSON.stringify(outcome.stats ?? {})}::text::jsonb
    where id = ${jobId}::uuid
  `;
}

/** Resolve which app ids a job targets. */
async function resolveAppIds(sql: Sql, job: ClaimedJob): Promise<string[]> {
  if (job.mobileAppId) return [job.mobileAppId];
  if (job.listingId) {
    const rows = (await sql`
      select mobile_app_id::text as id from mobile_app_listings where id = ${job.listingId}::uuid
    `) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
  // No target → process every app that has at least one listing (incremental cron).
  const rows = (await sql`
    select distinct mobile_app_id::text as id from mobile_app_listings
  `) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/**
 * Run one job's heavy work. This is the ONLY place that runs syncApp with the
 * heavy flags on (syncReports + syncAppleStorefronts). After each app syncs its
 * reports into the raw metrics table, rollups are rebuilt before completion is
 * published. Freshness must observe the terminal job, not its own running state.
 */
export async function runReportSyncJob(sql: Sql, job: ClaimedJob, deps: WorkerDeps = defaultDeps): Promise<JobOutcome> {
  // Timer-based heartbeat for the whole job: per-step beats are not enough because
  // one syncApp call can stream CSVs for longer than the stale threshold.
  const beat = setInterval(() => void heartbeatJob(sql, job.id), HEARTBEAT_INTERVAL_MS);
  try {
    const warnings: string[] = [];
    const errors: string[] = [];
    const stats: Record<string, unknown> = {};
    let fetched = 0;
    let inserted = 0;
    let failures = 0;
    let successes = 0;
    let partials = 0;
    // Google listing id -> owning app id, so per-listing report changes can name their app.
    const googleListings = new Map<string, string>();
    const rollupFailures = new Map<string, string>();

    try {
      const appIds = await resolveAppIds(sql, job);
      stats.apps = appIds.length;
      for (const appId of appIds) {
        await heartbeatJob(sql, job.id);
        try {
          const results = await deps.syncApp(appId, {
            force: true,
            syncReports: true,
            syncAppleStorefronts: true,
            refreshReports: job.mode === "backfill",
            allReportMonths: job.mode === "backfill",
            store: job.store ?? undefined,
            listingId: job.listingId ?? undefined,
            listingConcurrency: 1,
          });
          for (const r of results) {
            fetched += r.fetched ?? 0;
            inserted += r.inserted ?? 0;
            if (r.status === "failed" || r.reportsStatus === "failed") {
              failures++;
              errors.push(r.error || `${r.store} listing ${r.listingId}: report sync failed`);
            } else if (r.reportsStatus === "partial") partials++;
            else if (r.status !== "skipped") successes++;
            if (Array.isArray(r.reportWarnings)) warnings.push(...r.reportWarnings);
            if (r.store === "google" && r.listingId) googleListings.set(r.listingId, appId);
          }
        } catch (error) {
          failures++;
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      failures++;
      errors.push(error instanceof Error ? error.message : String(error));
    }

    for (const listingId of googleListings.keys()) {
      await heartbeatJob(sql, job.id);
      try {
        await deps.refreshReportRollups(sql, listingId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rollupFailures.set(listingId, message);
        errors.push(`Report rollups: ${message}`);
      }
    }

    stats.fetched = fetched;
    stats.inserted = inserted;
    stats.googleListings = googleListings.size;
    stats.rollupFailedListings = [...rollupFailures.keys()];

    const status: JobOutcome["status"] = failures > 0 && successes + partials === 0
      ? "failed"
      : failures > 0 || partials > 0 || rollupFailures.size > 0
        ? "partial"
        : successes > 0 ? "success" : "skipped";
    const outcome: JobOutcome = { status, warnings, stats, error: errors.length ? errors.join("; ") : null };
    await finishJob(sql, job.id, outcome);
    // Clear a completed job's persisted "refreshing" state even if a later
    // metadata lookup fails or the target vanished during processing.
    await sql`
      update mobile_app_report_freshness
      set status = ${status === "failed" ? "failed" : "unknown"}, active_job_id = null,
          error_message = ${outcome.error ?? null}, updated_at = now()
      where active_job_id = ${job.id}::uuid
    `;
    await publishChange(sql, { kind: "job", appId: job.mobileAppId, jobId: job.id, jobStatus: status });
    for (const [listingId, appId] of googleListings) {
      try {
        const rollupError = rollupFailures.get(listingId);
        if (rollupError) throw new Error(rollupError);
        await deps.updateFreshness(sql, listingId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await sql`
          insert into mobile_app_report_freshness (listing_id, status, error_message, checked_at)
          values (${listingId}::uuid, 'failed', ${message}, now())
          on conflict (listing_id) do update set status = 'failed', active_job_id = null,
            error_message = excluded.error_message, checked_at = now(), updated_at = now()
        `;
      }
      await publishChange(sql, { kind: "reports", appId, listingId, store: "google", jobId: job.id, jobStatus: status });
    }
    if (googleListings.size === 0) await publishChange(sql, { kind: "reports", appId: job.mobileAppId, jobId: job.id, jobStatus: status });
    return outcome;
  } finally {
    clearInterval(beat);
  }
}

/**
 * Drain all currently-queued jobs sequentially (never concurrently — each job's
 * CSV parse is memory-heavy). Caller must already hold the advisory lock.
 */
export async function processQueuedJobs(
  sql: Sql,
  deps: WorkerDeps = defaultDeps,
): Promise<{ processed: number; jobIds: string[] }> {
  await reapStaleReportJobs(sql);
  const jobIds: string[] = [];
  while (true) {
    // Waiting work must stay queued: only the current job has a heartbeat.
    const [job] = await claimQueuedJobs(sql, 1);
    if (!job) break;
    await publishChange(sql, { kind: "job", appId: job.mobileAppId, jobId: job.id, jobStatus: "running" });
    await runReportSyncJob(sql, job, deps);
    jobIds.push(job.id);
  }
  return { processed: jobIds.length, jobIds };
}

/** Keep the session-scoped advisory lock on one reserved connection for the tick. */
export async function runReportWorkerTick(
  sql: Sql,
  enqueue?: EnqueueReportSyncInput,
  deps: WorkerDeps = defaultDeps,
): Promise<{ processed: number; jobIds: string[]; skipped: boolean }> {
  // A manual request must remain queued even if another worker holds the lock.
  if (enqueue) await enqueueReportSyncJob(sql, enqueue);
  const connection = await sql.reserve();
  let locked = false;
  try {
    locked = await acquireWorkerLock(connection);
    if (!locked) return { processed: 0, jobIds: [], skipped: true };
    // Rollups use transactions; reserved postgres.js clients do not expose begin.
    return { ...await processQueuedJobs(sql, deps), skipped: false };
  } finally {
    try {
      if (locked) await releaseWorkerLock(connection);
    } finally {
      await connection.release();
    }
  }
}
