import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { resolveListing } from "@/lib/mobile-apps/resolve";
import { isUuid } from "@/lib/mobile-apps/ids";
import { syncApp } from "@/lib/mobile-apps/sync";
import { ensureMobileAppsSchema } from "@/lib/mobile-apps/ensure-schema";
import { loadMobileReviewsConfig } from "@/lib/mobile-apps/config";
import { summarizeReportFreshness, type ReportFreshnessState } from "@/lib/mobile-apps/report-freshness";
import { publishChange } from "@/lib/mobile-apps/change-events";

export const dynamic = "force-dynamic";

const ok = (data: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = (await sql`select id from workspaces order by created_at asc limit 1`) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.email) return fail("Not authenticated", 401);
    if (!(await isModuleEnabled("mobile-apps")))
      return fail("Mobile Applications module is disabled. Enable it in Settings.", 503);

    const sql = getSql();
    await ensureMobileAppsSchema(sql);
    const wid = await workspaceId(sql);
    if (!wid) return ok({ apps: [], asOf: new Date().toISOString() });
    const negativeThreshold = loadMobileReviewsConfig().sync.negativeThreshold;

    // Facts only, never a rating: a single headline rating per app is ambiguous
    // across stores and sources. Activity, sync health and report freshness are
    // honest signals an operator can scan a list by.
    const apps = await sql`
      with latest_run as (
        select distinct on (run.listing_id) run.listing_id, run.status
        from app_review_sync_runs run
        order by run.listing_id, run.started_at desc
      ),
      recent as (
        select l.mobile_app_id,
               count(*) filter (where r.submitted_at >= now() - interval '7 days')::int as reviews_last_7d,
               count(*) filter (where r.submitted_at >= now() - interval '7 days' and r.rating is not null and r.rating <= ${negativeThreshold})::int as negative_last_7d,
               max(r.fetched_at) as latest_fetched_at
        from app_reviews r join mobile_app_listings l on l.id = r.listing_id
        group by l.mobile_app_id
      )
      select
        a.id::text,
        a.name,
        a.icon_url,
        a.notes,
        coalesce(
          json_agg(
            json_build_object(
              'id', l.id::text,
              'store', l.store,
              'storeAppId', l.store_app_id,
              'country', l.country,
              'currentRating', l.current_rating,
              'ratingsCount', l.ratings_count,
              'lastSyncedAt', l.last_synced_at,
              'syncFailed', coalesce(lr.status = 'failed', false),
              'reportsStatus', case when l.store = 'google' then coalesce(f.status, 'unknown') else null end
            ) order by l.store
          ) filter (where l.id is not null),
          '[]'
        ) as listings,
        json_build_object(
          'reviewsLast7d', coalesce(max(rc.reviews_last_7d), 0),
          'negativeLast7d', coalesce(max(rc.negative_last_7d), 0),
          'lastCheckedAt', max(l.last_synced_at),
          'latestFetchedAt', max(rc.latest_fetched_at),
          'syncFailed', bool_or(coalesce(lr.status = 'failed', false)),
          'reportStatuses', coalesce(json_agg(coalesce(f.status, 'unknown')) filter (where l.store = 'google'), '[]')
        ) as facts
      from mobile_apps a
      left join mobile_app_listings l on l.mobile_app_id = a.id
      left join latest_run lr on lr.listing_id = l.id
      left join mobile_app_report_freshness f on f.listing_id = l.id
      left join recent rc on rc.mobile_app_id = a.id
      where a.workspace_id = ${wid}::uuid
      group by a.id
      order by a.created_at asc
    `;
    // Freshness priority (failed > stale > refreshing > unknown > not_configured > fresh)
    // is not alphabetical, so the worst status is summarized in Node.
    const shaped = (apps as unknown as Array<Record<string, unknown> & { facts: Record<string, unknown> & { reportStatuses?: unknown } }>).map((app) => {
      const { reportStatuses, ...facts } = app.facts ?? {};
      const statuses = Array.isArray(reportStatuses) ? (reportStatuses as ReportFreshnessState[]) : [];
      return { ...app, facts: { ...facts, reportsStatus: statuses.length ? summarizeReportFreshness(statuses).status : null } };
    });
    return ok({ apps: shaped, asOf: new Date().toISOString(), negativeThreshold });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to list apps", 500);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.email) return fail("Not authenticated", 401);
    if (!(await isModuleEnabled("mobile-apps")))
      return fail("Mobile Applications module is disabled. Enable it in Settings.", 503);

    const sql = getSql();
    await ensureMobileAppsSchema(sql);
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const body = (await request.json()) as { name?: string; refs?: string[] };
    const refs = (Array.isArray(body.refs) ? body.refs : []).map((s) => String(s || "").trim()).filter(Boolean);
    if (refs.length === 0) return fail("Provide at least one App Store or Play Store URL/ID.");
    if (refs.length > 10) return fail("Too many app references (max 10).");
    if (refs.some((r) => r.length > 500)) return fail("App reference is too long (max 500 characters).");

    // Resolve all refs first so a bad one fails before we create anything.
    let resolved: ReturnType<typeof resolveListing>[];
    try {
      resolved = refs.map(resolveListing);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Invalid app reference", 400);
    }

    // The official publisher APIs are review-only and expose no store listing
    // metadata, so we name the app from the provided name or its store id.
    const name = (String(body.name || "").trim() || resolved[0].storeAppId || "Untitled app").slice(0, 200);
    const iconUrl: string | null = null;

    const appRows = (await sql`
      insert into mobile_apps (workspace_id, name, icon_url)
      values (${wid}::uuid, ${name}, ${iconUrl})
      returning id::text
    `) as unknown as Array<{ id: string }>;
    const appId = appRows[0].id;

    for (const r of resolved) {
      await sql`
        insert into mobile_app_listings (mobile_app_id, store, store_app_id, country)
        values (${appId}::uuid, ${r.store}, ${r.storeAppId}, ${r.country})
        on conflict (mobile_app_id, store) do nothing
      `;
    }

    // Kick off an immediate forced LIGHT sync so the app isn't empty on first view.
    // Heavy Google report ETL and the full Apple storefront scan are worker-owned.
    await publishChange(sql, { kind: "app", appId });
    await syncApp(appId, { force: true, syncReports: false, syncAppleStorefronts: false }).catch(() => null);

    return ok({ id: appId, name });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to add app", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session?.email) return fail("Not authenticated", 401);
    if (!(await isModuleEnabled("mobile-apps")))
      return fail("Mobile Applications module is disabled. Enable it in Settings.", 503);

    const sql = getSql();
    await ensureMobileAppsSchema(sql);
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);
    const body = (await request.json()) as { id?: string };
    const id = String(body.id || "");
    if (!id) return fail("App id is required.");
    if (!isUuid(id)) return fail("Invalid app id.");
    await sql`delete from mobile_apps where id = ${id}::uuid and workspace_id = ${wid}::uuid`;
    await publishChange(sql, { kind: "app", appId: id });
    return ok();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to delete app", 500);
  }
}
