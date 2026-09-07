import { existsSync } from "node:fs";
import { config } from "dotenv";

for (const file of [".env.local", ".env"]) if (existsSync(file)) config({ path: file });

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--once", "--watch"].includes(arg)) || args.length > 1) throw new Error("Use --once or --watch.");
  const { getSql, closeSql } = await import("@/lib/local-db");
  const { pollMobileReviews, deliverMobileReviewAlerts } = await import("@/lib/mobile-apps/review-monitor");
  const sql = getSql();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
  const report = (task: string) => () => console.error(`[mobile-reviews] ${task} failed. Check the database and server configuration.`);
  if (args[0] === "--once") {
    try { await pollMobileReviews(sql); await deliverMobileReviewAlerts(sql); }
    finally { await closeSql(); }
    return;
  }
  let sending: Promise<void> | null = null;
  const deliver = () => {
    if (!sending && !stopping) sending = deliverMobileReviewAlerts(sql).catch(report("delivery")).finally(() => { sending = null; });
    return sending;
  };
  const listener = await sql.listen("mobile_review_alerts", () => { void deliver(); });
  const interval = setInterval(() => { void deliver(); }, 5000);
  try {
    while (!stopping) {
      await pollMobileReviews(sql).catch(report("polling"));
      for (let i = 0; i < 5 && !stopping; i++) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally { clearInterval(interval); await listener.unlisten(); await sending; await closeSql(); }
}

main().catch(() => { console.error("[mobile-reviews] Startup failed. Check DATABASE_URL and worker configuration."); process.exitCode = 1; });
