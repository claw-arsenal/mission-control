"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type Preferences = { mode: "focused" | "all"; selectedIds: string[] | null };
const STORAGE_KEY = "mc-metrics-visibility-v1";
const DEFAULTS: Preferences = { mode: "focused", selectedIds: null };

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function readPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && (saved.mode === "focused" || saved.mode === "all") &&
      (saved.selectedIds === null || (Array.isArray(saved.selectedIds) && saved.selectedIds.every((id: unknown) => typeof id === "string")))) {
      return { mode: saved.mode, selectedIds: saved.selectedIds };
    }
  } catch { /* A blocked or stale browser store should not prevent viewing metrics. */ }
  return DEFAULTS;
}

export function useMetricVisibility(metrics: { id: string }[] | null) {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
    catch { /* Keep the current selection usable when browser storage is unavailable. */ }
  }, [preferences, ready]);

  const selectedIds = new Set(preferences.selectedIds ?? (metrics ?? []).slice(0, 4).map(metric => metric.id));
  const setMode = (mode: Preferences["mode"]) => setPreferences(current => ({ ...current, mode }));
  const select = (ids: string[]) => setPreferences({ mode: "focused", selectedIds: ids });
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    select([...next]);
  };

  return { ready, mode: preferences.mode, selectedIds, setMode, select, toggle };
}
