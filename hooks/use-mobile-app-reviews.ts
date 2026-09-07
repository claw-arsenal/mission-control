"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReviewRow } from "@/components/mobile-apps/review-card";

function reviewResource(url: string) {
  let state = { reviews: [] as ReviewRow[], total: 0, offset: 0, loading: true, loadingMore: false, error: null as string | null, hasMore: false };
  let active = false;
  let pending: AbortController | null = null;
  let retryAppend = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => {
    if (!active) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  async function load(append = false) {
    if (append && pending) return;
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    retryAppend = append;
    update({ loading: !append, loadingMore: append, error: null });
    try {
      const response = await fetch(`${url}&offset=${append ? state.offset : 0}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || "Reviews could not be loaded. Try again.");
      if (controller.signal.aborted || pending !== controller) return;
      const rows: ReviewRow[] = Array.isArray(json.reviews) ? json.reviews : [];
      const offset = (append ? state.offset : 0) + rows.length;
      const total = Math.max(0, Number(json.total) || 0);
      const reviews = [...new Map([...(append ? state.reviews : []), ...rows].map(row => [row.id, row])).values()];
      update({ reviews, offset, total, hasMore: rows.length > 0 && offset < total });
    } catch (error) {
      if (!controller.signal.aborted) update({ error: error instanceof Error ? error.message : "Reviews could not be loaded. Try again." });
    } finally {
      if (pending === controller && !controller.signal.aborted) {
        pending = null;
        update({ loading: false, loadingMore: false });
      }
    }
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    loadMore: () => load(true),
    retry: () => load(retryAppend),
    start: () => {
      active = true;
      void load();
      return () => { active = false; pending?.abort(); pending = null; };
    },
  };
}

export function useMobileAppReviews(url: string, refreshKey: number) {
  const resource = useMemo(() => reviewResource(url), [url]);
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => resource.start(), [resource, refreshKey]);
  return { ...state, loadMore: resource.loadMore, retry: resource.retry };
}
