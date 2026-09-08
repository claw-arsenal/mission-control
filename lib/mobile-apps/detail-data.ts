import { normalizeTerritoryRatings } from "./rating-source";

export type Listing = {
  id: string;
  store: string;
  store_app_id: string;
  country: string;
  current_rating: number | null;
  ratings_count: number | null;
  official_ratings: TerritoryRating[] | null;
  rating_source: string | null;
  rating_as_of: string | null;
  store_metadata: AppMetadata | null;
  last_synced_at: string | null;
};

export type TerritoryRating = { territory: string; avg: number | null; count: number | null; review_count?: number | null };

export type AppMetadata = {
  version: string | null;
  releaseDate: string | null;
  currentVersionReleaseDate: string | null;
  releaseNotes: string | null;
  fileSizeBytes: number | null;
  primaryGenre: string | null;
  genres: string[];
  contentRating: string | null;
  formattedPrice: string | null;
  currency: string | null;
  sellerName: string | null;
  minimumOsVersion: string | null;
  languages: string[];
  screenshotCount: number | null;
  artworkUrl: string | null;
  currentVersionAvg: number | null;
  currentVersionCount: number | null;
};

/** jsonb can arrive as an object, a JSON string, or null depending on the driver. */
function asMetadata(v: unknown): AppMetadata | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as AppMetadata;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as AppMetadata) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export type Summary = {
  store: string;
  total: number;
  avg_rating: number | null;
  r1: number; r2: number; r3: number; r4: number; r5: number;
  negative: number;
  responded: number;
  /** Negative reviews without a developer response. */
  needs_reply?: number;
  latest_review_at: string | null;
};

export type TrendRow = { store: string; day: string; avg: number; count: number };

export type SyncRun = {
  listing_id: string;
  store: string;
  status: "running" | "success" | "failed";
  finished_at: string | null;
  fetched_count: number;
  upserted_count: number;
  error_message: string | null;
  report_status?: string | null;
  report_warnings?: unknown;
};

export type ReportPoint = { date: string; metrics: unknown; source?: string | null };
export type TrafficSource = { dimensions: unknown; metrics: unknown };
export type ReportFileRow = {
  report: string;
  dimension: string;
  object_path: string;
  yyyy_mm: string | null;
  size_bytes: number | string | null;
  downloaded_at: string | null;
  rows_count: number | string | null;
  status: string | null;
  error_message?: string | null;
};
export type ReportBreakdown = {
  report: string;
  dimension: string;
  dimension_value: string;
  date: string;
  metrics: unknown;
  dimensions?: unknown;
};
export type ReportFreshness = {
  status: string;
  latestOfficialMonth: string | null;
  latestProcessedMonth: string | null;
  processedAt: string | null;
  checkedAt: string | null;
};

export type AppDetailData = {
  app: { id: string; name: string; icon_url: string | null };
  listings: Listing[];
  summary: Summary[];
  trend: TrendRow[];
  syncRuns: SyncRun[];
  negativeThreshold: number;
  reports: { installs: ReportPoint[]; crashes: ReportPoint[]; store_performance: ReportPoint[]; traffic_sources: TrafficSource[]; files: ReportFileRow[]; breakdowns: ReportBreakdown[] };
  freshness?: { googleReports?: ReportFreshness; liveReviews?: { status: string } };
};

export function normalizeAppDetail(data: AppDetailData): AppDetailData {
  if (!data.app?.id) throw new Error("App details are unavailable.");
  return {
    ...data,
    listings: (data.listings ?? []).map(listing => ({ ...listing, official_ratings: normalizeTerritoryRatings(listing.official_ratings), store_metadata: asMetadata(listing.store_metadata) })),
    summary: data.summary ?? [], trend: data.trend ?? [], syncRuns: data.syncRuns ?? [],
    negativeThreshold: data.negativeThreshold ?? 3,
    reports: {
      installs: data.reports?.installs ?? [], crashes: data.reports?.crashes ?? [],
      store_performance: data.reports?.store_performance ?? [], traffic_sources: data.reports?.traffic_sources ?? [],
      files: data.reports?.files ?? [], breakdowns: data.reports?.breakdowns ?? [],
    },
  };
}
