// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMobileAppReviews } from "./use-mobile-app-reviews";

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, store: "google", author: null, rating: 4, title: id, body: "text", app_version: null, country: "nl", language: "nl", submitted_at: "2026-09-08T09:00:00.000Z", store_response: null, fetched_at: "2026-09-08T09:00:00.000Z", ...extra });
const json = (data: unknown) => new Response(JSON.stringify(data));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("review deltas", () => {
  it("holds new rows behind pending, updates known rows in place, and prepends on accept for newest sort", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("fetchedSince=")) {
        expect(url).toContain("fetchedSince=2026-09-08T10%3A00%3A00.000Z");
        return json({ ok: true, reviews: [row("r-new"), row("r1", { store_response: "Thanks!" })], total: 3, asOf: "2026-09-08T10:05:00.000Z" });
      }
      return json({ ok: true, reviews: [row("r1"), row("r2")], total: 2, asOf: "2026-09-08T10:00:00.000Z" });
    });
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ key }) => useMobileAppReviews("/api/mobile-apps/A1/reviews?sort=newest&limit=30", key), { initialProps: { key: 0 } });
    await waitFor(() => expect(result.current.reviews).toHaveLength(2));
    expect(result.current.asOf).toBe("2026-09-08T10:00:00.000Z");
    rerender({ key: 1 });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    expect(result.current.reviews.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result.current.reviews[0].store_response).toBe("Thanks!");
    expect(result.current.total).toBe(3);
    act(() => result.current.showPending());
    expect(result.current.reviews.map((r) => r.id)).toEqual(["r-new", "r1", "r2"]);
    expect(result.current.pending).toEqual([]);
    expect(fetch.mock.calls.filter(([u]) => !String(u).includes("fetchedSince"))).toHaveLength(1);
  });

  it("reloads from the top on accept when the sort is not newest", async () => {
    const fetch = vi.fn(async (url: string) => url.includes("fetchedSince=")
      ? json({ ok: true, reviews: [row("r-new", { rating: 1 })], total: 3, asOf: "t2" })
      : json({ ok: true, reviews: [row("r1", { rating: 1 }), row("r2", { rating: 2 })], total: 2, asOf: "t1" }));
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ key }) => useMobileAppReviews("/api/mobile-apps/A1/reviews?sort=lowest&limit=30", key), { initialProps: { key: 0 } });
    await waitFor(() => expect(result.current.reviews).toHaveLength(2));
    rerender({ key: 1 });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    await act(async () => { result.current.showPending(); });
    await waitFor(() => expect(fetch.mock.calls.filter(([u]) => !String(u).includes("fetchedSince"))).toHaveLength(2));
    expect(result.current.pending).toEqual([]);
  });

  it("keeps loaded pages when a change arrives after load more", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("fetchedSince=")) return json({ ok: true, reviews: [], total: 60, asOf: "t3" });
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      return json({ ok: true, reviews: Array.from({ length: 30 }, (_, i) => row(`r${offset + i}`)), total: 60, asOf: "t1" });
    });
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ key }) => useMobileAppReviews("/api/mobile-apps/A1/reviews?sort=newest&limit=30", key), { initialProps: { key: 0 } });
    await waitFor(() => expect(result.current.reviews).toHaveLength(30));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.reviews).toHaveLength(60);
    rerender({ key: 1 });
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).includes("fetchedSince"))).toBe(true));
    expect(result.current.reviews).toHaveLength(60);
    expect(result.current.hasMore).toBe(false);
  });
});
