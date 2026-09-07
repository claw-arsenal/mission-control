import { getSql } from "@/lib/local-db";
import { isModuleEnabled } from "@/lib/modules/state";
import { ensureReviewAlertSchema } from "./review-alert-schema";
import { syncApp } from "./sync";
import { reviewAlertConfigSchema, type ReviewAlertPayload } from "./review-alert-config";
import { DeliveryError, sendReviewAlert } from "./review-alert-delivery";

type Sql = ReturnType<typeof getSql>;
export type MonitorDeps = { enabled: () => Promise<boolean>; sync: typeof syncApp; send: typeof sendReviewAlert };
const dependencies: MonitorDeps = { enabled: () => isModuleEnabled("mobile-apps"), sync: syncApp, send: sendReviewAlert };

async function withLock(sql: Sql, name: string, run: () => Promise<void>) {
  const connection = await sql.reserve();
  let locked = false;
  try {
    const [result] = await connection`select pg_try_advisory_lock(hashtext(${name})) as locked`;
    locked = Boolean(result.locked);
    if (locked) await run();
  } finally {
    try { if (locked) await connection`select pg_advisory_unlock(hashtext(${name}))`; }
    finally { connection.release(); }
  }
}

export async function pollMobileReviews(sql: Sql = getSql(), deps: MonitorDeps = dependencies) {
  if (!(await deps.enabled())) return;
  await ensureReviewAlertSchema(sql);
  await withLock(sql, "mobile_review_poll", async () => {
    await sql`update mobile_review_settings set heartbeat_at = now()`;
    const workspaces = await sql`select workspace_id, config from mobile_review_settings where next_poll_at <= now()`;
    for (const workspace of workspaces) {
      const config = reviewAlertConfigSchema.parse(workspace.config);
      if (!config.monitoring) continue;
      let delay = config.pollSeconds;
      const errors: string[] = [];
      await sql`update mobile_review_settings set next_poll_at = now() + interval '5 minutes' where workspace_id = ${workspace.workspace_id}`;
      const heartbeat = setInterval(() => { void sql`update mobile_review_settings set heartbeat_at = now() where workspace_id = ${workspace.workspace_id}`.catch(() => {}); }, 15_000);
      try {
        const apps = await sql`select id from mobile_apps where workspace_id = ${workspace.workspace_id}`;
        for (const app of apps) {
          if (!(await deps.enabled())) break;
          const results = await deps.sync(app.id, { dedupeMs: config.pollSeconds * 1000, syncReports: false, syncAppleStorefronts: false });
          for (const result of results) {
            // Google allows 200 reads/app/hour. Large paginated feeds need a slower cadence.
            if (result.store === "google") delay = Math.max(delay, Math.ceil(result.fetched / 100) * 30);
            if (result.status === "failed") errors.push(`${result.store}: ${result.error || "Review refresh failed."}`);
          }
        }
      } catch { errors.push("Review polling failed. Check the server connection and store configuration."); }
      finally { clearInterval(heartbeat); }
      if (errors.length) delay = Math.max(delay, 300);
      await sql`update mobile_review_settings set last_checked_at = now(), heartbeat_at = now(),
        next_poll_at = now() + ${delay} * interval '1 second', last_error = ${errors.length ? errors.join(" ").slice(0, 1500) : null}
        where workspace_id = ${workspace.workspace_id}`;
    }
  });
}

export async function deliverMobileReviewAlerts(sql: Sql = getSql(), deps: MonitorDeps = dependencies) {
  if (!(await deps.enabled())) return;
  await ensureReviewAlertSchema(sql);
  await withLock(sql, "mobile_review_delivery", async () => {
    // An abandoned send may have reached its recipient. Never blindly retry it.
    await sql`update mobile_review_deliveries set status = 'uncertain', updated_at = now(),
      error = 'Worker stopped during delivery. Verify the destination before sending again.'
      where status = 'sending'`;
    await sql`update mobile_review_deliveries d set status = 'cancelled', updated_at = now()
      from mobile_review_settings s where d.workspace_id = s.workspace_id and d.status = 'pending'
      and (d.generation <> s.generation or not (s.config->>'monitoring')::boolean)`;
    for (let count = 0; count < 25; count++) {
      if (!(await deps.enabled())) break;
      const [delivery] = await sql`update mobile_review_deliveries set status = 'sending', attempts = attempts + 1, updated_at = now()
        where id = (select d.id from mobile_review_deliveries d join mobile_review_settings s on s.workspace_id = d.workspace_id
          where d.status = 'pending' and d.next_attempt_at <= now() and d.generation = s.generation and (s.config->>'monitoring')::boolean
          order by d.created_at limit 1 for update of d skip locked)
        returning *`;
      if (!delivery) break;
      try {
        await deps.send(delivery.channel, delivery.recipient, delivery.payload as ReviewAlertPayload);
        await sql`update mobile_review_deliveries set status = 'sent', error = null, updated_at = now() where id = ${delivery.id}`;
      } catch (error) {
        const outcome = error instanceof DeliveryError ? error.outcome : "uncertain";
        const status = outcome === "retry" ? (delivery.attempts < 5 ? "pending" : "failed") : outcome;
        const message = error instanceof DeliveryError ? error.message : "Delivery outcome is unknown. Verify the destination before sending again.";
        await sql`update mobile_review_deliveries set status = ${status}, error = ${message}, updated_at = now(),
          next_attempt_at = now() + ${Math.min(3600, 60 * 2 ** delivery.attempts)} * interval '1 second'
          where id = ${delivery.id}`;
      }
    }
  });
}
