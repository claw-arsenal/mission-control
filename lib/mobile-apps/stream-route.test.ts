import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/modules/state", () => ({ isModuleEnabled: vi.fn() }));
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn(() => () => Promise.resolve([])) }));

import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { GET } from "@/app/api/mobile-apps/stream/route";

const req = () => new Request("http://localhost/api/mobile-apps/stream");

beforeEach(() => { vi.mocked(isModuleEnabled).mockResolvedValue(true); vi.mocked(getSession).mockResolvedValue({ sub: "fixture", name: "Fixture", email: "fixture@example.com" }); });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("SSE /api/mobile-apps/stream auth gate", () => {
  it("rejects unauthenticated requests with 401 (no open DB LISTEN)", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("rejects when the module is disabled with 503", async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    vi.mocked(isModuleEnabled).mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(503);
  });
});

it("coalesces a review burst and releases its listener on disconnect", async () => {
  vi.useFakeTimers();
  let notify!: (payload: string) => void;
  const unlisten = vi.fn().mockResolvedValue(undefined);
  vi.mocked(getSql).mockReturnValue({ listen: vi.fn(async (_channel, callback) => { notify = callback; return { unlisten }; }) } as unknown as ReturnType<typeof getSql>);
  const controller = new AbortController();
  const response = await GET(new Request('http://localhost/api/mobile-apps/stream', { signal: controller.signal }));
  const reader = response.body!.getReader();
  await reader.read();
  for (let i = 0; i < 100; i++) notify('{"appId":"fixture"}');
  await vi.advanceTimersByTimeAsync(500);
  const chunk = new TextDecoder().decode((await reader.read()).value);
  expect(chunk).toBe('event: change\ndata: {"appId":"fixture"}\n\n');
  controller.abort();
  expect((await reader.read()).done).toBe(true);
  expect(unlisten).toHaveBeenCalledTimes(1);
});
