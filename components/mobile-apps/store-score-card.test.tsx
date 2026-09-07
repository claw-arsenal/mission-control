// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoreScoreCard } from "./app-detail-client";
import type { Listing } from "@/lib/mobile-apps/detail-data";

afterEach(cleanup);

describe("country rating selection", () => {
  it("never labels the Netherlands rating as a review-only country's rating", () => {
    const listing: Listing = {
      id: "L1", store: "google", store_app_id: "com.x", country: "nl", current_rating: 4.5,
      ratings_count: null, rating_source: "google_play_console_ratings_report", rating_as_of: "2026-06-01",
      store_metadata: null, last_synced_at: null,
      official_ratings: [{ territory: "nl", avg: 4.5, count: null }, { territory: "tr", avg: null, count: null, review_count: 12 }],
    };
    render(<StoreScoreCard store="google" listing={listing} summary={undefined} run={undefined} negativeThreshold={3} />);
    fireEvent.click(screen.getByRole("button", { name: /Turkey|Türkiye/ }));
    expect(screen.getByLabelText("Selected rating").textContent).toBe("—");
    expect(screen.getByText(/Turkey.*Google Play rating|Türkiye.*Google Play rating/)).toBeTruthy();
  });
});
