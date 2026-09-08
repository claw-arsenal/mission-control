"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReviewRow } from "@/components/mobile-apps/review-card";

const DELTA_LIMIT = 50;

export type ReviewsState = {
  reviews: ReviewRow[];
  total: number;
  offset: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  /** Server time of the last full or delta read; the watermark for the next delta. */
  asOf: string | null;
  /** Rows that arrived since the operator's view was built, held until accepted. */
  pending: ReviewRow[];
};

type Deps = { fetch: typeof fetch };

const byId = (rows: ReviewRow[]) => new Map(rows.map((row) => [row.id, row]));

/**
 * One filtered review feed. Pages accumulate; a change to the underlying data
 * is applied as a delta: rows already on screen update in place, rows that are
 * new wait behind `pending` until `showPending()` so nobody loses their place.
 */
export function reviewResource(url: string, deps: Deps = { fetch: (...args) => fetch(...args) }) {
  let state: ReviewsState = { reviews: [], total: 0, offset: 0, loading: true, loadingMore: false, error: null, hasMore: false, asOf: null, pending: [] };
  let active = false;
  let pendingRequest: AbortController | null = null;
  let deltaRequest: AbortController | null = null;
  let retryAppend = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ReviewsState>) => {
    if (!active) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const sort = new URL(url, "http://local").searchParams.get("sort") ?? "newest";

  async function fetchPage(query: string, signal: AbortSignal) {
    const response = await deps.fetch(`${url}&${query}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), cache: "no-store" });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || "Reviews could not be loaded. Try again.");
    const rows: ReviewRow[] = Array.isArray(json.reviews) ? json.reviews : [];
    return { rows, total: Math.max(0, Number(json.total) || 0), asOf: typeof json.asOf === "string" ? json.asOf : new Date().toISOString() };
  }

  async function load(append = false) {
    if (append && pendingRequest) return;
    pendingRequest?.abort();
    const controller = new AbortController();
    pendingRequest = controller;
    retryAppend = append;
    update({ loading: !append, loadingMore: append, error: null });
    try {
      const { rows, total, asOf } = await fetchPage(`offset=${append ? state.offset : 0}`, controller.signal);
      if (controller.signal.aborted || pendingRequest !== controller) return;
      const offset = (append ? state.offset : 0) + rows.length;
      const reviews = [...byId([...(append ? state.reviews : []), ...rows]).values()];
      update({ reviews, offset, total, hasMore: rows.length > 0 && offset < total, asOf: append ? state.asOf ?? asOf : asOf, pending: append ? state.pending : [] });
    } catch (error) {
      if (!controller.signal.aborted) update({ error: error instanceof Error ? error.message : "Reviews could not be loaded. Try again." });
    } finally {
      if (pendingRequest === controller && !controller.signal.aborted) {
        pendingRequest = null;
        update({ loading: false, loadingMore: false });
      }
    }
  }

  /** Rows changed since the watermark: update known rows in place, hold new ones. */
  async function delta() {
    if (!state.asOf || state.loading) { if (!state.loading) void load(false); return; }
    deltaRequest?.abort();
    const controller = new AbortController();
    deltaRequest = controller;
    try {
      const { rows, total, asOf } = await fetchPage(`offset=0&limit=${DELTA_LIMIT}&fetchedSince=${encodeURIComponent(state.asOf)}`, controller.signal);
      if (controller.signal.aborted || deltaRequest !== controller) return;
      const known = byId(state.reviews);
      const updated = rows.filter((row) => known.has(row.id));
      const fresh = rows.filter((row) => !known.has(row.id));
      const merged = byId(state.pending);
      for (const row of fresh) merged.set(row.id, row);
      const reviews = updated.length ? state.reviews.map((row) => known.get(row.id) && rows.find((r) => r.id === row.id) ? rows.find((r) => r.id === row.id)! : row) : state.reviews;
      update({ reviews, pending: [...merged.values()], asOf, total: Math.max(total, state.total) });
    } catch {
      /* A failed delta is recovered by the next change or a manual reload. */
    } finally {
      if (deltaRequest === controller) deltaRequest = null;
    }
  }

  function showPending() {
    if (state.pending.length === 0) return;
    if (sort === "newest") {
      const reviews = [...byId([...state.pending, ...state.reviews]).values()];
      update({ reviews, pending: [], offset: state.offset + state.pending.length });
    } else {
      update({ pending: [] });
      void load(false);
    }
  }

  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    loadMore: () => load(true),
    retry: () => load(retryAppend),
    reload: () => load(false),
    delta,
    showPending,
    start: () => {
      active = true;
      void load();
      return () => { active = false; pendingRequest?.abort(); deltaRequest?.abort(); pendingRequest = null; deltaRequest = null; };
    },
  };
}

export function useMobileAppReviews(url: string, refreshKey: number) {
  const resource = useMemo(() => reviewResource(url), [url]);
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => resource.start(), [resource]);
  const seenKey = useRef(refreshKey);
  useEffect(() => {
    if (seenKey.current === refreshKey) return;
    seenKey.current = refreshKey;
    void resource.delta();
  }, [resource, refreshKey]);
  const loadMore = useCallback(() => resource.loadMore(), [resource]);
  const retry = useCallback(() => resource.retry(), [resource]);
  const reload = useCallback(() => resource.reload(), [resource]);
  const showPending = useCallback(() => resource.showPending(), [resource]);
  return { ...state, loadMore, retry, reload, showPending };
}
