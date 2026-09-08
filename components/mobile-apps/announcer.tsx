"use client";

import { useCallback, useRef, useState } from "react";

/**
 * One polite live region per page. `announce` replaces the text (with a blank
 * beat so identical messages are re-read) instead of stacking toasts.
 */
export function useAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage("");
    timer.current = setTimeout(() => setMessage(text), 50);
  }, []);
  const region = <p role="status" aria-live="polite" className="sr-only">{message}</p>;
  return { announce, region };
}
