import { NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { ensureMobileAppsSchema } from "@/lib/mobile-apps/ensure-schema";
import { syncApp } from "@/lib/mobile-apps/sync";
import { checkOfficialReportFreshness, readStoredFreshness, summarizeReportFreshness, type FreshnessResult } from "@/lib/mobile-apps/report-freshness";
import { enqueueReportSyncJob } from "@/lib/mobile-apps/report-jobs";
import { isUuid } from "@/lib/mobile-apps/ids";

export const dynamic = "force-dynamic";

const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = (await sql`select id from workspaces order by created_at asc limit 1`) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

const bodySchema = z.object({
  consistency: z.enum(["strict", "available"]).default("available"),
  includeReports: z.boolean().default(true),
  // Force the live store call even if the listing synced within the dedupe window.
  // Page opens leave this false: the review monitor already polls every store.
  force: z.boolean().default(false),
  // Reuse a stored report-freshness verdict younger than this instead of listing GCS.
  reportMaxAgeSeconds: z.number().int().min(0).max(86_400).default(300),
});

/** A stored verdict that is recent and settled needs no new GCS listing. */
export function canReuseStoredFreshness(row: { status: string; checkedAt: string | null }, maxAgeSeconds: number, now = Date.now()): boolean {
  if (!row.checkedAt) return false;
  if (row.status === "stale" || row.status === "unknown") return false;
  const checked = Date.parse(row.checkedAt);
  return Number.isFinite(checked) && now - checked <= maxAgeSeconds * 1000;
}

/**
 * The API-first freshness control plane. Refreshes light live sources (reviews +
 * primary rating) immediately, then cheaply checks whether the heavy Google Play
 * reports are fresh. If they are stale it queues the detached worker. It never does
 * heavy ETL itself and — in strict mode — never returns stale report data as fresh.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.email) return fail("Not authenticated", 401);
    if (!(await isModuleEnabled("mobile-apps")))
      return fail("Mobile Applications module is disabled. Enable it in Settings.", 503);

    const { id } = await params;
    if (!isUuid(id)) return fail("App not found", 404);
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid ensure-fresh request.", 422);
    const { consistency, includeReports, force, reportMaxAgeSeconds } = parsed.data;

    const sql = getSql();
    await ensureMobileAppsSchema(sql);
    const wid = await workspaceId(sql);
    if (!wid) return fail("App not found", 404);
    const appRows = (await sql`
      select id from mobile_apps where id = ${id}::uuid and workspace_id = ${wid}::uuid limit 1
    `) as unknown as Array<{ id: string }>;
    if (!appRows[0]) return fail("App not found", 404);

    const listings = (await sql`
      select id::text, store from mobile_app_listings where mobile_app_id = ${id}::uuid
    `) as unknown as Array<{ id: string; store: string }>;
    const googleListings = listings.filter((l) => l.store === "google");

    // 1. Light live sync — reviews + primary rating only, both stores. Never heavy.
    let liveError: string | null = null;
    const liveResults = await syncApp(id, { force, syncReports: false, syncAppleStorefronts: false }).catch((error) => {
      liveError = error instanceof Error ? error.message : "Live store refresh failed.";
      return [];
    });
    const liveFresh = !liveError && liveResults.every(result => result.status !== "failed");
    if (!liveFresh && !liveError) liveError = liveResults.find(result => result.status === "failed")?.error ?? "A store could not be refreshed.";

    // 2. Cheap official-report freshness check per Google listing (metadata only).
    const results: Array<{ listingId: string } & FreshnessResult> = [];
    if (includeReports) {
      const stored = force ? [] : await readStoredFreshness(sql, googleListings.map((l) => l.id)).catch(() => []);
      for (const l of googleListings) {
        const recent = stored.find((row) => row.listingId === l.id);
        if (recent && canReuseStoredFreshness(recent, reportMaxAgeSeconds)) {
          results.push({
            listingId: l.id,
            status: recent.status,
            needsWorker: false,
            latestOfficialYyyyMm: recent.latestOfficialYyyyMm,
            latestProcessedYyyyMm: recent.latestProcessedYyyyMm,
            latestOfficialGeneration: null,
            latestProcessedGeneration: null,
            activeJobId: recent.activeJobId,
            warnings: [],
          });
          continue;
        }
        const r = await checkOfficialReportFreshness(sql, l.id).catch(
          () =>
            ({
              status: "unknown",
              needsWorker: false,
              latestOfficialYyyyMm: null,
              latestProcessedYyyyMm: null,
              latestOfficialGeneration: null,
              latestProcessedGeneration: null,
              activeJobId: null,
              warnings: [],
            }) satisfies FreshnessResult,
        );
        results.push({ listingId: l.id, ...r });
      }
    }

    const { status: worst, reportsFresh } = summarizeReportFreshness(results.map(r => r.status), includeReports ? googleListings.length : 0);

    // 3. Queue the worker if any listing is stale (not on 'failed' — avoid retry spam).
    let jobId: string | null = results.find((r) => r.status === "refreshing")?.activeJobId ?? null;
    if (results.some((r) => r.status === "stale")) {
      const { job } = await enqueueReportSyncJob(sql, {
        appId: id,
        store: "google",
        mode: "incremental",
        reason: "ensure-fresh",
        requestedBy: session.email,
      });
      jobId = job.id;
    }

    const freshness = {
      liveReviews: { status: liveFresh ? "fresh" : "failed", error: liveError },
      googleReports: {
        status: worst,
        reportsFresh,
        listings: results.map((r) => ({
          listingId: r.listingId,
          status: r.status,
          latestOfficialMonth: r.latestOfficialYyyyMm,
          latestProcessedMonth: r.latestProcessedYyyyMm,
        })),
      },
    };

    if (consistency === "strict") {
      if (!liveFresh) {
        return NextResponse.json({ ok: false, status: "failed", fresh: false, liveFresh, reportsFresh, error: liveError, freshness }, { status: 503 });
      }
      if (reportsFresh) {
        return NextResponse.json({ ok: true, status: "fresh", fresh: true, freshness });
      }
      if (worst === "failed" || worst === "unknown" || worst === "not_configured") {
        return NextResponse.json(
          { ok: false, status: worst, fresh: false, error: worst === "not_configured" ? "Google Play reports are not configured." : "Report freshness could not be verified.", freshness },
          { status: 503 },
        );
      }
      return NextResponse.json(
        {
          ok: true,
          status: "refreshing",
          fresh: false,
          jobId,
          retryAfterSeconds: 5,
          message: "Live data is fresh. Google Play reports are refreshing from the latest official CSVs.",
          freshness,
        },
        { status: 202 },
      );
    }

    // available: never block; report the truth so the UI can label "refreshing".
    return NextResponse.json({ ok: true, status: worst, fresh: liveFresh && reportsFresh, liveFresh, reportsFresh, jobId, freshness });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to ensure freshness", 500);
  }
}
