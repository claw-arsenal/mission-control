// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocalStorageValue } from "./use-local-storage-value";

beforeEach(() => window.localStorage.clear());

describe("useLocalStorageValue", () => {
  it("reads the stored value and persists writes", () => {
    window.localStorage.setItem("pref", "a");
    const { result } = renderHook(() => useLocalStorageValue("pref"));
    expect(result.current[0]).toBe("a");
    act(() => result.current[1]("b"));
    expect(result.current[0]).toBe("b");
    expect(window.localStorage.getItem("pref")).toBe("b");
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
  });

  it("keeps two readers of the same key in step", () => {
    const first = renderHook(() => useLocalStorageValue("shared"));
    const second = renderHook(() => useLocalStorageValue("shared"));
    act(() => first.result.current[1]("x"));
    expect(second.result.current[0]).toBe("x");
  });

  it("is inert without a key", () => {
    const { result } = renderHook(() => useLocalStorageValue(null));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]("ignored"));
    expect(window.localStorage.length).toBe(0);
  });
});
