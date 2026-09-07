import { NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { ensureMobileAppsSchema } from "@/lib/mobile-apps/ensure-schema";
import { enqueueReportSyncJob } from "@/lib/mobile-apps/report-jobs";

export const dynamic = "force-dynamic";

const fail = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error: message, ...extra }, { status });

const bodySchema = z.object({
  appId: z.string().uuid().optional(),
  listingId: z.string().uuid().optional(),
  store: z.enum(["google", "apple"]).optional(),
  mode: z.enum(["incremental", "backfill"]).optional(),
  reason: z.string().max(64).optional(),
});

/**
 * API-safe way to request a heavy Google Play report refresh. This endpoint does
 * NOT download or parse any CSV: it only enqueues a job that the detached
 * cron-drained worker picks up, then returns 202 + jobId immediately. No detached
 * process is spawned from Next.js.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.email) return fail("Not authenticated", 401);
    if (!(await isModuleEnabled("mobile-apps")))
      return fail("Mobile Applications module is disabled. Enable it in Settings.", 503);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Invalid report sync request.", 422);

    const sql = getSql();
    await ensureMobileAppsSchema(sql);

    // If a specific app is named, verify it belongs to the workspace before queuing
    // any work for it (don't let a guessed UUID enqueue a job for someone else's app).
    if (parsed.data.appId) {
      const wsRows = (await sql`select id from workspaces order by created_at asc limit 1`) as unknown as Array<{ id: string }>;
      const owned = (await sql`
        select id from mobile_apps where id = ${parsed.data.appId}::uuid and workspace_id = ${wsRows[0]?.id ?? null}::uuid limit 1
      `) as unknown as Array<{ id: string }>;
      if (!owned[0]) return fail("App not found", 404);
    }

    if (parsed.data.listingId) {
      const listings = (await sql`
        select l.mobile_app_id::text as "appId", l.store
        from mobile_app_listings l
        join mobile_apps a on a.id = l.mobile_app_id
        where l.id = ${parsed.data.listingId}::uuid
          and a.workspace_id = (select id from workspaces order by created_at asc limit 1)
          and (${parsed.data.appId ?? null}::uuid is null or a.id = ${parsed.data.appId ?? null}::uuid)
          and (${parsed.data.store ?? null}::text is null or l.store = ${parsed.data.store ?? null})
      `) as unknown as Array<{ appId: string; store: "google" | "apple" }>;
      if (!listings[0]) return fail("Listing not found", 404);
      parsed.data.appId = listings[0].appId;
      parsed.data.store = listings[0].store;
    }

    const { job, reused } = await enqueueReportSyncJob(sql, {
      appId: parsed.data.appId ?? null,
      listingId: parsed.data.listingId ?? null,
      store: parsed.data.store ?? null,
      mode: parsed.data.mode ?? "incremental",
      reason: parsed.data.reason ?? "api",
      requestedBy: session.email,
    });

    const running = job.status === "running";
    return NextResponse.json(
      {
        ok: true,
        status: job.status,
        jobId: job.id,
        reused,
        message: running
          ? "A report sync is already running."
          : reused
            ? "A report sync is already queued."
            : "Report sync queued.",
        poll: `/api/mobile-apps/reports/status?jobId=${job.id}`,
      },
      { status: 202 },
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to queue report sync", 500);
  }
}
