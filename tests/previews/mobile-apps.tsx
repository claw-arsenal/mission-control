import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AppDetailClient } from "@/components/mobile-apps/app-detail-client";
import { TiptapEditor } from "@/components/documents/tiptap-editor";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "sonner";
import "@/app/globals.css";

let unavailable = false;
let reportStatus = "fresh";
class Events extends EventTarget {
  static all = new Set<Events>();
  constructor() { super(); Events.all.add(this); }
  close() { Events.all.delete(this); }
}
Object.defineProperty(window, "EventSource", { value: Events });
const listing = (store: string) => ({
  id: store, store, store_app_id: store === "google" ? "com.fixture.app" : "123456789", country: "nl",
  current_rating: 4.5, ratings_count: 4200, last_synced_at: "2026-09-07T10:00:00Z",
  rating_source: store === "google" ? "google_play_console_ratings_report" : "apple_app_store_lookup",
  rating_as_of: "2026-09-04", official_ratings: [
    { territory: "nl", avg: 4.5, count: 4200, review_count: 70 },
    { territory: "tr", avg: null, count: null, review_count: 12 },
  ],
});
const reviews = Array.from({ length: 34 }, (_, i) => ({
  id: `review-${i}`, author: `Reviewer ${i + 1}`, rating: i % 3 ? 5 : 2,
  title: i % 3 ? "Easy to use" : "Loading could be faster",
  body: i % 3 ? "Everything I need is easy to find. The latest update is a welcome improvement." : "The dashboard sometimes takes a long time to load on a slow connection.",
  app_version: "2.4.1", country: "nl", submitted_at: "2026-09-05T10:00:00Z", store_response: null,
}));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 400);
    init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
  if (unavailable) return json({ ok: false, error: "The store connection is unavailable. Showing the last available data." }, 503);
  if (url.pathname.endsWith("config-status")) return json({ ok: true, stores: { google: { enabled: true, configured: true }, apple: { enabled: true, configured: true } } });
  if (url.pathname.endsWith("digest")) return json({ ok: true, digests: [] });
  if (url.pathname.endsWith("reports/sync")) { reportStatus = "refreshing"; return json({ ok: true, jobId: "fixture-job", message: "Report sync queued." }, 202); }
  if (url.pathname.endsWith("reports/status")) { reportStatus = "fresh"; return json({ ok: true, jobs: [{ status: "success" }] }); }
  if (url.pathname.endsWith("ensure-fresh") || url.pathname.endsWith("sync")) return json({ ok: true, liveFresh: true });
  if (url.pathname.endsWith("reviews")) {
    const offset = Number(url.searchParams.get("offset") || 0);
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const filtered = reviews.filter(row => !search || `${row.title} ${row.body}`.toLowerCase().includes(search));
    return json({ ok: true, total: filtered.length, reviews: filtered.slice(offset, offset + 30).map(row => ({ ...row, store: url.searchParams.get("store") || "google" })) });
  }
  return json({ ok: true, app: { id: "fixture", name: "Mission Control Companion — International Operations" },
    listings: [listing("google"), listing("apple")], negativeThreshold: 3,
    summary: ["google", "apple"].map(store => ({ store, total: 82, avg_rating: 4.2, r1: 2, r2: 5, r3: 10, r4: 14, r5: 51, negative: 17, responded: 30 })),
    syncRuns: [], trend: [], reports: { installs: [], crashes: [], store_performance: [], traffic_sources: [], files: [], breakdowns: [] },
    freshness: { googleReports: { status: reportStatus, latestOfficialMonth: "202609", latestProcessedMonth: "202609", checkedAt: "2026-09-07", processedAt: "2026-09-07" } },
  });
};

function Preview() {
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [offline, setOffline] = useState(false);
  const [editor, setEditor] = useState(false);
  const [content, setContent] = useState("<p>Operator notes for the next release.</p>");
  return <div className={dark ? "dark" : ""}>
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "Arial, sans-serif", "--header-height": "4rem" } as React.CSSProperties}>
      <nav aria-label="Validation scenarios" className="flex flex-wrap items-center gap-3 border-b p-3 text-sm">
        <span>Local fixtures</span>
        <button className="rounded border px-3 py-1" onClick={() => setDark(!dark)}>Toggle theme</button>
        <button className="rounded border px-3 py-1" onClick={() => setNarrow(!narrow)}>Toggle narrow layout</button>
        <button className="rounded border px-3 py-1" onClick={() => { unavailable = !offline; setOffline(!offline); Events.all.forEach(events => events.dispatchEvent(new MessageEvent("change", { data: "{}" }))); }}>{offline ? "Restore connection" : "Simulate connection failure"}</button>
        <button className="rounded border px-3 py-1" onClick={() => setEditor(!editor)}>{editor ? "Dashboard" : "Document editor"}</button>
      </nav>
      <div className="mx-auto" style={{ maxWidth: narrow ? 390 : 1366 }}>
        {editor ? <div className="h-[600px]"><TiptapEditor content={content} onChange={setContent} ext=".html" /></div>
          : <SidebarProvider><main className="min-w-0 w-full"><AppDetailClient appId="fixture" /></main></SidebarProvider>}
      </div>
      <Toaster />
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
