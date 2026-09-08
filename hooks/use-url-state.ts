"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Primitive = string | number | boolean | null;

/**
 * Filters and view state in the URL so reload, back and shared links keep the
 * operator's context. Defaults are omitted from the URL; `replace` never scrolls.
 */
export function useUrlState<T extends Record<string, Primitive>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state = useMemo(() => {
    const out = { ...defaults } as T;
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const raw = params.get(String(key));
      if (raw == null) continue;
      const fallback = defaults[key];
      if (typeof fallback === "number") { const n = Number(raw); if (Number.isFinite(n)) (out as Record<string, Primitive>)[String(key)] = n; }
      else if (typeof fallback === "boolean") (out as Record<string, Primitive>)[String(key)] = raw === "1" || raw === "true";
      else (out as Record<string, Primitive>)[String(key)] = raw;
    }
    return out;
  }, [params, defaults]);

  const setState = useCallback((patch: Partial<T>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      const fallback = defaults[key as keyof T];
      if (value == null || value === fallback || value === "") next.delete(key);
      else next.set(key, typeof value === "boolean" ? "1" : String(value));
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, router, pathname, defaults]);

  return [state, setState];
}
