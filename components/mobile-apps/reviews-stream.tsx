"use client";

import { useEffect, useState } from "react";
import { IconSearch, IconStarFilled } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/components/mobile-apps/review-card";

import { useMobileAppReviews } from "@/hooks/use-mobile-app-reviews";

type Sort = "newest" | "oldest" | "lowest" | "highest";
const PAGE = 30;

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "lowest", label: "Lowest rated" },
  { value: "highest", label: "Highest rated" },
];

export function ReviewsStream({
  appId,
  store,
  refreshKey,
  storeAppIds = {},
}: {
  appId: string;
  store: "" | "apple" | "google";
  refreshKey: number;
  storeAppIds?: Partial<Record<string, string>>;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ sort, limit: String(PAGE) });
  if (store) params.set("store", store);
  if (rating) params.set("rating", String(rating));
  if (debounced) params.set("q", debounced);
  const { reviews, total, loading, loadingMore, error, hasMore, loadMore, retry } =
    useMobileAppReviews(`/api/mobile-apps/${appId}/reviews?${params}`, refreshKey);

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="mr-1 text-sm font-semibold">
          Reviews <span className="font-normal text-muted-foreground tabular-nums">{total.toLocaleString()}</span>
        </h2>

        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          <button
            onClick={() => setRating(null)}
            aria-pressed={rating === null}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              rating === null ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {[5, 4, 3, 2, 1].map((s) => (
            <button
              key={s}
              onClick={() => setRating((r) => (r === s ? null : s))}
              className={`flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                rating === s ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={rating === s}
            >
              {s}
              <IconStarFilled className="size-2.5 text-amber-500" />
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reviews"
            aria-label="Search reviews"
            className="h-8 w-40 rounded-lg border bg-background pl-8 pr-2 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <select
          aria-label="Sort reviews"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-8 rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/40"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="px-4" aria-busy={loading || loadingMore}>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <p className="min-w-0 flex-1 break-words text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void retry()}>Try again</Button>
          </div>
        ) : null}
        {loading && reviews.length === 0 ? (
          <div role="status" aria-label="Loading reviews" className="space-y-4 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3.5 w-1/3 motion-safe:animate-pulse rounded bg-muted" />
                <div className="h-3 w-full motion-safe:animate-pulse rounded bg-muted" />
                <div className="h-3 w-2/3 motion-safe:animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : reviews.length === 0 && !error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No reviews match these filters yet.
          </p>
        ) : (
          <ul className="divide-y">
            {reviews.map((r) => (
              <li key={r.id}>
                <ReviewCard review={r} storeAppId={storeAppIds[r.store] ?? null} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && !loading ? (
        <div className="border-t px-4 py-3 text-center">
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Load more (${Math.max(0, total - reviews.length).toLocaleString()} left)`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
