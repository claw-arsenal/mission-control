import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      const pending = new Set<string>();

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

      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Heartbeat every 25s
      const heartbeat = setInterval(() => send("ping", "keepalive"), 25_000);

      let unlistenMobileApps: (() => Promise<void>) | null = null;

      signal.addEventListener("abort", cleanup, { once: true });
      if (signal.aborted) { cleanup(); return; }

      // Send initial connected event
      send("connected", JSON.stringify({ ts: Date.now() }));

      // Listen for mobile app sync changes
      try {
        const meta = await sql.listen("mobile_apps_change", (payload: string) => {
          if (closed) return;
          pending.add(String(payload || "{}"));
          // A bulk import commits many rows. Bound browser refreshes while retaining app scope.
          if (!flushTimer) flushTimer = setTimeout(() => {
            flushTimer = null;
            for (const payload of pending) send("change", payload);
            pending.clear();
          }, 500);
        });
        unlistenMobileApps = () => meta.unlisten();
        if (closed) await meta.unlisten();
      } catch {
        /* graceful degradation */
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
