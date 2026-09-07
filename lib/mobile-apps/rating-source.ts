import type { Store } from "@/lib/mobile-apps/types";
import { countryName, toAlpha2 } from "./country-codes";
import type { Listing, TerritoryRating } from "./detail-data";

function nonnegative(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeTerritoryRatings(value: unknown): TerritoryRating[] {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const territories = new Map<string, TerritoryRating>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || typeof raw.territory !== "string") continue;
    const territory = toAlpha2(raw.territory) ?? raw.territory.trim().toLowerCase();
    if (!territory) continue;
    const avg = nonnegative(raw.avg);
    const previous = territories.get(territory);
    territories.set(territory, {
      territory,
      avg: avg != null && avg <= 5 ? avg : previous?.avg ?? null,
      count: nonnegative(raw.count) ?? previous?.count ?? null,
      review_count: nonnegative(raw.review_count) ?? previous?.review_count ?? null,
    });
  }
  return [...territories.values()];
}

/** The selected value, country, and source must describe the same measurement. */
export function selectRatingMeasurement(store: Store, listing: Listing | undefined, picked: string | null) {
  const territories = normalizeTerritoryRatings(listing?.official_ratings);
  const rated = territories.filter(territory => territory.avg != null);
  const defaultTerritory = rated.find(territory => territory.territory === toAlpha2(listing?.country)) ?? rated[0];
  const selectedEntry = territories.find(territory => territory.territory === picked) ?? defaultTerritory ?? null;
  const selected = selectedEntry?.territory ?? null;
  const fromReport = listing?.rating_source === "google_play_console_ratings_report";
  const writtenOnly = listing?.rating_source === "google_reviews_api_fetched_reviews" || listing?.rating_source === "fetched_reviews";
  const sourceCopy = ratingSourceCopy({ store, source: listing?.rating_source, asOf: listing?.rating_as_of });
  const label = writtenOnly ? `${store === "google" ? "Google Play" : "App Store"} written-review average`
    : selected ? `${countryName(selected)} · ${store === "google" ? "Google Play" : "App Store"} rating`
      : sourceCopy.headline;
  return {
    territories, selected, selectedEntry, fromReport, writtenOnly, sourceCopy, label,
    avg: writtenOnly ? listing?.current_rating ?? null : selectedEntry?.avg ?? null,
    count: writtenOnly ? listing?.ratings_count ?? null : selectedEntry?.count ?? null,
  };
}

export type RatingSource =
  | "google_play_console_ratings_report"
  | "google_reviews_api_fetched_reviews"
  | "apple_app_store_lookup"
  | "itunes_lookup"
  | "fetched_reviews"
  | string;

export type RatingSourceCopy = {
  source: string | null;
  sourceLabel: string;
  headline: string;
  freshnessLabel: string | null;
  helperText: string;
  comparableWarning: string | null;
};

function formatAsOf(asOf: string | Date | null | undefined): string | null {
  if (!asOf) return null;
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * UI-safe copy for the rating source/freshness. The main reason this exists is
 * to avoid showing Google Play Console report ratings and Apple storefront
 * lookup ratings as if they are the exact same measurement.
 */
export function ratingSourceCopy(args: {
  store: Store;
  source?: RatingSource | null;
  asOf?: string | Date | null;
}): RatingSourceCopy {
  const source = args.source ?? null;
  const asOf = formatAsOf(args.asOf);

  if (args.store === "google" && source === "google_play_console_ratings_report") {
    return {
      source,
      sourceLabel: "Google Play · Play Console report",
      headline: "Latest available rating report",
      freshnessLabel: asOf ? `As of ${asOf} · report delayed 3–7 days` : "Report delayed 3–7 days",
      helperText:
        "Google rating comes from the latest available Play Console CSV report. The lookback setting only controls how far back we search for an available report; it does not mean the rating is limited to that period.",
      comparableWarning:
        "Compare Google and Apple ratings with the source labels visible; they come from different official sources.",
    };
  }

  if (args.store === "apple" && (source === "apple_app_store_lookup" || source === "itunes_lookup")) {
    return {
      source,
      sourceLabel: "Apple App Store · Storefront lookup",
      headline: "Current country storefront rating",
      freshnessLabel: "Current storefront lookup",
      helperText: "Apple rating comes from the current App Store storefront lookup for each country.",
      comparableWarning:
        "Compare Google and Apple ratings with the source labels visible; they come from different official sources.",
    };
  }

  if (source === "google_reviews_api_fetched_reviews" || source === "fetched_reviews") {
    return {
      source,
      sourceLabel: args.store === "google" ? "Google Play · written reviews only" : "Fetched written reviews",
      headline: "Average from fetched written reviews",
      freshnessLabel: "Not a store-wide aggregate",
      helperText:
        args.store === "google"
          ? "Google Play Reviews API returns written reviews only and excludes rating-only feedback. This value is an average of fetched written reviews, not the public store rating."
          : "This value is an average of fetched written reviews, not necessarily the full public store rating.",
      comparableWarning: "Do not compare this directly with official store-wide or storefront ratings.",
    };
  }

  return {
    source,
    sourceLabel: args.store === "google" ? "Google Play · rating source unknown" : "Apple App Store · rating source unknown",
    headline: "Rating source unknown",
    freshnessLabel: null,
    helperText: "The rating source was not recorded. Run a fresh sync with the latest mobile-apps module.",
    comparableWarning: "Do not compare ratings until the source label is known.",
  };
}
