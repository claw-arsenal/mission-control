// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewsStream, buildReviewsQuery, DEFAULT_REVIEW_FILTERS } from "./reviews-stream";

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, store: "google", title: id, body: "A review", author: null, rating: 4,
  app_version: null, country: "nl", language: "nl", submitted_at: "2026-09-08T09:00:00.000Z",
  store_response: null, fetched_at: "2026-09-08T09:00:00.000Z", ...extra,
});
const page = (rows: unknown[], total = rows.length, asOf = "2026-09-08T10:00:00.000Z") =>
  new Response(JSON.stringify({ ok: true, reviews: rows, total, asOf }));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  // Report reduced motion so presence transitions resolve immediately here.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("buildReviewsQuery", () => {
  it("translates the needs-reply filter into an unanswered negative-review query", () => {
    const q = new URLSearchParams(buildReviewsQuery("google", { ...DEFAULT_REVIEW_FILTERS, needsReply: true }, 3, ""));
    expect(q.get("responded")).toBe("false");
    expect(q.get("maxRating")).toBe("3");
    expect(q.get("store")).toBe("google");
  });

  it("turns a range into an absolute since bound and omits it for all time", () => {
    expect(new URLSearchParams(buildReviewsQuery("google", { ...DEFAULT_REVIEW_FILTERS, range: "7d" }, 3, "")).get("since")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new URLSearchParams(buildReviewsQuery("google", DEFAULT_REVIEW_FILTERS, 3, "")).get("since")).toBeNull();
  });
});

describe("review pagination", () => {
  it("does not append an old store's pending page after switching stores", async () => {
    let resolveOld!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveOld = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      Promise.resolve(url.includes("store=apple") ? page([row("Apple review", { store: "apple" })], 31)
        : url.includes("offset=0") ? page([row("Google review")], 31)
          : pending)));
    const { rerender } = render(<ReviewsStream appId="A1" store="google" refreshKey={0} />);
    await screen.findByText("Google review");
    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    rerender(<ReviewsStream appId="A1" store="apple" refreshKey={0} />);
    await screen.findByText("Apple review");
    await act(async () => { resolveOld(page([row("Wrong store page")], 31)); });
    expect(screen.queryByText("Wrong store page")).toBeNull();
    expect(screen.queryByText("Google review")).toBeNull();
  });

  it("shows a recoverable error rather than claiming there are no matching reviews", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Reviews are temporarily unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(page([row("Recovered")]));
    vi.stubGlobal("fetch", fetch);
    render(<ReviewsStream appId="A1" store="google" refreshKey={0} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Reviews are temporarily unavailable"));
    expect(screen.queryByText(/No reviews match these filters/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Recovered");
  });
});

describe("new reviews", () => {
  it("holds new rows behind a control and prepends them without losing the loaded page", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      Promise.resolve(url.includes("fetchedSince=")
        ? page([row("Fresh one")], 3, "2026-09-08T10:05:00.000Z")
        : page([row("Older one"), row("Oldest one")], 2))));
    const { rerender } = render(<ReviewsStream appId="A1" store="google" refreshKey={0} />);
    await screen.findByText("Older one");

    rerender(<ReviewsStream appId="A1" store="google" refreshKey={1} />);
    const control = await screen.findByRole("button", { name: /Show 1 new review/ });
    // The new row waits: the operator's position is not disturbed.
    expect(screen.queryByText("Fresh one")).toBeNull();

    fireEvent.click(control);
    await screen.findByText("Fresh one");
    expect(screen.getByText("Older one")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Show 1 new review/ })).toBeNull());
  });

  it("announces the count that the change stream reported before the rows arrive", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(page([row("Only one")]))));
    render(<ReviewsStream appId="A1" store="google" refreshKey={0} announcedNew={5} />);
    expect(await screen.findByRole("button", { name: /5 new/ })).toBeTruthy();
  });

  it("marks rows fetched since the operator's last visit as new", async () => {
    window.localStorage.setItem("mc.mobile-apps.seen.A1", "2026-09-08T09:30:00.000Z");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(page([
      row("Seen before", { fetched_at: "2026-09-08T09:00:00.000Z" }),
      row("Arrived since", { fetched_at: "2026-09-08T09:45:00.000Z" }),
    ]))));
    render(<ReviewsStream appId="A1" store="google" refreshKey={0} />);
    const fresh = (await screen.findByText("Arrived since")).closest("article")!;
    expect(within(fresh).getByText("New")).toBeTruthy();
    const old = screen.getByText("Seen before").closest("article")!;
    expect(within(old).queryByText("New")).toBeNull();
  });
});

describe("filters and shortcuts", () => {
  it("reports the active filters upward instead of owning them", async () => {
    const onFiltersChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(page([row("One")]))));
    render(<ReviewsStream appId="A1" store="google" refreshKey={0} filters={DEFAULT_REVIEW_FILTERS} onFiltersChange={onFiltersChange} />);
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("button", { name: "1 star reviews" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ rating: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Needs reply" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ needsReply: true });
  });

  it("supports star shortcuts, refresh and clearing from the keyboard", async () => {
    const onFiltersChange = vi.fn();
    const onRefresh = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(page([row("One")]))));
    render(<ReviewsStream appId="A1" store="google" refreshKey={0} filters={DEFAULT_REVIEW_FILTERS} onFiltersChange={onFiltersChange} onRefresh={onRefresh} />);
    await screen.findByText("One");

    fireEvent.keyDown(document, { key: "2" });
    expect(onFiltersChange).toHaveBeenCalledWith({ rating: 2 });
    fireEvent.keyDown(document, { key: "r" });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onFiltersChange).toHaveBeenCalledWith({ rating: 0, needsReply: false, q: "" });

    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(screen.getByLabelText("Search reviews"));
    // A shortcut key typed into the search field must reach the field, not the page.
    onRefresh.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Search reviews"), { key: "r" });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
