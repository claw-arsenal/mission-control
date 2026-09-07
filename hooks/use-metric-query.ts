"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricDef } from "@/lib/metrics/definition";
import type { WindowName } from "@/lib/metrics/window";
import { makeLimiter } from "@/lib/metrics/limiter";

const gate = makeLimiter(3);
type Result = {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
  loadedAt: string;
  window?: { since: string; until: string; bucket: string };
};

export function useMetricQuery(metric: MetricDef, window: WindowName, refreshKey: number) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Result>());
  const displayedKey = useRef("");
  const previousRefresh = useRef(refreshKey);
  const key = JSON.stringify([metric.id, metric.sql_text, window]);

  const load = useCallback(async (fresh = false) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const cached = cache.current.get(key);
    if (displayedKey.current !== key) setResult(cached ?? null);
    displayedKey.current = key;
    setError(null);
    if (cached && !fresh) { setResult(cached); setLoading(false); return; }
    setLoading(true);
    try {
      const next = await gate(async () => {
        request.signal.throwIfAborted();
        const response = await fetch("/api/metrics", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "runMetric", metricId: metric.id, window }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
        });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "The query could not be completed. Try again.");
        if (!Array.isArray(json.rows)) throw new Error("The query returned an unexpected response.");
        return { rows: json.rows, rowCount: json.rowCount ?? json.rows.length, durationMs: json.durationMs ?? 0,
          truncated: Boolean(json.truncated), window: json.window, loadedAt: new Date().toISOString() } satisfies Result;
      });
      if (request.signal.aborted) return;
      // Keep this cache bounded even after repeated edits and refreshes.
      if (cache.current.size >= 10) cache.current.delete(cache.current.keys().next().value!);
      cache.current.set(key, next);
      setResult(next);
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load this metric.");
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [key, metric.id, window]);

  useEffect(() => {
    const fresh = previousRefresh.current !== refreshKey;
    previousRefresh.current = refreshKey;
    void load(fresh);
    return () => controller.current?.abort();
  }, [load, refreshKey]);
  return { result, loading, error, refresh: () => load(true) };
}
