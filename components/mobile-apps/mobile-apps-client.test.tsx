// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MobileAppsStoreProvider } from "@/components/mobile-apps/store-provider";
import { createMobileAppsStore, type StoreDeps, type StreamHandlers } from "@/lib/mobile-apps/client/live-store";
import { MobileAppsClient } from "./mobile-apps-client";

vi.mock("@/components/modules/modules-provider", () => ({ useModules: () => ({ ready: true, isEnabled: () => true }) }));

// jsdom implements neither matchMedia (sidebar shell) nor scrollIntoView /
// PointerEvent capture (Radix Select), so stub what the real components call.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const app = (id: string, name: string, facts: Record<string, unknown>) => ({
  id, name, icon_url: null, notes: null,
  listings: [{ id: `${id}-g`, store: "google", storeAppId: "com.x", country: "nl", currentRating: 4.6, ratingsCount: 120, lastSyncedAt: null }],
  facts: { reviewsLast7d: 0, negativeLast7d: 0, lastCheckedAt: null, syncFailed: false, reportsStatus: null, ...facts },
});

const APPS = [
  app("A1", "Alpha", { reviewsLast7d: 2, negativeLast7d: 0, lastCheckedAt: new Date(Date.now() - 300_000).toISOString(), reportsStatus: "fresh" }),
  app("A2", "Bravo", { reviewsLast7d: 9, negativeLast7d: 4, syncFailed: true, reportsStatus: "failed" }),
];

const listPayload = { ok: true, apps: APPS, asOf: new Date().toISOString(), negativeThreshold: 3 };

function setup(router?: StoreDeps["fetchJson"]) {
  let handlers: StreamHandlers | null = null;
  const store = createMobileAppsStore({
    fetchJson: router ?? (async () => listPayload),
    openStream: (_url, h) => { handlers = h; return vi.fn(); },
    storage: { read: () => null, write: () => {} },
    now: () => Date.now(),
    online: () => true,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SidebarProvider><MobileAppsStoreProvider store={store}>{children}</MobileAppsStoreProvider></SidebarProvider>
  );
  return { store, wrapper, stream: () => handlers! };
}

const rowNames = () =>
  screen.getAllByRole("link").map((el) => el.textContent?.match(/Alpha|Bravo/)?.[0]).filter(Boolean);

afterEach(cleanup);

describe("mobile apps list", () => {
  it("shows activity facts and sync health per app, and no rating", async () => {
    const { wrapper } = setup();
    render(<MobileAppsClient />, { wrapper });
    const bravo = await screen.findByRole("link", { name: /Bravo/ });
    expect(within(bravo).getByText("9")).toBeTruthy();
    expect(within(bravo).getByText("4")).toBeTruthy();
    expect(within(bravo).getByText("Sync failed")).toBeTruthy();
    expect(within(bravo).getByText("Report refresh failed")).toBeTruthy();
    // A single headline rating per app is ambiguous across stores and sources.
    expect(bravo.textContent).not.toContain("4.6");
    const alpha = screen.getByRole("link", { name: /Alpha/ });
    expect(within(alpha).getByText("5m ago")).toBeTruthy();
    expect(within(alpha).getByText("Reports up to date")).toBeTruthy();
  });

  it("orders by most new reviews by default and can switch to name order", async () => {
    const { wrapper } = setup();
    render(<MobileAppsClient />, { wrapper });
    await screen.findByRole("link", { name: /Bravo/ });
    expect(rowNames()).toEqual(["Bravo", "Alpha"]);
    fireEvent.click(screen.getByLabelText("Sort apps"));
    fireEvent.click(await screen.findByRole("option", { name: "Name" }));
    await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Bravo"]));
  });

  it("filters by name and reports how many of the total are shown", async () => {
    const { wrapper } = setup();
    render(<MobileAppsClient />, { wrapper });
    await screen.findByRole("link", { name: /Bravo/ });
    fireEvent.change(screen.getByLabelText("Filter apps by name"), { target: { value: "alp" } });
    await waitFor(() => expect(screen.queryByRole("link", { name: /Bravo/ })).toBeNull());
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Alpha/ })).toBeTruthy();
  });

  it("keeps the cards visible and offers a retry when a later load fails", async () => {
    let calls = 0;
    const { store, wrapper } = setup(async () => {
      if (++calls === 1) return listPayload;
      throw new Error("Database unavailable");
    });
    render(<MobileAppsClient />, { wrapper });
    await screen.findByRole("link", { name: /Alpha/ });
    await store.loadList();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Database unavailable");
    expect(screen.getByRole("link", { name: /Alpha/ })).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("teaches the interface when nothing is tracked yet", async () => {
    const { wrapper } = setup(async () => ({ ok: true, apps: [], asOf: "t", negativeThreshold: 3 }));
    render(<MobileAppsClient />, { wrapper });
    expect(await screen.findByText("Track your first app")).toBeTruthy();
    expect(screen.getByText(/update as the stores publish them/)).toBeTruthy();
  });
});
