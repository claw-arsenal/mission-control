"use client";

import { useEffect, useRef } from "react";

export type ShortcutMap = Record<string, (event: KeyboardEvent) => void>;

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

/**
 * Single-key shortcuts for the page. Keys are matched on `event.key`; a
 * combination like "shift+/" is written with a plus. Shortcuts are ignored
 * while typing in a field, except Escape, and never fire with Ctrl/Meta held.
 */
export function useKeyboardShortcuts(map: ShortcutMap, enabled = true) {
  const latest = useRef(map);
  useEffect(() => { latest.current = map; }, [map]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const typing = isTyping(event.target);
      if (typing && event.key !== "Escape") return;
      const key = `${event.shiftKey && event.key.length > 1 ? "shift+" : ""}${event.key}`;
      const handler = latest.current[key] ?? latest.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
