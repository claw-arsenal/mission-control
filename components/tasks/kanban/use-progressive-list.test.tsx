// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProgressiveList } from "./use-progressive-list";

type ObserverCallback = (entries: Array<Pick<IntersectionObserverEntry, "isIntersecting">>) => void;
const observers: Array<{ callback: ObserverCallback; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }> = [];

beforeEach(() => {
  observers.length = 0;
  class FakeObserver {
    observed: Element[] = [];
    disconnect = vi.fn();
    constructor(public callback: ObserverCallback) { observers.push(this); }
    observe(element: Element) { this.observed.push(element); }
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("useProgressiveList", () => {
  it("shows the first page only until the sentinel scrolls into view", () => {
    const { result } = renderHook(() => useProgressiveList(60, { pageSize: 25 }));
    expect(result.current.visibleCount).toBe(25);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.hiddenCount).toBe(35);

    const sentinel = document.createElement("div");
    act(() => result.current.attachSentinel(sentinel));
    expect(observers.at(-1)?.observed).toContain(sentinel);

    act(() => observers.at(-1)!.callback([{ isIntersecting: true }]));
    expect(result.current.visibleCount).toBe(50);

    act(() => observers.at(-1)!.callback([{ isIntersecting: true }]));
    expect(result.current.visibleCount).toBe(60);
    expect(result.current.hasMore).toBe(false);
  });

  it("stops observing once everything is visible", () => {
    const { result } = renderHook(() => useProgressiveList(30, { pageSize: 25 }));
    act(() => result.current.attachSentinel(document.createElement("div")));
    const observer = observers.at(-1)!;
    act(() => observer.callback([{ isIntersecting: true }]));
    expect(result.current.hasMore).toBe(false);
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("never reveals more than the list holds and follows a shrinking list", () => {
    const { result, rerender } = renderHook(({ total }) => useProgressiveList(total, { pageSize: 10 }), { initialProps: { total: 25 } });
    act(() => result.current.revealAll());
    expect(result.current.visibleCount).toBe(25);
    rerender({ total: 4 });
    expect(result.current.visibleCount).toBe(4);
    expect(result.current.hasMore).toBe(false);
  });

  it("returns to the first page when the reset key changes", () => {
    const { result, rerender } = renderHook(({ key }) => useProgressiveList(100, { pageSize: 10, resetKey: key }), { initialProps: { key: "board-a" } });
    act(() => result.current.revealMore());
    expect(result.current.visibleCount).toBe(20);
    rerender({ key: "board-a" });
    expect(result.current.visibleCount).toBe(20);
    rerender({ key: "board-b" });
    expect(result.current.visibleCount).toBe(10);
  });
});
