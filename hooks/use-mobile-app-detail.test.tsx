// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMobileAppDetail } from "./use-mobile-app-detail";

const response = (name: string) => new Response(JSON.stringify({ ok: true, app: { id: name, name } }));
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}
class Events extends EventTarget {
  static latest: Events;
  constructor() { super(); Events.latest = this; }
  close = vi.fn();
}

beforeEach(() => { vi.stubGlobal("EventSource", Events); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("app-detail request lifecycle", () => {
  it("keeps polling a queued job across stale detail responses and exposes its failure without SSE", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
      url.endsWith("ensure-fresh") ? { ok: true, liveFresh: true }
        : url.endsWith("reports/sync") ? { ok: true, jobId: "job-1" }
          : url.includes("reports/status") ? { ok: true, jobs: [{ status: "failed", errorMessage: "Worker unavailable" }] }
            : { ok: true, app: { id: "A1", name: "Cached app" }, freshness: { googleReports: { status: "unknown" } } }
    )))));
    const { result } = renderHook(() => useMobileAppDetail("A1"));
    await act(async () => {});
    await act(async () => { await result.current.refreshGoogleReports(); });
    await act(async () => { await result.current.load(); });
    expect(result.current.data?.freshness?.googleReports?.status).toBe("refreshing");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.error).toBe("Worker unavailable");
    expect(result.current.data?.app.name).toBe("Cached app");
    expect(result.current.data?.freshness?.googleReports?.status).toBe("unknown");
  });
  it("retains newer detail when an earlier request completes late", async () => {
    const old = deferred();
    const sync = deferred();
    let loads = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("ensure-fresh") ? sync.promise : ++loads === 1 ? old.promise : Promise.resolve(response("new"))));
    const { result } = renderHook(() => useMobileAppDetail("A1"));
    await act(async () => { Events.latest.dispatchEvent(new MessageEvent("change", { data: '{"appId":"A1"}' })); });
    await waitFor(() => expect(result.current.data?.app.name).toBe("new"));
    await act(async () => { old.resolve(response("old")); });
    expect(result.current.data?.app.name).toBe("new");
  });

  it("keeps cached details visible and surfaces partial store failures during manual refresh", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.endsWith("ensure-fresh")
      ? new Response(JSON.stringify({ ok: true, liveFresh: true }))
      : url.endsWith("/sync")
        ? new Response(JSON.stringify({ ok: true, byStore: { google: { failed: 1, error: "Google is unavailable" } } }))
        : response("cached"))));
    const { result } = renderHook(() => useMobileAppDetail("A1"));
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
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => { signals.push(init.signal as AbortSignal); return pending.promise; }));
    const { result, rerender } = renderHook(({ appId }) => useMobileAppDetail(appId), { initialProps: { appId: "A1" } });
    rerender({ appId: "A2" });
    expect(signals[0].aborted).toBe(true);
    expect(result.current.data).toBeNull();
  });
});
