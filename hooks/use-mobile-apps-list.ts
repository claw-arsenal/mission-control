"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useMobileAppsStore } from "@/components/mobile-apps/store-provider";
import type { Connection, ListState } from "@/lib/mobile-apps/client/live-store";

export function useLiveConnection(enabled = true): { connection: Connection; serverTime: string | null } {
  const store = useMobileAppsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => (enabled ? store.connect() : undefined), [store, enabled]);
  return { connection: snapshot.connection, serverTime: snapshot.serverTime };
}

export function useMobileAppsList(enabled = true): ListState & { reload: () => Promise<void>; connection: Connection } {
  const store = useMobileAppsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => (enabled ? store.openList() : undefined), [store, enabled]);
  const reload = useCallback(() => store.loadList(), [store]);
  return { ...snapshot.list, reload, connection: snapshot.connection };
}
