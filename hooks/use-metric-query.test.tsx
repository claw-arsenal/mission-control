// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMetricQuery } from "./use-metric-query";
import type { MetricDef } from "@/lib/metrics/definition";
const metric = { id: "metric", sql_text: "SELECT :bucket", name: "Activity" } as MetricDef;
const result = (value: number) => new Response(JSON.stringify({ ok: true, rows: [{ value }], rowCount: 1 }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("metric loading", () => {
  it("ignores an old range response even when the transport ignores cancellation", async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
    const { result: state, rerender } = renderHook(({ window }) => useMetricQuery(metric, window, 0), { initialProps: { window: "monthly" as "monthly" | "daily" } });
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ window: "daily" });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1](result(20)));
    await act(async () => pending[0](result(10)));
    expect(state.current.result?.rows).toEqual([{ value: 20 }]);
  });
  it("retains the previous result during a failed dashboard refresh", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(result(20)).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Database unavailable" }), { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const { result: state, rerender } = renderHook(({ refresh }) => useMetricQuery(metric, "monthly", refresh), { initialProps: { refresh: 0 } });
    await waitFor(() => expect(state.current.result?.rows).toEqual([{ value: 20 }]));
    rerender({ refresh: 1 });
    await waitFor(() => expect(state.current.error).toBe("Database unavailable"));
    expect(state.current.result?.rows).toEqual([{ value: 20 }]);
    expect(state.current.loading).toBe(false);
  });
});
