// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MobileAppsStoreProvider } from "@/components/mobile-apps/store-provider";
import { createMobileAppsStore, type StoreDeps, type StreamHandlers } from "@/lib/mobile-apps/client/live-store";
import { useMobileAppDetail } from "./use-mobile-app-detail";

const core = (name: string) => ({ ok: true, app: { id: "A1", name, icon_url: null }, listings: [], summary: [], trend: [], syncRuns: [], negativeThreshold: 3, freshness: { googleReports: { status: "unknown" } }, asOf: "t" });

function deferred() {
  let resolve!: (value: Record<string, unknown>) => void;
  const promise = new Promise<Record<string, unknown>>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(router: (url: string, init?: Parameters<StoreDeps["fetchJson"]>[1]) => Promise<Record<string, unknown>>) {
  let handlers: StreamHandlers | null = null;
  const closed = vi.fn();
  const store = createMobileAppsStore({
    fetchJson: router,
    openStream: (_url, h) => { handlers = h; return closed; },
    storage: { read: () => null, write: () => {} },
    now: () => Date.now(),
    online: () => true,
  });
  const wrapper = ({ children }: { children: ReactNode }) => <MobileAppsStoreProvider store={store}>{children}</MobileAppsStoreProvider>;
  return { store, wrapper, stream: () => handlers!, closed };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("app-detail request lifecycle", () => {
  it("keeps polling a queued job across stale detail responses and exposes its failure without SSE", async () => {
    vi.useFakeTimers();
    const { wrapper } = setup(async (url) =>
      url.endsWith("ensure-fresh") ? { ok: true, liveFresh: true }
        : url.endsWith("reports/sync") ? { ok: true, jobId: "job-1", status: "queued" }
          : url.includes("reports/status") ? { ok: true, jobs: [{ status: "failed", errorMessage: "Worker unavailable" }] }
            : core("Cached app"));
    const { result } = renderHook(() => useMobileAppDetail("A1"), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await result.current.refreshGoogleReports(); });
    expect(result.current.data?.freshness?.googleReports?.status).toBe("refreshing");
    expect(result.current.job).toMatchObject({ id: "job-1", status: "queued" });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.error).toBe("Worker unavailable");
    expect(result.current.job?.status).toBe("failed");
    expect(result.current.data?.app.name).toBe("Cached app");
    expect(result.current.data?.freshness?.googleReports?.status).toBe("unknown");
  });

  it("retains newer detail when an earlier request completes late", async () => {
    const old = deferred();
    let loads = 0;
    const { wrapper, stream } = setup(async (url) => url.endsWith("ensure-fresh") ? { ok: true, liveFresh: true } : url.startsWith("/api/mobile-apps/A1?") && ++loads === 1 ? old.promise : core("new"));
    const { result } = renderHook(() => useMobileAppDetail("A1"), { wrapper });
    await act(async () => { stream().onChange({ kind: "reviews", appId: "A1", at: "t" }); });
    await waitFor(() => expect(result.current.data?.app.name).toBe("new"));
    await act(async () => { old.resolve(core("old")); });
    expect(result.current.data?.app.name).toBe("new");
    expect(result.current.refreshKey).toBeGreaterThan(0);
  });

  it("keeps cached details visible and surfaces partial store failures during manual refresh", async () => {
    const { wrapper } = setup(async (url) => url.endsWith("ensure-fresh")
      ? { ok: true, liveFresh: true }
      : url.endsWith("/sync") ? { ok: true, byStore: { google: { failed: 1, error: "Google is unavailable" } } }
        : core("cached"));
    const { result } = renderHook(() => useMobileAppDetail("A1"), { wrapper });
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(result.current.data?.app.name).toBe("cached");
    let outcome;
    await act(async () => { outcome = await result.current.refreshNow(); });
    expect(outcome).toMatchObject({ ok: false });
    expect(result.current.error).toBe("Google is unavailable");
    expect(result.current.data?.app.name).toBe("cached");
  });

  it("aborts old app requests and never displays their data for a different app", async () => {
    const pending = deferred();
    const signals: Array<AbortSignal | undefined> = [];
    const { wrapper } = setup(async (url, init) => { if (url.includes("include=core")) signals.push(init?.signal); return pending.promise; });
    const { result, rerender } = renderHook(({ appId }) => useMobileAppDetail(appId), { wrapper, initialProps: { appId: "A1" } });
    rerender({ appId: "A2" });
    expect(signals[0]?.aborted).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("shows cached data immediately on remount and releases the stream on the last unmount", async () => {
    const { wrapper, closed } = setup(async (url) => url.endsWith("ensure-fresh") ? { ok: true, liveFresh: true } : core("first"));
    const first = renderHook(() => useMobileAppDetail("A1"), { wrapper });
    await waitFor(() => expect(first.result.current.data?.app.name).toBe("first"));
    first.unmount();
    expect(closed).toHaveBeenCalledTimes(1);
    const second = renderHook(() => useMobileAppDetail("A1"), { wrapper });
    expect(second.result.current.data?.app.name).toBe("first");
    expect(second.result.current.loading).toBe(false);
  });
});
