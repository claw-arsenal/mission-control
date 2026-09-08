import { parseChange } from "@/lib/mobile-apps/change-events";
import { createMobileAppsStore, type FetchInit, type MobileAppsStore, type PersistedSnapshot, type StoreDeps } from "./live-store";

export const STORAGE_KEY = "mc.mobile-apps.v1";

/** JSON fetch with a timeout, `ok` envelope checks and user-facing errors. */
export async function fetchJson(url: string, init: FetchInit = {}): Promise<Record<string, unknown>> {
  const signals = [AbortSignal.timeout(init.timeoutMs ?? 30_000), ...(init.signal ? [init.signal] : [])];
  const response = await fetch(url, {
    method: init.method ?? "GET",
    cache: "no-store",
    signal: AbortSignal.any(signals),
    ...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (!response.ok || !json || json.ok === false) {
    const error = typeof json?.error === "string" ? json.error : `Request failed (${response.status}). Try again.`;
    throw new Error(error);
  }
  return json;
}

export const openStream: StoreDeps["openStream"] = (url, handlers) => {
  const events = new EventSource(url);
  events.addEventListener("hello", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data || "{}");
      if (typeof data.serverTime === "string") handlers.onHello(data.serverTime);
    } catch { /* ignore */ }
  });
  events.addEventListener("change", (event) => {
    const change = parseChange(String((event as MessageEvent).data ?? ""));
    if (change) handlers.onChange(change);
  });
  events.addEventListener("open", () => handlers.onOpen());
  events.addEventListener("error", () => handlers.onError());
  return () => events.close();
};

export const localStorageAdapter: StoreDeps["storage"] = {
  read() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedSnapshot;
      return parsed && parsed.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  },
  write(snapshot) {
    const attempts: PersistedSnapshot[] = [
      snapshot,
      { ...snapshot, apps: Object.fromEntries(Object.entries(snapshot.apps).map(([id, app]) => [id, { ...app, reports: null }])) },
    ];
    for (const candidate of attempts) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
        return;
      } catch {
        /* quota or privacy mode: try the smaller payload, then give up silently */
      }
    }
  },
};

let singleton: MobileAppsStore | null = null;

/** One store per browser tab, with window-level online/visibility wiring. */
export function getMobileAppsStore(): MobileAppsStore {
  if (singleton) return singleton;
  const store = createMobileAppsStore({
    fetchJson,
    openStream,
    storage: typeof window === "undefined" ? { read: () => null, write: () => {} } : localStorageAdapter,
    now: () => Date.now(),
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  });
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => store.notifyOnline(true));
    window.addEventListener("offline", () => store.notifyOnline(false));
    let hiddenAt: number | null = null;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt != null) { store.notifyVisible(Date.now() - hiddenAt); hiddenAt = null; }
    });
  }
  singleton = store;
  return store;
}
