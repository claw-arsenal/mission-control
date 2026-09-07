import { NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { getSessionRole } from "@/lib/auth/roles";
import { isModuleEnabled } from "@/lib/modules/state";
import { ensureReviewAlertSchema } from "@/lib/mobile-apps/review-alert-schema";
import { reviewAlertConfigSchema } from "@/lib/mobile-apps/review-alert-config";
import { reviewChannelReadiness } from "@/lib/mobile-apps/review-alert-delivery";
import { loadMobileReviewsConfig, publicConfigStatus } from "@/lib/mobile-apps/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

async function context() {
  const session = await getSession();
  if (!session?.email) return fail("Not authenticated", 401);
  if (await getSessionRole(session) !== "admin") return fail("Admin role required to manage review notification recipients.", 403);
  const sql = getSql();
  const [workspace] = await sql`select id from workspaces order by created_at asc limit 1`;
  if (!workspace) return fail("Workspace not found", 404);
  await ensureReviewAlertSchema(sql);
  return { sql, workspaceId: workspace.id as string, email: session.email };
}

export async function GET() {
  try {
    const ctx = await context();
    if (ctx instanceof Response) return ctx;
    const { sql, workspaceId } = ctx;
    const [settings] = await sql`select config, generation, alerts_since, updated_at, heartbeat_at, last_checked_at, next_poll_at, last_error
      from mobile_review_settings where workspace_id = ${workspaceId}`;
    const deliveries = await sql`select id, channel, recipient, status, attempts, created_at, updated_at, error
      from mobile_review_deliveries where workspace_id = ${workspaceId} order by created_at desc limit 20`;
    return NextResponse.json({ ok: true, settings, deliveries, channels: await reviewChannelReadiness(),
      moduleEnabled: await isModuleEnabled("mobile-apps"), stores: publicConfigStatus(loadMobileReviewsConfig()) });
  } catch { return fail("Could not load review notification settings. Check the server connection.", 500); }
}

export async function PUT(request: Request) {
  try {
    const ctx = await context();
    if (ctx instanceof Response) return ctx;
    const parsed = z.object({ config: reviewAlertConfigSchema, generation: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(parsed.error.issues.map(issue => issue.message).join(" "), 422);
    const { sql, workspaceId, email } = ctx;
    const result = await sql`update mobile_review_settings set config = ${JSON.stringify(parsed.data.config)}::text::jsonb,
      generation = gen_random_uuid(), alerts_since = now(), updated_at = now(), updated_by = ${email}, next_poll_at = now()
      where workspace_id = ${workspaceId} and generation = ${parsed.data.generation}::uuid returning generation`;
    if (!result.length) return fail("Settings changed in another session. Reload before saving.", 409);
    await sql`select pg_notify('mobile_review_alerts', ${workspaceId})`.catch(() => {});
    return NextResponse.json({ ok: true, generation: result[0].generation });
  } catch { return fail("Could not save review notification settings. Check the server connection.", 500); }
}
