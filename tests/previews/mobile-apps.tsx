import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AppDetailClient } from "@/components/mobile-apps/app-detail-client";
import { MobileAppsClient } from "@/components/mobile-apps/mobile-apps-client";
import { TiptapEditor } from "@/components/documents/tiptap-editor";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "sonner";
import "@/app/globals.css";

let unavailable = false;
let reportStatus = "fresh";
let reviewCount = 34;
const BASE_REVIEWS = 34;
let publishedAt = new Date().toISOString();

/** Stand-in EventSource so the fixture can publish typed change events. */
class Events extends EventTarget {
  static all = new Set<Events>();
  constructor() {
    super();
    Events.all.add(this);
    setTimeout(() => {
      this.dispatchEvent(new Event("open"));
      this.dispatchEvent(new MessageEvent("hello", { data: JSON.stringify({ serverTime: new Date().toISOString() }) }));
    }, 50);
  }
  close() { Events.all.delete(this); }
}
Object.defineProperty(window, "EventSource", { value: Events });

const publish = (change: Record<string, unknown>) => {
  const data = JSON.stringify({ at: new Date().toISOString(), ...change });
  Events.all.forEach((events) => events.dispatchEvent(new MessageEvent("change", { data })));
};
const dropConnection = () => Events.all.forEach((events) => events.dispatchEvent(new Event("error")));

const listing = (store: string) => ({
  id: store, store, store_app_id: store === "google" ? "com.fixture.app" : "123456789", country: "nl",
  current_rating: 4.5, ratings_count: 4200, last_synced_at: new Date(Date.now() - 4 * 60_000).toISOString(),
  rating_source: store === "google" ? "google_play_console_ratings_report" : "apple_app_store_lookup",
  rating_as_of: "2026-09-04",
  official_ratings: [
    { territory: "nl", avg: 4.5, count: 4200, review_count: 70 },
    { territory: "tr", avg: null, count: null, review_count: 12 },
  ],
});

const makeReviews = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `review-${i}`, author: `Reviewer ${i + 1}`, rating: i % 3 ? 5 : 2,
    title: i % 3 ? "Easy to use" : "Loading could be faster",
    body: i % 3
      ? "Everything I need is easy to find. The latest update is a welcome improvement."
      : "The dashboard sometimes takes a long time to load on a slow connection.",
    app_version: "2.4.1", country: "nl", submitted_at: "2026-09-05T10:00:00Z",
    store_response: i % 5 ? null : "Thanks for the report, this is fixed in 2.4.2.",
    fetched_at: i >= BASE_REVIEWS ? publishedAt : new Date(Date.now() - (count - i) * 60_000).toISOString(),
  }));

const trend = Array.from({ length: 21 }, (_, i) => ({
  store: "google",
  day: new Date(Date.now() - (20 - i) * 86_400_000).toISOString().slice(0, 10),
  avg: 3.6 + Math.sin(i / 3) * 0.5,
  count: 3 + (i % 4),
}));

const reportSeries = (key: string, base: number) =>
  Array.from({ length: 21 }, (_, i) => ({
    date: new Date(Date.now() - (20 - i) * 86_400_000).toISOString().slice(0, 10),
    metrics: { [key]: Math.round(base + Math.sin(i / 2) * base * 0.25), active_device_installs: 48_200 + i * 40, daily_device_uninstalls: 60, daily_anrs: 4 },
  }));

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 400);
    init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
  if (unavailable) return json({ ok: false, error: "The store connection is unavailable. Showing the last available data." }, 503);

  const asOf = new Date().toISOString();
  if (url.pathname.endsWith("config-status")) return json({ ok: true, stores: { google: { enabled: true, configured: true }, apple: { enabled: true, configured: true } } });
  if (url.pathname.endsWith("digest")) return json({ ok: true, digests: [] });
  if (url.pathname.endsWith("reports/sync")) { reportStatus = "refreshing"; publish({ kind: "job", appId: "fixture", jobId: "fixture-job", jobStatus: "running" }); return json({ ok: true, jobId: "fixture-job", status: "queued", message: "Report sync queued." }, 202); }
  if (url.pathname.endsWith("reports/status")) { reportStatus = "fresh"; return json({ ok: true, jobs: [{ status: "success", startedAt: asOf, finishedAt: asOf }] }); }
  if (url.pathname.endsWith("ensure-fresh") || url.pathname.endsWith("/sync")) return json({ ok: true, liveFresh: true });

  if (url.pathname === "/api/mobile-apps") {
    return json({
      ok: true, asOf, negativeThreshold: 3,
      apps: [
        { id: "fixture", name: "Mission Control Companion — International Operations", icon_url: null, notes: null,
          listings: [{ id: "g", store: "google" }, { id: "a", store: "apple" }],
          facts: { reviewsLast7d: 12, negativeLast7d: 3, lastCheckedAt: new Date(Date.now() - 4 * 60_000).toISOString(), syncFailed: false, reportsStatus: reportStatus === "fresh" ? "fresh" : "refreshing" } },
        { id: "second", name: "Field Scanner", icon_url: null, notes: null,
          listings: [{ id: "a2", store: "apple" }],
          facts: { reviewsLast7d: 0, negativeLast7d: 0, lastCheckedAt: null, syncFailed: true, reportsStatus: null } },
      ],
    });
  }

  if (url.pathname.endsWith("/reviews")) {
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 30);
    const search = (url.searchParams.get("q") || "").toLowerCase();
    const fetchedSince = url.searchParams.get("fetchedSince");
    const all = makeReviews(reviewCount);
    let rows = all.filter((row) => !search || `${row.title} ${row.body}`.toLowerCase().includes(search));
    if (url.searchParams.get("responded") === "false") rows = rows.filter((r) => !r.store_response);
    if (fetchedSince) rows = rows.filter((r) => r.fetched_at > fetchedSince);
    return json({ ok: true, asOf, total: rows.length, reviews: rows.slice(offset, offset + limit).map((row) => ({ ...row, store: url.searchParams.get("store") || "google" })) });
  }

  const include = url.searchParams.get("include") ?? "core,reports";
  const reports = include.includes("reports")
    ? {
        installs: reportSeries("daily_device_installs", 900),
        crashes: reportSeries("daily_crashes", 22),
        store_performance: Array.from({ length: 21 }, (_, i) => ({
          date: new Date(Date.now() - (20 - i) * 86_400_000).toISOString().slice(0, 10),
          metrics: { store_listing_visitors: 4000 + i * 25, store_listing_acquisitions: 340 + i * 3 },
        })),
        traffic_sources: [
          { dimensions: { traffic_source: "Play Store search" }, metrics: { store_listing_acquisitions: 2100, store_listing_conversion_rate: 0.31 } },
          { dimensions: { traffic_source: "Third-party referrals" }, metrics: { store_listing_acquisitions: 640, store_listing_conversion_rate: 0.18 } },
        ],
        files: [{ report: "installs", dimension: "overview", object_path: "installs_2026_09.csv", yyyy_mm: "202609", size_bytes: 240_000, rows_count: 620, status: "parsed", downloaded_at: null }],
        breakdowns: [
          { report: "installs", dimension: "country", dimension_value: "nl", date: "2026-09-05", metrics: { active_device_installs: 21_000 } },
          { report: "installs", dimension: "device", dimension_value: "Pixel 8", date: "2026-09-05", metrics: { active_device_installs: 5_100 } },
        ],
      }
    : undefined;

  return json({
    ok: true, asOf, include: include.split(","),
    app: { id: "fixture", name: "Mission Control Companion — International Operations", icon_url: null },
    listings: [listing("google"), listing("apple")],
    negativeThreshold: 3,
    summary: ["google", "apple"].map((store) => ({ store, total: 82, avg_rating: 4.2, r1: 2, r2: 5, r3: 10, r4: 14, r5: 51, negative: 17, responded: 30, needs_reply: 11 })),
    syncRuns: [], trend,
    ...(reports ? { reports } : {}),
    freshness: { googleReports: { status: reportStatus, latestOfficialMonth: "202609", latestProcessedMonth: "202609", checkedAt: "2026-09-07", processedAt: "2026-09-07" } },
  });
};

function Preview() {
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<"detail" | "list" | "editor">("detail");
  const [content, setContent] = useState("<p>Operator notes for the next release.</p>");
  const button = "rounded border px-3 py-1";
  return <div className={dark ? "dark" : ""}>
    <div className="min-h-screen bg-background text-foreground" style={{ "--header-height": "4rem" } as React.CSSProperties}>
      <nav aria-label="Validation scenarios" className="flex flex-wrap items-center gap-3 border-b p-3 text-sm">
        <span>Local fixtures</span>
        <button className={button} onClick={() => setDark(!dark)}>Toggle theme</button>
        <button className={button} onClick={() => setNarrow(!narrow)}>Toggle narrow layout</button>
        <button className={button} onClick={() => setView(view === "detail" ? "list" : "detail")}>{view === "list" ? "App detail" : "App list"}</button>
        <button className={button} onClick={() => {
          const next = !offline;
          unavailable = next;
          setOffline(next);
          if (next) dropConnection(); else Events.all.forEach((e) => e.dispatchEvent(new Event("open")));
        }}>{offline ? "Restore connection" : "Simulate connection failure"}</button>
        <button className={button} onClick={() => { reviewCount += 3; publishedAt = new Date().toISOString(); publish({ kind: "reviews", appId: "fixture", inserted: 3 }); }}>Publish 3 new reviews</button>
        <button className={button} onClick={() => publish({ kind: "reports", appId: "fixture", listingId: "google", store: "google" })}>Publish a report change</button>
        <button className={button} onClick={() => setView(view === "editor" ? "detail" : "editor")}>{view === "editor" ? "Dashboard" : "Document editor"}</button>
      </nav>
      <div className="mx-auto" style={{ maxWidth: narrow ? 390 : 1366 }}>
        {view === "editor"
          ? <div className="h-[600px]"><TiptapEditor content={content} onChange={setContent} ext=".html" /></div>
          : <SidebarProvider><main className="min-w-0 w-full">
              {view === "list" ? <MobileAppsClient /> : <AppDetailClient appId="fixture" />}
            </main></SidebarProvider>}
      </div>
      <Toaster />
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
