// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgenda } from "./use-agenda";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

const response = (id: string) => Response.json({ ok: true, events: [{ id, title: id, starts_at: "2026-09-07T10:00:00Z" }] });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Agenda calendar requests", () => {
  it("keeps the newest date range when responses arrive out of order", async () => {
    const old = deferredResponse();
    const current = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
    const { result } = renderHook(() => useAgenda());
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.loadEvents("2026-09-01", "2026-09-07");
      second = result.current.loadEvents("2026-09-08", "2026-09-14");
    });
    await act(async () => { current.resolve(response("current week")); await second; });
    await act(async () => { old.resolve(response("previous week")); await first; });
    expect(result.current.events[0].id).toBe("current week");
  });

  it("does not finish initial loading when only a superseded request has settled", async () => {
    const old = deferredResponse();
    const current = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
    const { result } = renderHook(() => useAgenda());
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.loadEvents("2026-09-01", "2026-09-07");
      second = result.current.loadEvents("2026-09-08", "2026-09-14");
    });
    await act(async () => { old.resolve(response("old")); await first; });
    expect(result.current.loading).toBe(true);
    await act(async () => { current.resolve(response("current")); await second; });
  });

  it("refreshes the visible range and preserves cached events on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response("saved event"))
      .mockResolvedValueOnce(Response.json({ ok: false, error: "Calendar unavailable" }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAgenda());
    await act(() => result.current.loadEvents("2026-09-01", "2026-09-07"));
    await act(() => result.current.loadEvents());
    expect(fetchMock.mock.calls[1][0]).toContain("start=2026-09-01&end=2026-09-07");
    expect(result.current.events[0].id).toBe("saved event");
    expect(result.current.error).toBe("Calendar unavailable");
    expect(result.current.loading).toBe(false);
  });
});
