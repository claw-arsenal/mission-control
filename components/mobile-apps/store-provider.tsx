"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MobileAppsStore } from "@/lib/mobile-apps/client/live-store";
import { getMobileAppsStore } from "@/lib/mobile-apps/client/browser-deps";

const StoreContext = createContext<MobileAppsStore | null>(null);

/**
 * Supplies the shared Mobile Applications store. Pages use the browser
 * singleton; tests and the preview harness pass a store built with fake deps.
 */
export function MobileAppsStoreProvider({ store, children }: { store?: MobileAppsStore; children: ReactNode }) {
  const value = useMemo(() => store ?? getMobileAppsStore(), [store]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useMobileAppsStore(): MobileAppsStore {
  const fromContext = useContext(StoreContext);
  return fromContext ?? getMobileAppsStore();
}
