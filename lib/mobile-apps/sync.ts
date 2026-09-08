import { ingestReportFiles, type ReportSyncStats } from "@/lib/mobile-apps/report-ingestion";
import { createHash } from "node:crypto";
import pLimit from "p-limit";
import { getSql } from "@/lib/local-db";
import { loadMobileReviewsConfig, type GoogleConfig } from "@/lib/mobile-apps/config";
import { summarizeReviews } from "@/lib/mobile-apps/metrics";
import { getProvider } from "@/lib/mobile-apps/providers";
import { fetchAppleTerritoryRatings, fetchAppleAppMetadata, type TerritoryRating, type AppleAppMetadata } from "@/lib/mobile-apps/providers/app-store-ratings";
import {
  listReportFiles,
  listReviewReportFiles,
  streamCsvRows,
  mapReportRecord,
  mapReportMultiRecord,
  mapReviewRecord,
  reportNotFoundWarning,
  RATINGS_DIMENSIONS,
  INSTALLS_DIMENSIONS,
  CRASHES_DIMENSIONS,
  STORE_PERFORMANCE_COUNTRY_DIMENSIONS,
  STORE_PERFORMANCE_TRAFFIC_SOURCE_DIMENSIONS,
  ReportError,
  type ReportFile,
  type ReviewCsvFile,
  type ReportKind,
  type ReportRecord,
  type ReportMultiRecord,
} from "@/lib/mobile-apps/providers/google-play-reports";
import { toAlpha2 } from "@/lib/mobile-apps/country-codes";
import { ensureMobileAppsSchema } from "@/lib/mobile-apps/ensure-schema";
import { ratingSourceCopy, type RatingSource } from "@/lib/mobile-apps/rating-source";
import type { RawReview, Store } from "@/lib/mobile-apps/types";
import { publishChange } from "@/lib/mobile-apps/change-events";

type Sql = ReturnType<typeof getSql>;

type ListingRow = {
  id: string;
  store: string;
  store_app_id: string;
  country: string;
  last_synced_at: string | null;
};

export type ReportsStatus = "success" | "partial" | "failed" | "not_configured";

export type SyncResult = {
  listingId: string;
  store: Store;
  appIdentifier: string;
  inserted: number;
  fetched: number;
  ratingCaptured: boolean;
  skipped: boolean;
  status: "success" | "failed" | "skipped";
  error: string | null;
  reportsStatus: ReportsStatus;
  reportWarnings: string[];
  /** Machine-readable source of the headline/current rating. */
  ratingSource: RatingSource | null;
  /** Freshness date when the source exposes one, e.g. Google Play Console report date. */
  ratingAsOf: string | null;
  /** Admin/UI-safe source label, e.g. Google Play · Play Console report. */
  ratingSourceLabel: string;
  ratingFreshnessLabel: string | null;
  ratingSourceHelperText: string;
};

const DEFAULT_DEDUPE_MS = 60_000;

function reportErrMessage(err: unknown): string {
  if (err instanceof ReportError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

async function upsertReviews(sql: Sql, listingId: string, reviews: RawReview[]): Promise<number> {
  let inserted = 0;
  for (const r of reviews) {
    // Normalize the review territory to a canonical alpha-2 code at ingestion so
    // every consumer (by-country merge, filters) compares like-for-like. Apple
    // Connect returns alpha-3 (NLD); iTunes ratings use alpha-2 (nl). Unmappable
    // values (e.g. a country name) are preserved lowercased rather than dropped.
    const country = r.country ? toAlpha2(r.country) ?? r.country.trim().toLowerCase() : null;
    const res = await sql`
      insert into app_reviews (
        listing_id, store_review_id, author, rating, title, body,
        app_version, country, submitted_at, store_response, language, device, raw_json
      ) values (
        ${listingId}, ${r.storeReviewId}, ${r.author}, ${r.rating}, ${r.title}, ${r.body},
        ${r.appVersion}, ${country}, ${r.submittedAt}, ${r.storeResponse}, ${r.language ?? null},
        ${r.device ?? null}, ${r.raw ? JSON.stringify(r.raw) : null}::text::jsonb
      )
      on conflict (listing_id, store_review_id) do update
        set author = excluded.author,
            rating = excluded.rating,
            title = excluded.title,
            body = excluded.body,
            app_version = excluded.app_version,
            country = excluded.country,
            submitted_at = excluded.submitted_at,
            store_response = excluded.store_response,
            language = excluded.language,
            device = excluded.device,
            raw_json = excluded.raw_json,
            fetched_at = now()
      returning (xmax = 0) as inserted
    `;
    if ((res as unknown as Array<{ inserted: boolean }>)[0]?.inserted) inserted += 1;
  }
  return inserted;
}

/** Upsert single-dimension daily report rows under the dimension from the CSV file. */
async function persistReports(
  sql: Sql,
  listingId: string,
  report: string,
  dimension: string,
  reportMonth: string | null,
  records: ReportRecord[],
  source: string,
): Promise<void> {
  for (const r of records) {
    if (!r.date) continue;
    await sql`
      insert into mobile_app_report_metrics (listing_id, report, dimension, dimension_value, metric_date, report_month, metrics, source)
      values (${listingId}, ${report}, ${dimension}, ${r.dimensionValue}, ${r.date}, ${reportMonth}, ${JSON.stringify(r.values)}::text::jsonb, ${source})
      on conflict (listing_id, report, dimension, dimension_value, metric_date) do update
        set metrics = excluded.metrics, report_month = excluded.report_month, source = excluded.source, captured_at = now()
    `;
  }
}

/** Upsert multi-dimension rows (Store Performance traffic_source), preserving the text dimensions. */
async function persistMultiReports(
  sql: Sql,
  listingId: string,
  reportMonth: string | null,
  records: ReportMultiRecord[],
  source: string,
): Promise<void> {
  for (const r of records) {
    if (!r.date) continue;
    // Stable hash of the (canonically ordered) dimensions so distinct
    // source/search-term/utm combinations never collide on the unique key. The
    // full dimensions object is kept in the jsonb column for display/debugging.
    const canonical = JSON.stringify(Object.keys(r.dimensions).sort().map((k) => [k, r.dimensions[k]]));
    const dimValue = createHash("sha1").update(canonical).digest("hex");
    await sql`
      insert into mobile_app_report_metrics (listing_id, report, dimension, dimension_value, metric_date, report_month, metrics, dimensions, source)
      values (${listingId}, 'store_performance', 'traffic_source', ${dimValue}, ${r.date}, ${reportMonth}, ${JSON.stringify(r.values)}::text::jsonb, ${JSON.stringify(r.dimensions)}::text::jsonb, ${source})
      on conflict (listing_id, report, dimension, dimension_value, metric_date) do update
        set metrics = excluded.metrics, dimensions = excluded.dimensions, report_month = excluded.report_month, source = excluded.source, captured_at = now()
    `;
  }
}

const REPORT_BATCH = 500;

/**
 * Stream a single-dimension report file and persist in bounded batches, so a
 * large monthly CSV never sits fully in memory. Ratings are aggregated to the
 * latest value per country (bounded by the country count) while streaming.
 */
async function streamSingleDimFile(
  sql: Sql,
  listingId: string,
  cfg: GoogleConfig,
  file: ReportFile,
  report: ReportKind,
  source: string,
): Promise<number> {
  if (report === "ratings") {
    const latest = new Map<string, { avg: number | null; asOf: string | null }>();
    for await (const row of streamCsvRows(cfg, file.path)) {
      const rec = mapReportRecord(row);
      const country = rec.dimensionValue;
      if (!country) continue;
      const asOf = rec.date;
      const prev = latest.get(country);
      if (!prev || (asOf ?? "") >= (prev.asOf ?? "")) latest.set(country, { avg: rec.values.total_average_rating ?? null, asOf });
    }
    const records: ReportRecord[] = [...latest.entries()].map(([territory, v]) => ({
      date: v.asOf,
      dimensionValue: territory,
      values: { total_average_rating: v.avg },
    }));
    if (records.length) await persistReports(sql, listingId, "ratings", file.dimension, file.yyyyMM, records, source);
    return records.length;
  }

  let count = 0;
  let batch: ReportRecord[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    // The file ingestion module owns the transaction; batches keep memory bounded.
    await persistReports(sql, listingId, report, file.dimension, file.yyyyMM, rows, source);
  };
  for await (const row of streamCsvRows(cfg, file.path)) {
    const rec = mapReportRecord(row);
    if (!rec.date) continue;
    batch.push(rec);
    count++;
    if (batch.length >= REPORT_BATCH) await flush();
  }
  await flush();
  return count;
}

/** Stream + batch-persist the multi-dimension traffic-source file. */
async function streamTrafficFile(sql: Sql, listingId: string, cfg: GoogleConfig, file: ReportFile): Promise<number> {
  let count = 0;
  let batch: ReportMultiRecord[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    await persistMultiReports(sql, listingId, file.yyyyMM, rows, "google_play_console_store_performance_report");
  };
  for await (const row of streamCsvRows(cfg, file.path)) {
    const rec = mapReportMultiRecord(row);
    if (!rec.date) continue;
    batch.push(rec);
    count++;
    if (batch.length >= REPORT_BATCH) await flush();
  }
  await flush();
  return count;
}

/** Stream + batch-upsert the historical reviews CSV (slim raw, flat memory). */
async function streamReviewFile(
  sql: Sql,
  listingId: string,
  cfg: GoogleConfig,
  file: ReviewCsvFile,
): Promise<{ parsed: number; inserted: number }> {
  let parsed = 0;
  let inserted = 0;
  let batch: RawReview[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    inserted += await upsertReviews(sql, listingId, rows);
  };
  for await (const row of streamCsvRows(cfg, file.path)) {
    const rev = mapReviewRecord(row);
    if (!rev) continue;
    batch.push(rev);
    parsed++;
    if (batch.length >= REPORT_BATCH) await flush();
  }
  await flush();
  return { parsed, inserted };
}

async function listFilesOrWarning(
  cfg: GoogleConfig, kind: ReportKind, appIdentifier: string,
  dimensions: readonly string[], label: string, allMonths: boolean,
): Promise<{ files: ReportFile[]; warning: string | null }> {
  try {
    const files = await listReportFiles(cfg, kind, appIdentifier, dimensions, { allMonths });
    return { files, warning: files.length ? null : reportNotFoundWarning(label, cfg, appIdentifier, dimensions) };
  } catch (error) {
    return { files: [], warning: reportErrMessage(error) };
  }
}

async function syncSingleDimensionReportFiles(
  sql: Sql, listingId: string, cfg: GoogleConfig, appIdentifier: string,
  report: ReportKind, label: string, dimensions: readonly string[],
  source: string, forceReports: boolean, allMonths: boolean,
): Promise<ReportSyncStats> {
  const discovery = await listFilesOrWarning(cfg, report, appIdentifier, dimensions, label, allMonths);
  return ingestReportFiles(sql, listingId, cfg, {
    ...discovery, label, force: forceReports,
    consume: async (db, file) => ({ rows: await streamSingleDimFile(db, listingId, cfg, file, report, source) }),
  });
}

async function syncTrafficSourceFiles(
  sql: Sql, listingId: string, cfg: GoogleConfig, appIdentifier: string,
  forceReports: boolean, allMonths: boolean,
): Promise<ReportSyncStats> {
  const label = "store performance traffic source";
  const discovery = await listFilesOrWarning(cfg, "store_performance", appIdentifier, STORE_PERFORMANCE_TRAFFIC_SOURCE_DIMENSIONS, label, allMonths);
  return ingestReportFiles(sql, listingId, cfg, {
    ...discovery, label, force: forceReports,
    consume: async (db, file) => ({ rows: await streamTrafficFile(db, listingId, cfg, file) }),
  });
}

async function syncGooglePlayReviewCsvFiles(
  sql: Sql, listingId: string, cfg: GoogleConfig, appIdentifier: string,
  forceReports: boolean, allMonths: boolean,
): Promise<ReportSyncStats> {
  let files: ReviewCsvFile[] = [];
  let warning: string | null = null;
  try {
    files = await listReviewReportFiles(cfg, appIdentifier, { allMonths });
    if (!files.length) warning = "No monthly Google Play review reports are available.";
  } catch (error) {
    warning = reportErrMessage(error);
  }
  return ingestReportFiles(sql, listingId, cfg, {
    files, warning, label: "reviews CSV", force: forceReports,
    consume: async (db, file) => {
      const result = await streamReviewFile(db, listingId, cfg, file);
      return { rows: result.parsed, reviewsParsed: result.parsed, reviewsInserted: result.inserted };
    },
  });
}

/** Stored official per-territory ratings for a listing (jsonb may arrive as object or string). */
async function loadStoredOfficialRatings(sql: Sql, listingId: string): Promise<TerritoryRating[]> {
  const rows = (await sql`
    select official_ratings from mobile_app_listings where id = ${listingId}::uuid limit 1
  `) as unknown as Array<{ official_ratings: unknown }>;
  const raw = rows[0]?.official_ratings;
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  }
  return arr
    .filter((t): t is TerritoryRating => Boolean(t) && typeof t === "object" && typeof (t as TerritoryRating).territory === "string")
    .map((t) => ({ territory: t.territory, avg: t.avg ?? null, count: t.count ?? null }));
}

async function loadGoogleRatingsFromDb(sql: Sql, listingId: string): Promise<{ territories: TerritoryRating[]; asOf: string | null }> {
  const rows = (await sql`
    select distinct on (dimension_value)
      dimension_value as territory,
      (metrics->>'total_average_rating')::float8 as avg,
      to_char(metric_date, 'YYYY-MM-DD') as as_of
    from mobile_app_report_metrics
    where listing_id = ${listingId}::uuid
      and report = 'ratings'
      and dimension = 'country'
      and metrics ? 'total_average_rating'
    order by dimension_value, metric_date desc
  `) as unknown as Array<{ territory: string; avg: number | null; as_of: string | null }>;
  const territories = rows.map((r) => ({ territory: r.territory, avg: r.avg, count: null }));
  const asOf = rows.map((r) => r.as_of).filter(Boolean).sort().at(-1) ?? null;
  return { territories, asOf };
}

/** Sync a single listing: fetch official reviews, upsert, snapshot, record the run. */
async function syncListing(
  sql: Sql,
  listing: ListingRow,
  opts: {
    appId: string;
    force: boolean;
    dedupeMs: number;
    refreshReports: boolean;
    syncReports: boolean;
    syncAppleStorefronts: boolean;
    allReportMonths: boolean;
  },
): Promise<SyncResult> {
  const store = listing.store as Store;
  const appIdentifier = listing.store_app_id;
  const base = { listingId: listing.id, store, appIdentifier };

  const recentlySynced =
    listing.last_synced_at && Date.now() - new Date(listing.last_synced_at).getTime() < opts.dedupeMs;
  if (!opts.force && recentlySynced) {
    return {
      ...base,
      inserted: 0,
      fetched: 0,
      ratingCaptured: false,
      skipped: true,
      status: "skipped",
      error: null,
      reportsStatus: "not_configured",
      reportWarnings: [],
      ratingSource: null,
      ratingAsOf: null,
      ratingSourceLabel: "Rating not refreshed",
      ratingFreshnessLabel: null,
      ratingSourceHelperText: "This listing was skipped because it was synced recently.",
    };
  }

  const runRows = (await sql`
    insert into app_review_sync_runs (listing_id, store, app_identifier, status)
    values (${listing.id}::uuid, ${store}, ${appIdentifier}, 'running')
    returning id::text
  `) as unknown as Array<{ id: string }>;
  const runId = runRows[0]?.id;

  try {
    const provider = getProvider(store);
    const reviews = await provider.fetchReviews({ store, storeAppId: appIdentifier, country: listing.country });

    let fetchedReviewCount = reviews.length;
    let inserted = await upsertReviews(sql, listing.id, reviews);

    // Star distribution snapshot from fetched reviews only (history; not headline store rating).
    const summary = summarizeReviews(reviews);
    await sql`
      insert into app_rating_snapshots (listing_id, avg_rating, ratings_count, histogram)
      values (${listing.id}, ${summary.avgRating}, ${summary.ratingsCount}, ${JSON.stringify(summary.histogram)}::text::jsonb)
    `;

    const cfg = loadMobileReviewsConfig();
    const reportWarnings: string[] = [];
    let reportAttempts = 0;
    let reportFilesSucceeded = 0;
    let officialRatings: TerritoryRating[] = [];
    let currentRating: number | null = null;
    let ratingsCount: number | null = null;
    let ratingSource: RatingSource | null = null;
    let ratingAsOf: string | null = null;
    let storeMetadata: AppleAppMetadata | null = null;

    if (store === "apple") {
      // The full ~155-storefront scan is heavy and worker-owned: it only runs when
      // the caller explicitly opts in via syncAppleStorefronts (and the config mode
      // allows it). `force` from web/API routes must NOT trigger it. Normal live
      // sync fetches only the listing's own country rating/metadata.
      const mode = cfg.apple.fullStorefrontScan;
      const fullScan = opts.syncAppleStorefronts && (mode === "always" || mode === "forced");
      const territories = fullScan ? [...reviews.map((r) => r.country ?? ""), listing.country] : [listing.country];
      // Ratings scan + one metadata lookup, in parallel. Metadata is best-effort.
      const [territoryRatings, metadata] = await Promise.all([
        fetchAppleTerritoryRatings(appIdentifier, territories, {
          fullScan,
          concurrency: cfg.apple.storefrontScanConcurrency,
          delayMs: cfg.apple.storefrontScanDelayMs,
        }).catch(() => []),
        fetchAppleAppMetadata(appIdentifier, listing.country).catch(() => null),
      ]);
      if (fullScan) {
        // The full scan is authoritative: it probed every storefront, so replace.
        officialRatings = territoryRatings;
      } else {
        // Light sync probed ONLY the listing's own storefront. MERGE that result
        // into the stored list (built by the worker's full scan) instead of
        // replacing it — otherwise every page open collapses the By-country list
        // to one row (or wipes it on a failed lookup) until the next worker pass.
        const stored = await loadStoredOfficialRatings(sql, listing.id);
        const merged = new Map(stored.map((t) => [t.territory, t]));
        for (const t of territoryRatings) merged.set(t.territory, t);
        officialRatings = [...merged.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
      }
      storeMetadata = metadata;
      const primary =
        officialRatings.find((t) => t.territory === toAlpha2(listing.country)) ?? officialRatings[0] ?? null;
      currentRating = primary?.avg ?? null;
      ratingsCount = primary?.count ?? null;
      ratingSource = "apple_app_store_lookup";
    } else {
      if (opts.syncReports && cfg.google.reportsBucket) {
        const ratingsStats = await syncSingleDimensionReportFiles(
          sql,
          listing.id,
          cfg.google,
          appIdentifier,
          "ratings",
          "ratings",
          RATINGS_DIMENSIONS,
          "google_play_console_ratings_report",
          opts.refreshReports,
          opts.allReportMonths,
        );
        reportAttempts += ratingsStats.groupsAttempted;
        reportFilesSucceeded += ratingsStats.filesDownloaded + ratingsStats.filesSkipped;
        reportWarnings.push(...ratingsStats.warnings);
      }
      // ALWAYS read the report-derived ratings already in our DB (cheap, no GCS).
      // A light sync skips the heavy report-file sync, but it must NOT downgrade
      // the headline to the written-review average — and wipe the per-country
      // list — just because it didn't re-download CSVs this time.
      if (cfg.google.reportsBucket) {
        const ratingReport = await loadGoogleRatingsFromDb(sql, listing.id);
        if (ratingReport.territories.length > 0) {
          officialRatings = ratingReport.territories;
          const primary =
            officialRatings.find((t) => t.territory === toAlpha2(listing.country)) ?? officialRatings[0] ?? null;
          currentRating = primary?.avg ?? null;
          ratingsCount = null; // Play Console ratings report does not expose per-country rating count.
          ratingSource = "google_play_console_ratings_report";
          ratingAsOf = ratingReport.asOf;
        }
      }
      if (!ratingSource) {
        currentRating = summary.avgRating;
        ratingsCount = summary.ratingsCount;
        ratingSource = "google_reviews_api_fetched_reviews";
      }
    }

    await sql`
      update mobile_app_listings
      set current_rating = ${currentRating},
          ratings_count = ${ratingsCount},
          official_ratings = ${officialRatings.length ? JSON.stringify(officialRatings) : null}::text::jsonb,
          rating_source = ${ratingSource},
          rating_as_of = ${ratingAsOf},
          store_metadata = coalesce(${storeMetadata ? JSON.stringify(storeMetadata) : null}::text::jsonb, store_metadata),
          last_synced_at = now()
      where id = ${listing.id}
    `;
    // Typed change events: the listing row changed, and reviews arrived if any.
    await publishChange(sql, { kind: "listing", appId: opts.appId, listingId: listing.id, store });
    if (inserted > 0) await publishChange(sql, { kind: "reviews", appId: opts.appId, listingId: listing.id, store, inserted });

    // Google Play Console bulk reports: list/download ALL available year/month CSVs.
    // Page/tab syncs pass syncReports=false so heavy all-year CSV scans do not block the UI.
    // The reports refresh button passes syncReports=true and refreshReports=true.
    // Best-effort — never fail the review sync — but warnings are stored for the UI.
    if (opts.syncReports && store === "google" && cfg.google.reportsBucket) {
      // Process report types ONE AT A TIME (not Promise.all): each downloads and
      // parses CSVs into memory, so running them concurrently multiplies peak heap
      // and OOM-kills the server. Sequential keeps only one report's data resident.
      const installsStats = await syncSingleDimensionReportFiles(
        sql,
        listing.id,
        cfg.google,
        appIdentifier,
        "installs",
        "installs",
        INSTALLS_DIMENSIONS,
        "google_play_console_stats_report",
        opts.refreshReports,
        opts.allReportMonths,
      );
      const crashesStats = await syncSingleDimensionReportFiles(
        sql,
        listing.id,
        cfg.google,
        appIdentifier,
        "crashes",
        "crashes",
        CRASHES_DIMENSIONS,
        "google_play_console_crashes_report",
        opts.refreshReports,
        opts.allReportMonths,
      );
      const storePerfStats = await syncSingleDimensionReportFiles(
        sql,
        listing.id,
        cfg.google,
        appIdentifier,
        "store_performance",
        "store performance country",
        STORE_PERFORMANCE_COUNTRY_DIMENSIONS,
        "google_play_console_store_performance_report",
        opts.refreshReports,
        opts.allReportMonths,
      );
      const trafficStats = await syncTrafficSourceFiles(sql, listing.id, cfg.google, appIdentifier, opts.refreshReports, opts.allReportMonths);
      const reviewCsvStats = await syncGooglePlayReviewCsvFiles(sql, listing.id, cfg.google, appIdentifier, opts.refreshReports, opts.allReportMonths);
      const stats = [installsStats, crashesStats, storePerfStats, trafficStats, reviewCsvStats];
      for (const s of stats) {
        reportAttempts += s.groupsAttempted;
        reportFilesSucceeded += s.filesDownloaded + s.filesSkipped;
        reportWarnings.push(...s.warnings);
      }
      // reviewCsvStats keeps its precise type, so the review counts are typed.
      fetchedReviewCount += reviewCsvStats.reviewsParsed;
      inserted += reviewCsvStats.reviewsInserted;
      if (reviewCsvStats.reviewsInserted > 0)
        await publishChange(sql, { kind: "reviews", appId: opts.appId, listingId: listing.id, store, inserted: reviewCsvStats.reviewsInserted });
    }

    const ratingCaptured = currentRating != null || officialRatings.length > 0;
    const sourceCopy = ratingSourceCopy({ store, source: ratingSource, asOf: ratingAsOf });
    const reportsStatus: ReportsStatus =
      reportAttempts === 0
        ? "not_configured"
        : reportWarnings.length === 0
          ? "success"
          : reportFilesSucceeded === 0
            ? "failed"
            : "partial";

    if (runId) {
      await sql`
        update app_review_sync_runs
        set status = 'success', finished_at = now(), fetched_count = ${fetchedReviewCount}, upserted_count = ${inserted},
            report_status = ${reportsStatus}, report_warnings = ${JSON.stringify(reportWarnings)}::text::jsonb
        where id = ${runId}::uuid
      `;
    }
    return {
      ...base,
      inserted,
      fetched: fetchedReviewCount,
      ratingCaptured,
      skipped: false,
      status: "success",
      error: null,
      reportsStatus,
      reportWarnings,
      ratingSource,
      ratingAsOf,
      ratingSourceLabel: sourceCopy.sourceLabel,
      ratingFreshnessLabel: sourceCopy.freshnessLabel,
      ratingSourceHelperText: sourceCopy.helperText,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (runId) {
      await sql`
        update app_review_sync_runs
        set status = 'failed', finished_at = now(), error_message = ${error}
        where id = ${runId}::uuid
      `.catch(() => null);
    }
    return {
      ...base,
      inserted: 0,
      fetched: 0,
      ratingCaptured: false,
      skipped: false,
      status: "failed",
      error,
      reportsStatus: "not_configured",
      reportWarnings: [],
      ratingSource: null,
      ratingAsOf: null,
      ratingSourceLabel: "Rating not refreshed",
      ratingFreshnessLabel: null,
      ratingSourceHelperText: "The sync failed before a rating source could be refreshed.",
    };
  }
}

/**
 * Sync one app: for each of its listings (optionally filtered to a single store),
 * fetch reviews via the official APIs and upsert. Listings are processed with a
 * small concurrency limit so one store failing never blocks the other.
 */
export async function syncApp(
  appId: string,
  opts: {
    force?: boolean;
    dedupeMs?: number;
    store?: Store;
    listingId?: string;
    refreshReports?: boolean;
    syncReports?: boolean;
    syncAppleStorefronts?: boolean;
    /** Backfill: list ALL report months instead of the lookback window. Worker-owned. */
    allReportMonths?: boolean;
    listingConcurrency?: number;
  } = {},
): Promise<SyncResult[]> {
  const sql: Sql = getSql();
  await ensureMobileAppsSchema(sql); // safe if a cron/job syncs before any route inits the schema
  const cfg = loadMobileReviewsConfig();
  const dedupeMs = opts.dedupeMs ?? DEFAULT_DEDUPE_MS;
  const force = Boolean(opts.force);
  // Heavy work is opt-in only. `force` must never imply heavy report or storefront
  // scans — that coupling is what let web/API requests trigger OOM-prone CSV ETL.
  const syncReports = opts.syncReports === true;
  const syncAppleStorefronts = opts.syncAppleStorefronts === true;
  // refreshReports (force re-download of CSVs) is meaningless without syncReports,
  // so derive it from syncReports rather than from `force`. Same for allReportMonths.
  const refreshReports = syncReports && opts.refreshReports === true;
  const allReportMonths = syncReports && opts.allReportMonths === true;

  const listings = (await sql`
    select id::text, store, store_app_id, country, last_synced_at
    from mobile_app_listings
    where mobile_app_id = ${appId}
      and (${opts.store ?? null}::text is null or store = ${opts.store ?? null})
      and (${opts.listingId ?? null}::uuid is null or id = ${opts.listingId ?? null}::uuid)
  `) as unknown as ListingRow[];

  const limit = pLimit(Math.max(1, opts.listingConcurrency ?? cfg.sync.concurrency));
  const results = await Promise.all(
    listings.map((l) =>
      limit(() => syncListing(sql, l, { appId, force, dedupeMs, refreshReports, syncReports, syncAppleStorefronts, allReportMonths })),
    ),
  );
  return results;
}
