import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { CHANGE_CHANNEL, coalesceChanges, parseChange, type MobileAppsChange } from "@/lib/mobile-apps/change-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How long a burst of notifications is held before one coalesced flush. */
const FLUSH_WINDOW_MS = 500;
/** Browser reconnect delay after a dropped connection. */
const RETRY_MS = 3000;
const HEARTBEAT_MS = 25_000;

export async function GET(request: Request): Promise<Response> {
  // Same gate as every other mobile-apps route: no unauthenticated stream, and no
  // stream while the module is disabled (it would hold a DB LISTEN connection open
  // and leak app-change events / app ids).
  const session = await getSession();
  if (!session?.email) return new Response("Not authenticated", { status: 401 });
  if (!(await isModuleEnabled("mobile-apps")))
    return new Response("Mobile Applications module is disabled.", { status: 503 });

  const sql = getSql();
  const encoder = new TextEncoder();
  const { signal } = request;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cleanupStarted = false;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let eventId = 0;
      const pending: MobileAppsChange[] = [];

      const cleanup = () => {
        if (cleanupStarted) return;
        cleanupStarted = true;
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (flushTimer) clearTimeout(flushTimer);
        if (unlistenMobileApps) unlistenMobileApps().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const write = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          cleanup();
        }
      };
      const send = (event: string, data: string, withId = false) =>
        write(`${withId ? `id: ${++eventId}\n` : ""}event: ${event}\ndata: ${data}\n\n`);

      const heartbeat = setInterval(() => send("ping", "keepalive"), HEARTBEAT_MS);

      let unlistenMobileApps: (() => Promise<void>) | null = null;

      signal.addEventListener("abort", cleanup, { once: true });
      if (signal.aborted) { cleanup(); return; }

      // First frame: reconnect policy + server clock so clients can set watermarks.
      write(`retry: ${RETRY_MS}\n`);
      send("hello", JSON.stringify({ serverTime: new Date().toISOString() }));

      const flush = () => {
        flushTimer = null;
        const batch = coalesceChanges(pending.splice(0, pending.length));
        for (const change of batch) send("change", JSON.stringify(change), true);
      };

      try {
        const meta = await sql.listen(CHANGE_CHANNEL, (payload: string) => {
          if (closed) return;
          const change = parseChange(String(payload || ""));
          if (!change) return;
          pending.push(change);
          // A bulk import commits many rows; bound browser work to one flush per window.
          if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_WINDOW_MS);
        });
        unlistenMobileApps = () => meta.unlisten();
        if (closed) await meta.unlisten();
      } catch {
        /* graceful degradation: the client falls back to revalidation on focus/online */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
