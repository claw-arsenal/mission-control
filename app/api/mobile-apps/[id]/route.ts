import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { ensureMobileAppsSchema } from "@/lib/mobile-apps/ensure-schema";
import { loadMobileReviewsConfig } from "@/lib/mobile-apps/config";
import { toAlpha2 } from "@/lib/mobile-apps/country-codes";
import { normalizeTerritoryRatings } from "@/lib/mobile-apps/rating-source";
import { readReportRollups, readLatestBreakdowns } from "@/lib/mobile-apps/report-rollups";
import {
  checkOfficialReportFreshness,
  readStoredFreshness,
  summarizeReportFreshness,
  type FreshnessResult,
  type ReportFreshnessState,
} from "@/lib/mobile-apps/report-freshness";
import { enqueueReportSyncJob } from "@/lib/mobile-apps/report-jobs";
import { isUuid } from "@/lib/mobile-apps/ids";

export const dynamic = "force-dynamic";

const ok = (data: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = (await sql`select id from workspaces order by created_at asc limit 1`) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Coerce a possibly-string/null metric to a number for sorting (NaN → 0). */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function unknownFreshness(): FreshnessResult {
  return {
    status: "unknown",
    needsWorker: false,
    latestOfficialYyyyMm: null,
    latestProcessedYyyyMm: null,
    latestOfficialGeneration: null,
    latestProcessedGeneration: null,
    activeJobId: null,
    warnings: [],
  };
}

/**
 * Canonical alpha-2 key for a territory, regardless of the source format.
 * App Store ratings arrive as alpha-2 (`nl`) while App Store Connect review
 * territories arrive as alpha-3 (`NLD`); without this normalization the same
 * country shows up as two separate rows. Unmappable codes fall back to a
 * lowercased string so they still group consistently.
 */
function territoryKey(v: unknown): string {
  const raw = String(v ?? "").trim();
  return toAlpha2(raw) ?? raw.toLowerCase();
}

type ListingRow = Record<string, unknown> & {
  id: string;
  store: string;
  official_ratings?: unknown;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.email) return fail("Not authenticated", 401);
    if (!(await isModuleEnabled("mobile-apps")))
      return fail("Mobile Applications module is disabled. Enable it in Settings.", 503);

    const { id } = await params;
    if (!isUuid(id)) return fail("App not found", 404);
    const { searchParams } = new URL(request.url);
    // Slices: `core` is app/listings/summary/trend/sync runs/freshness; `reports`
    // is the Play Console series, breakdowns and file index. Clients reacting to a
    // review change ask for `core` only so a new review never reloads reports.
    const include = new Set((searchParams.get("include") ?? "core,reports").split(",").map(s => s.trim()).filter(Boolean));
    const includeReports = include.has("reports");
    const includeCore = include.has("core") || !includeReports;
    const asOf = new Date().toISOString();
    const sql = getSql();
    await ensureMobileAppsSchema(sql);
    const wid = await workspaceId(sql);
    if (!wid) return fail("App not found", 404);

    const appRows = (await sql`
      select id::text, name, icon_url, notes from mobile_apps where id = ${id}::uuid and workspace_id = ${wid}::uuid limit 1
    `) as unknown as Array<Record<string, unknown>>;
    if (!appRows[0]) return fail("App not found", 404);

    const listings = (await sql`
      select id::text, store, store_app_id, country, current_rating::float8 as current_rating, ratings_count,
             official_ratings, rating_source, rating_as_of, store_metadata, last_synced_at
      from mobile_app_listings where mobile_app_id = ${id}::uuid
    `) as unknown as ListingRow[];
    const listingIds = listings.map((l) => l.id);

    // Attach fetched/stored written-review counts per country to the official
    // country rating rows. These are written reviews only, not total ratings.
    if (listingIds.length > 0) {
      const reviewCountryRows = (await sql`
        select listing_id::text, lower(country) as territory, count(*)::int as review_count
        from app_reviews
        where listing_id = any(${sql.array(listingIds)}::uuid[])
          and country is not null
          and country <> ''
        group by listing_id, lower(country)
      `) as unknown as Array<{ listing_id: string; territory: string; review_count: number }>;
      const counts = new Map<string, Map<string, number>>();
      for (const row of reviewCountryRows) {
        const byCountry = counts.get(row.listing_id) ?? new Map<string, number>();
        // Normalize to the canonical alpha-2 key so alpha-3 review territories
        // (NLD) merge into the matching alpha-2 rating row (nl). Sum in case two
        // raw codes collapse to the same country.
        const key = territoryKey(row.territory);
        byCountry.set(key, (byCountry.get(key) ?? 0) + row.review_count);
        counts.set(row.listing_id, byCountry);
      }
      for (const listing of listings) {
        const byCountry = counts.get(listing.id) ?? new Map<string, number>();
        const ratings = normalizeTerritoryRatings(listing.official_ratings).map((r) => {
          const key = territoryKey(r.territory);
          return { ...r, review_count: byCountry.get(key) ?? 0 };
        });
        for (const [territory, reviewCount] of byCountry.entries()) {
          if (!ratings.some((r) => territoryKey(r.territory) === territory)) {
            ratings.push({ territory, avg: null, count: null, review_count: reviewCount });
          }
        }
        listing.official_ratings = ratings;
      }
    }

    // Review-based daily average rating per store (clean trend, no snapshot noise).
    const trend =
      listingIds.length === 0 || !includeCore
        ? []
        : await sql`
            select
              l.store,
              to_char(date_trunc('day', r.submitted_at), 'YYYY-MM-DD') as day,
              round(avg(r.rating)::numeric, 2)::float8 as avg,
              count(*)::int as count
            from app_reviews r
            join mobile_app_listings l on l.id = r.listing_id
            where r.listing_id = any(${sql.array(listingIds)}::uuid[])
              and r.submitted_at is not null and r.rating is not null
            group by l.store, date_trunc('day', r.submitted_at)
            order by day asc
          `;

    // Latest sync run per listing → "last sync status/error per store".
    const syncRuns =
      listingIds.length === 0 || !includeCore
        ? []
        : await sql`
            select distinct on (run.listing_id)
              run.listing_id::text, run.store, run.status, run.started_at, run.finished_at,
              run.fetched_count, run.upserted_count, run.error_message, run.report_status, run.report_warnings
            from app_review_sync_runs run
            where run.listing_id = any(${sql.array(listingIds)}::uuid[])
            order by run.listing_id, run.started_at desc
          `;

    // Server-computed per-store summary over ALL stored reviews (not just the
    // page returned above). Negative threshold comes from secrets.env config.
    const negativeThreshold = loadMobileReviewsConfig().sync.negativeThreshold;
    const summary =
      listingIds.length === 0 || !includeCore
        ? []
        : await sql`
            select
              l.store,
              count(r.*)::int as total,
              round(avg(r.rating)::numeric, 2)::float8 as avg_rating,
              count(*) filter (where r.rating = 1)::int as r1,
              count(*) filter (where r.rating = 2)::int as r2,
              count(*) filter (where r.rating = 3)::int as r3,
              count(*) filter (where r.rating = 4)::int as r4,
              count(*) filter (where r.rating = 5)::int as r5,
              count(*) filter (where r.rating is not null and r.rating <= ${negativeThreshold})::int as negative,
              count(*) filter (where r.store_response is not null and r.store_response <> '')::int as responded,
              count(*) filter (where r.rating is not null and r.rating <= ${negativeThreshold} and (r.store_response is null or r.store_response = ''))::int as needs_reply,
              max(r.submitted_at) as latest_review_at
            from app_reviews r
            join mobile_app_listings l on l.id = r.listing_id
            where r.listing_id = any(${sql.array(listingIds)}::uuid[])
            group by l.store
          `;

    // Play Console bulk-report data is Google-only. It is intentionally not
    // mixed into the App Store view because Google reports are monthly CSV exports
    // with dimensions, while Apple uses storefront lookup/reviews APIs.
    const reports: Record<string, Array<Record<string, unknown>>> = {};
    const googleListingIds = listings.filter((l) => l.store === "google").map((l) => l.id);
    if (googleListingIds.length > 0 && includeReports) {
      // Charts read ONLY from the worker-built daily rollups, never from raw
      // mobile_app_report_metrics. This keeps the request bounded (no unbounded
      // row scan, no Node-side summation) and correct (installs/crashes come from
      // the overview dimension; store_performance is summed across countries in
      // SQL — so there is no double-counting across alternative breakdowns).
      const daily = await readReportRollups(sql, googleListingIds);
      for (const row of daily) {
        (reports[row.report] ??= []).push({ date: row.date, metrics: row.metrics, source: row.source });
      }

      // Breakdowns are bounded so the main payload can't blow up. A future
      // paginated endpoint can serve the long tail; default cap keeps it small.
      const breakdownLimit = Math.min(Number(searchParams.get("breakdownLimit") ?? 500), 2000);
      const breakdowns = await readLatestBreakdowns(sql, googleListingIds, { limit: breakdownLimit });
      if (breakdowns.length > 0) {
        reports.breakdowns = breakdowns.map((b) => ({
          report: b.report,
          dimension: b.dimension,
          dimension_value: b.dimensionValue,
          date: b.date,
          metrics: b.metrics,
          dimensions: b.dimensions,
        }));
        // Traffic sources are just the store_performance/traffic_source breakdown,
        // already deduped to the latest row per source. Sort by acquisitions.
        const traffic = breakdowns.filter((b) => b.report === "store_performance" && b.dimension === "traffic_source");
        if (traffic.length > 0) {
          reports.traffic_sources = traffic
            .map((t) => ({ dimensions: t.dimensions, metrics: t.metrics }))
            .sort((a, b) => num(b.metrics.store_listing_acquisitions) - num(a.metrics.store_listing_acquisitions));
        }
      }

      // CSV cache index grouped in the UI by year/month. No raw CSV/key material is returned.
      const files = (await sql`
        select report, dimension, object_path, yyyy_mm, generation, size_bytes,
               to_char(downloaded_at, 'YYYY-MM-DD HH24:MI') as downloaded_at,
               to_char(parsed_at, 'YYYY-MM-DD HH24:MI') as parsed_at,
               rows_count, status, error_message
        from mobile_app_report_files
        where listing_id = any(${sql.array(googleListingIds)}::uuid[])
        order by yyyy_mm desc nulls last, report asc, dimension asc, object_path asc
      `) as unknown as Array<Record<string, unknown>>;
      if (files.length > 0) reports.files = files;
    }

    // ── Freshness contract ──
    // Live reviews expose the last recorded sync outcome. Google report freshness is either read cheaply from
    // the stored row (available, browser default — no GCS) or checked live (strict,
    // for skills — metadata only, never downloads). Strict never returns stale charts.
    const consistency = searchParams.get("consistency") === "strict" ? "strict" : "available";
    const liveUpdatedAt = listings.reduce<string | null>((acc, l) => {
      const t = l.last_synced_at ? String(l.last_synced_at) : null;
      return t && (!acc || t > acc) ? t : acc;
    }, null);
    const liveFailed = (syncRuns as Array<{ status?: string }>).some(run => run.status === "failed");
    const liveReviews = { status: liveFailed ? "failed" : liveUpdatedAt ? "fresh" : "unknown", updatedAt: liveUpdatedAt };

    let googleReports: {
      status: ReportFreshnessState;
      latestOfficialMonth: string | null;
      latestProcessedMonth: string | null;
      checkedAt: string | null;
      processedAt: string | null;
    } = { status: "not_configured", latestOfficialMonth: null, latestProcessedMonth: null, checkedAt: null, processedAt: null };
    let reportsFresh = true;
    let strict: { httpStatus: number; jobId: string | null } | null = null;

    if (googleListingIds.length > 0) {
      if (consistency === "strict") {
        const results: FreshnessResult[] = [];
        for (const lid of googleListingIds) {
          results.push(await checkOfficialReportFreshness(sql, lid).catch(() => unknownFreshness()));
        }
        const verdict = summarizeReportFreshness(results.map(r => r.status), googleListingIds.length);
        const worst = verdict.status;
        reportsFresh = verdict.reportsFresh;
        const pick = results.find((r) => r.status === worst) ?? results[0];
        googleReports = {
          status: worst,
          latestOfficialMonth: pick?.latestOfficialYyyyMm ?? null,
          latestProcessedMonth: pick?.latestProcessedYyyyMm ?? null,
          checkedAt: new Date().toISOString(),
          processedAt: null,
        };
        let jobId = results.find((r) => r.status === "refreshing")?.activeJobId ?? null;
        if (results.some((r) => r.status === "stale")) {
          const { job } = await enqueueReportSyncJob(sql, {
            appId: id,
            store: "google",
            mode: "incremental",
            reason: "detail-strict",
            requestedBy: session.email,
          });
          jobId = job.id;
        }
        if (!reportsFresh) strict = { httpStatus: worst === "stale" || worst === "refreshing" ? 202 : 503, jobId };
      } else {
        const stored = await readStoredFreshness(sql, googleListingIds);
        if (stored.length > 0) {
          const verdict = summarizeReportFreshness(stored.map(r => r.status), googleListingIds.length);
          const worst = verdict.status;
          const pick = stored.find((r) => r.status === worst) ?? stored[0];
          reportsFresh = verdict.reportsFresh;
          googleReports = {
            status: worst,
            latestOfficialMonth: pick.latestOfficialYyyyMm,
            latestProcessedMonth: pick.latestProcessedYyyyMm,
            checkedAt: pick.checkedAt,
            processedAt: pick.processedAt,
          };
        } else {
          // No freshness row yet (worker/ensure-fresh hasn't run) → unknown, not stale.
          googleReports = { status: "unknown", latestOfficialMonth: null, latestProcessedMonth: null, checkedAt: null, processedAt: null };
          reportsFresh = false;
        }
      }
    }

    const freshness = { liveReviews, googleReports };

    if (strict) {
      // Strict consumers must not receive stale report charts presented as fresh.
      // Live data (reviews/ratings/trend/summary) is still returned; `reports` is not.
      return NextResponse.json(
        {
          ok: strict.httpStatus !== 503,
          status: googleReports.status,
          fresh: false,
          reportsFresh: false,
          jobId: strict.jobId,
          message:
            strict.httpStatus === 503
              ? "Google Play report freshness could not be verified. Check report configuration and the latest sync result."
              : "Google Play reports are refreshing. Cached live-store data is available.",
          app: appRows[0],
          listings,
          trend,
          syncRuns,
          summary,
          negativeThreshold,
          freshness,
          asOf,
        },
        { status: strict.httpStatus },
      );
    }

    return ok({
      app: appRows[0], listings, trend, syncRuns, summary, negativeThreshold,
      ...(includeReports ? { reports } : {}),
      reportsFresh, freshness, asOf, include: [...include],
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load app", 500);
  }
}
