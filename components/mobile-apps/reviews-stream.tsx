"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconArrowUp, IconSearch, IconStarFilled, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReviewCard, storeUrl, type ReviewRow } from "@/components/mobile-apps/review-card";
import { useMobileAppReviews } from "@/hooks/use-mobile-app-reviews";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/utils";

export type ReviewSort = "newest" | "oldest" | "lowest" | "highest";
export type ReviewRange = "7d" | "30d" | "90d" | "all";
export type ReviewFilters = { rating: number; q: string; sort: ReviewSort; range: ReviewRange; needsReply: boolean };

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = { rating: 0, q: "", sort: "newest", range: "all", needsReply: false };

const PAGE = 30;
const SORTS: { value: ReviewSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "lowest", label: "Lowest rated" },
  { value: "highest", label: "Highest rated" },
];
const RANGES: { value: ReviewRange; label: string; days: number | null }[] = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
];

function sinceFor(range: ReviewRange): string | null {
  const days = RANGES.find((r) => r.value === range)?.days ?? null;
  if (!days) return null;
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function buildReviewsQuery(store: string, filters: ReviewFilters, negativeThreshold: number, debouncedQ: string): string {
  const params = new URLSearchParams({ sort: filters.sort, limit: String(PAGE) });
  if (store) params.set("store", store);
  if (filters.rating) params.set("rating", String(filters.rating));
  if (filters.needsReply) { params.set("responded", "false"); params.set("maxRating", String(negativeThreshold)); }
  if (debouncedQ) params.set("q", debouncedQ);
  const since = sinceFor(filters.range);
  if (since) params.set("since", since);
  return params.toString();
}

/** Remember when the operator last looked at this app's reviews, per browser. */
function useLastSeen(appId: string, asOf: string | null) {
  const key = `mc.mobile-apps.seen.${appId}`;
  const [lastSeen] = useState<string | null>(() => { try { return window.localStorage.getItem(key); } catch { return null; } });
  const latest = useRef(asOf);
  useEffect(() => { latest.current = asOf; }, [asOf]);
  useEffect(() => {
    const write = () => { try { if (latest.current) window.localStorage.setItem(key, latest.current); } catch { /* private mode */ } };
    const onVisibility = () => { if (document.visibilityState === "hidden") write(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); write(); };
  }, [key]);
  return lastSeen;
}

type Props = {
  appId: string;
  store: "" | "apple" | "google";
  refreshKey: number;
  storeAppIds?: Partial<Record<string, string>>;
  negativeThreshold?: number;
  filters?: ReviewFilters;
  onFiltersChange?: (patch: Partial<ReviewFilters>) => void;
  onAnnounce?: (text: string) => void;
  /** Called by the `r` shortcut. */
  onRefresh?: () => void;
  /** Reviews announced by the change stream but not yet fetched into `pending`. */
  announcedNew?: number;
  onNewShown?: () => void;
};

export function ReviewsStream({ appId, store, refreshKey, storeAppIds = {}, negativeThreshold = 3, filters: controlled, onFiltersChange, onAnnounce, onRefresh, announcedNew = 0, onNewShown }: Props) {
  const [local, setLocal] = useState<ReviewFilters>(DEFAULT_REVIEW_FILTERS);
  const filters = controlled ?? local;
  const setFilters = useCallback((patch: Partial<ReviewFilters>) => {
    if (onFiltersChange) onFiltersChange(patch); else setLocal((prev) => ({ ...prev, ...patch }));
  }, [onFiltersChange]);

  const [search, setSearch] = useState(filters.q);
  const [debounced, setDebounced] = useState(filters.q.trim());
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      setDebounced(next);
      if (next !== filters.q) setFilters({ q: next });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => { if (filters.q !== search.trim()) { setSearch(filters.q); setDebounced(filters.q); } }, [filters.q]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = buildReviewsQuery(store, filters, negativeThreshold, debounced);
  const { reviews, total, loading, loadingMore, error, hasMore, pending, asOf, loadMore, retry, showPending } =
    useMobileAppReviews(`/api/mobile-apps/${appId}/reviews?${query}`, refreshKey);

  const lastSeen = useLastSeen(appId, asOf);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const newCount = pending.length > 0 ? pending.length : announcedNew;

  const acceptPending = useCallback(() => {
    if (pending.length === 0) { onNewShown?.(); return; }
    setHighlighted(new Set(pending.map((r) => r.id)));
    showPending();
    onNewShown?.();
    onAnnounce?.(`${pending.length} new ${pending.length === 1 ? "review" : "reviews"} shown`);
    listRef.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    setTimeout(() => setHighlighted(new Set()), 4000);
  }, [pending, showPending, onNewShown, onAnnounce, reduceMotion]);

  // Infinite loading, with the button kept as the keyboard/no-observer fallback.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loadingMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loadMore, reviews.length]);

  const focusReview = useCallback((delta: number) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("article[data-review-id]") ?? []);
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = items.findIndex((el) => el === active || el.contains(active));
    const next = index === -1 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, index + delta));
    items[next]?.focus();
    items[next]?.scrollIntoView({ block: "nearest" });
  }, []);
  const focusedAction = useCallback((action: string) => {
    const active = document.activeElement as HTMLElement | null;
    const article = active?.closest<HTMLElement>("article[data-review-id]");
    article?.querySelector<HTMLElement>(`[data-action="${action}"]`)?.click();
  }, []);

  useKeyboardShortcuts(useMemo(() => ({
    "/": () => searchRef.current?.focus(),
    j: () => focusReview(1),
    k: () => focusReview(-1),
    ArrowDown: () => focusReview(1),
    ArrowUp: () => focusReview(-1),
    o: () => focusedAction("open"),
    t: () => focusedAction("translate"),
    c: () => focusedAction("copy"),
    n: () => acceptPending(),
    r: () => onRefresh?.(),
    "1": () => setFilters({ rating: filters.rating === 1 ? 0 : 1 }),
    "2": () => setFilters({ rating: filters.rating === 2 ? 0 : 2 }),
    "3": () => setFilters({ rating: filters.rating === 3 ? 0 : 3 }),
    "4": () => setFilters({ rating: filters.rating === 4 ? 0 : 4 }),
    "5": () => setFilters({ rating: filters.rating === 5 ? 0 : 5 }),
    Escape: () => {
      if (document.activeElement === searchRef.current && search) { setSearch(""); return; }
      (document.activeElement as HTMLElement | null)?.blur();
      setFilters({ rating: 0, needsReply: false, q: "" });
      setSearch("");
    },
  }), [focusReview, focusedAction, acceptPending, onRefresh, setFilters, filters.rating, search]));

  const activeFilters = (filters.rating ? 1 : 0) + (filters.needsReply ? 1 : 0) + (filters.range !== "all" ? 1 : 0) + (debounced ? 1 : 0);
  const chip = "inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums transition-colors duration-(--dur-fast) ease-(--ease-out) pointer-coarse:h-10 pointer-coarse:px-3";

  return (
    <section aria-label="Reviews" className="surface-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="mr-1 text-md font-semibold">
          Reviews <span className="font-normal text-muted-foreground tabular-nums">{total.toLocaleString()}</span>
        </h2>

        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label="Filter by star rating">
          <button type="button" onClick={() => setFilters({ rating: 0 })} aria-pressed={filters.rating === 0} className={cn(chip, filters.rating === 0 ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            All
          </button>
          {[5, 4, 3, 2, 1].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilters({ rating: filters.rating === s ? 0 : s })}
              aria-pressed={filters.rating === s}
              aria-label={`${s} star reviews`}
              className={cn(chip, "px-1.5", filters.rating === s ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {s}
              <IconStarFilled className="size-3 text-warning" aria-hidden />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilters({ needsReply: !filters.needsReply })}
          aria-pressed={filters.needsReply}
          className={cn(chip, "border", filters.needsReply ? "border-warning/40 bg-warning-soft text-warning-fg" : "border-line bg-background text-muted-foreground hover:text-foreground")}
          title={`Reviews rated ${negativeThreshold} stars or lower without a developer response`}
        >
          Needs reply
        </button>

        <Select value={filters.range} onValueChange={(v) => setFilters({ range: v as ReviewRange })}>
          <SelectTrigger className="h-8 w-36 text-xs pointer-coarse:h-10" aria-label="Date range"><SelectValue /></SelectTrigger>
          <SelectContent>{RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
        </Select>

        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-52">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reviews  /"
            aria-label="Search reviews"
            className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs outline-none transition-shadow duration-(--dur-fast) focus:ring-2 focus:ring-ring/40 pointer-coarse:h-10 pointer-coarse:text-sm"
          />
        </div>

        <Select value={filters.sort} onValueChange={(v) => setFilters({ sort: v as ReviewSort })}>
          <SelectTrigger className="h-8 w-36 text-xs pointer-coarse:h-10" aria-label="Sort reviews"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>

        {activeFilters > 0 ? (
          <button type="button" onClick={() => { setFilters({ rating: 0, needsReply: false, range: "all", q: "" }); setSearch(""); }} className={cn(chip, "text-muted-foreground hover:text-foreground")}>
            <IconX className="size-3.5" aria-hidden /> Clear
          </button>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {newCount > 0 ? (
          <motion.div
            key="new-reviews"
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="sticky top-0 z-10 flex justify-center border-b border-line bg-surface-1/95 px-4 py-2 backdrop-blur-sm"
          >
            <Button size="sm" onClick={acceptPending} className="rounded-full shadow-elev-2">
              <IconArrowUp className="size-3.5" aria-hidden />
              {pending.length > 0 ? `Show ${pending.length} new ${pending.length === 1 ? "review" : "reviews"}` : `${announcedNew} new · checking`}
              <kbd className="ml-1 hidden rounded bg-primary-foreground/20 px-1 text-2xs font-normal sm:inline">n</kbd>
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="px-4" aria-busy={loading || loadingMore}>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <p className="min-w-0 flex-1 break-words text-danger-fg">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void retry()}>Try again</Button>
          </div>
        ) : null}
        {loading && reviews.length === 0 ? (
          <div role="status" aria-label="Loading reviews" className="space-y-5 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3.5 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-3 w-full rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ) : reviews.length === 0 && !error ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium">No reviews match these filters{activeFilters > 0 ? "" : " yet"}.</p>
            <p className="mt-1 text-xs text-muted-foreground">{activeFilters > 0 ? "Clear a filter to widen the view." : "New reviews appear here as the stores publish them."}</p>
          </div>
        ) : (
          <ul ref={listRef} className="divide-y divide-line scroll-mt-24" aria-label="Review list">
            {reviews.map((r) => (
              <li key={r.id}>
                <ReviewCard
                  review={r}
                  storeAppId={storeAppIds[r.store] ?? null}
                  negativeThreshold={negativeThreshold}
                  isNew={Boolean(lastSeen && r.fetched_at && r.fetched_at > lastSeen)}
                  highlight={highlighted.has(r.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && !loading ? (
        <div className="border-t border-line px-4 py-3 text-center">
          <div ref={sentinelRef} aria-hidden />
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Load more (${Math.max(0, total - reviews.length).toLocaleString()} left)`}
          </Button>
        </div>
      ) : reviews.length > 0 && !hasMore ? (
        <p className="border-t border-line px-4 py-3 text-center text-xs text-muted-foreground">All {total.toLocaleString()} shown</p>
      ) : null}
    </section>
  );
}

export { storeUrl };
export type { ReviewRow };
