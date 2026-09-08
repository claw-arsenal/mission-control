"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

const read = (key: string | null) => {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * A raw localStorage value that stays in sync across components and tabs.
 *
 * The server snapshot is always null, so a server-rendered page hydrates
 * cleanly and then adopts the remembered value. Writes go through the returned
 * setter; pass null to forget the value. Storage failures are silently ignored.
 */
export function useLocalStorageValue(key: string | null): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key), () => null);

  const setValue = useCallback((next: string | null) => {
    if (!key) return;
    try {
      if (next === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, next);
    } catch {
      /* storage unavailable: the in-memory value simply does not persist */
    }
    notify();
  }, [key]);

  return [value, setValue];
}
