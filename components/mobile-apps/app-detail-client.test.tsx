// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MobileAppsStoreProvider } from "@/components/mobile-apps/store-provider";
import { createMobileAppsStore, type StoreDeps, type StreamHandlers } from "@/lib/mobile-apps/client/live-store";
import { AppDetailClient } from "./app-detail-client";

vi.mock("@/components/modules/modules-provider", () => ({ useModules: () => ({ ready: true, isEnabled: () => true }) }));

// One in-memory URL so the tabs and filters can be asserted through it.
let search = new URLSearchParams();
const replace = vi.fn((href: string) => {
  search = new URL(href, "http://localhost").searchParams;
  listeners.forEach((l) => l());
});
const listeners = new Set<() => void>();
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouter: () => ({ replace, push: vi.fn() }),
    usePathname: () => "/mobile-apps/A1",
    useSearchParams: () =>
      useSyncExternalStore((l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => search, () => search),
  };
});

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

/** Re-applied per test: afterEach clears globals along with the fetch stub. */
function stubBrowserApis() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
}

const listing = (store: string) => ({
  id: `L-${store}`, store, store_app_id: store === "google" ? "com.x" : "123", country: "nl",
  current_rating: 4.4, ratings_count: 100, official_ratings: [], rating_source: null, rating_as_of: null,
  store_metadata: null, last_synced_at: new Date(Date.now() - 120_000).toISOString(),
});

const detail = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  app: { id: "A1", name: "Fixture App", icon_url: null },
  listings: [listing("google"), listing("apple")],
  summary: [{ store: "google", total: 80, avg_rating: 4.2, r1: 2, r2: 3, r3: 5, r4: 20, r5: 50, negative: 10, responded: 20, needs_reply: 6, latest_review_at: null }],
  trend: [], syncRuns: [], negativeThreshold: 3,
  freshness: { googleReports: { status: "fresh", latestOfficialMonth: "202609", latestProcessedMonth: "202609", checkedAt: null, processedAt: null } },
  asOf: new Date().toISOString(),
  ...extra,
});

const reviewsPayload = { ok: true, reviews: [], total: 0, asOf: new Date().toISOString() };

/** Radix tab triggers activate on mousedown, not on a synthetic click. */
const selectTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name }));

function setup(router?: StoreDeps["fetchJson"]) {
  let handlers: StreamHandlers | null = null;
  const calls: string[] = [];
  const fetchJson: StoreDeps["fetchJson"] = async (url, init) => {
    calls.push(url);
    if (router) return router(url, init);
    if (url.endsWith("ensure-fresh")) return { ok: true, liveFresh: true };
    if (url.includes("/reviews")) return reviewsPayload;
    if (url.includes("include=reports")) return detail({ reports: { installs: [], crashes: [], store_performance: [], traffic_sources: [], files: [], breakdowns: [] } });
    return detail();
  };
  const store = createMobileAppsStore({
    fetchJson,
    openStream: (_url, h) => { handlers = h; return vi.fn(); },
    storage: { read: () => null, write: () => {} },
    now: () => Date.now(),
    online: () => true,
  });
  // The reviews feed goes through window.fetch, not the store.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(reviewsPayload))));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SidebarProvider><MobileAppsStoreProvider store={store}>{children}</MobileAppsStoreProvider></SidebarProvider>
  );
  return { store, wrapper, calls, stream: () => handlers! };
}

beforeEach(() => { stubBrowserApis(); search = new URLSearchParams(); replace.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("app detail", () => {
  it("opens on Reviews and records the section in the URL when switching", async () => {
    const { wrapper } = setup();
    render(<AppDetailClient appId="A1" />, { wrapper });
    await screen.findByRole("heading", { name: "Fixture App", level: 1 });
    expect(screen.getByRole("tab", { name: /Reviews/ })).toHaveProperty("dataset.state", "active");
    selectTab(/Ratings/);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/mobile-apps/A1?tab=ratings", { scroll: false }));
    expect(await screen.findByLabelText("Selected rating")).toBeTruthy();
  });

  it("offers Reports only for Google and fetches that slice on first visit", async () => {
    const { wrapper, calls } = setup();
    render(<AppDetailClient appId="A1" />, { wrapper });
    await screen.findByRole("heading", { name: "Fixture App", level: 1 });
    expect(calls.some((u) => u.includes("include=reports"))).toBe(false);
    expect(screen.getByRole("tab", { name: /Reports/ })).toBeTruthy();

    // Visiting Reports fetches only the heavy slice, leaving the core payload alone.
    selectTab(/Reports/);
    await waitFor(() => expect(calls.filter((u) => u.includes("include=reports"))).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /App Store/ }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Reports/ })).toBeNull());
  });

  it("shows honest facts for the selected store and jumps to the needs-reply feed", async () => {
    const { wrapper } = setup();
    render(<AppDetailClient appId="A1" />, { wrapper });
    const facts = await screen.findByRole("region", { name: "Review facts" });
    expect(within(facts).getByText("80")).toBeTruthy();
    expect(within(facts).getByText("10")).toBeTruthy();
    expect(within(facts).getByText("6")).toBeTruthy();
    expect(within(facts).getByText("25%")).toBeTruthy();

    fireEvent.click(within(facts).getByRole("button", { name: /Needs a reply/ }));
    await waitFor(() => expect(search.get("needsReply")).toBe("1"));
    expect(screen.getByRole("button", { name: "Needs reply" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps cached detail on screen and explains a failed refresh with a retry", async () => {
    let calls = 0;
    const { store, wrapper } = setup(async (url) => {
      if (url.endsWith("ensure-fresh")) return { ok: true, liveFresh: true };
      if (url.includes("/reviews")) return reviewsPayload;
      if (++calls > 1) throw new Error("Store connection unavailable");
      return detail();
    });
    render(<AppDetailClient appId="A1" />, { wrapper });
    await screen.findByRole("heading", { name: "Fixture App", level: 1 });
    await store.loadApp("A1");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Store connection unavailable");
    expect(alert.textContent).toMatch(/Showing data from/);
    expect(screen.getByRole("heading", { name: "Fixture App", level: 1 })).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("reports the live connection and switches to offline wording when it drops", async () => {
    const { wrapper, stream } = setup();
    render(<AppDetailClient appId="A1" />, { wrapper });
    await screen.findByRole("heading", { name: "Fixture App", level: 1 });
    stream().onHello(new Date().toISOString());
    await waitFor(() => expect(screen.getByText(/^Live/)).toBeTruthy());
    stream().onError();
    await waitFor(() => expect(screen.getByText(/Reconnecting/)).toBeTruthy());
  });

  it("counts new reviews on the Reviews tab while another section is open", async () => {
    const { wrapper, stream } = setup();
    render(<AppDetailClient appId="A1" />, { wrapper });
    await screen.findByRole("heading", { name: "Fixture App", level: 1 });
    selectTab(/Ratings/);
    await screen.findByLabelText("Selected rating");
    stream().onChange({ kind: "reviews", appId: "A1", inserted: 4, at: "t" });
    const tab = await screen.findByRole("tab", { name: /Reviews/ });
    await waitFor(() => expect(within(tab).getByText("4")).toBeTruthy());
  });
});
