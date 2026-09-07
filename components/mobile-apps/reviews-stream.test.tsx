// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewsStream } from "./reviews-stream";

const row = (id: string, store = "google") => ({ id, store, title: id, body: "A review", author: null, rating: 4, app_version: null, country: "nl", language: "nl", submitted_at: null, store_response: null });
const page = (id: string, store = "google") => new Response(JSON.stringify({ ok: true, reviews: [row(id, store)], total: 31 }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("review pagination", () => {
  it("does not append an old store's pending page after switching stores", async () => {
    let resolveOld!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveOld = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.includes("store=apple") ? page("Apple review", "apple") : url.includes("offset=0") ? page("Google review") : pending)));
    const { rerender } = render(<ReviewsStream appId="A1" store="google" refreshKey={0} />);
    await screen.findByText("Google review");
    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    rerender(<ReviewsStream appId="A1" store="apple" refreshKey={0} />);
    await screen.findByText("Apple review");
    await act(async () => { resolveOld(page("Wrong store page")); });
    expect(screen.queryByText("Wrong store page")).toBeNull();
    expect(screen.queryByText("Google review")).toBeNull();
  });

  it("shows a recoverable error rather than claiming there are no matching reviews", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Reviews are temporarily unavailable" }), { status: 503 })).mockResolvedValueOnce(page("Recovered"));
    vi.stubGlobal("fetch", fetch);
    render(<ReviewsStream appId="A1" store="google" refreshKey={0} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Reviews are temporarily unavailable"));
    expect(screen.queryByText("No reviews match these filters yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Recovered");
  });
});
