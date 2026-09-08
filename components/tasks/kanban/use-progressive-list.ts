"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export const DEFAULT_KANBAN_PAGE_SIZE = 25;

type Options = {
  /** Cards rendered per reveal step. */
  pageSize?: number;
  /** Changing this collapses the list back to the first page (for example, switching boards). */
  resetKey?: unknown;
};

/**
 * Reveals a long list in pages as the reader scrolls towards its end.
 *
 * Pass `attachSentinel` as the ref of an element rendered after the visible items; when it
 * scrolls into view the next page is revealed. The list never shrinks below the
 * first page and never shows more than `total`.
 */
export function useProgressiveList(total: number, { pageSize = DEFAULT_KANBAN_PAGE_SIZE, resetKey }: Options = {}) {
  const [pages, setPages] = useState(1);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const [lastResetKey, setLastResetKey] = useState(resetKey);

  // Adjusting state during render is React's sanctioned way to reset on a prop change.
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPages(1);
  }

  const visibleCount = Math.min(total, pages * pageSize);
  const hasMore = visibleCount < total;

  const revealMore = useCallback(() => setPages((current) => current + 1), []);
  const revealAll = useCallback(() => setPages(Math.max(1, Math.ceil(total / pageSize))), [total, pageSize]);

  useEffect(() => {
    if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) revealMore();
    }, { rootMargin: "0px 0px 200px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, revealMore]);

  const attachSentinel = useCallback((element: HTMLElement | null) => setSentinel(element), []);

  return useMemo(
    () => ({ visibleCount, hasMore, hiddenCount: total - visibleCount, attachSentinel, revealMore, revealAll }),
    [visibleCount, hasMore, total, attachSentinel, revealMore, revealAll],
  );
}
