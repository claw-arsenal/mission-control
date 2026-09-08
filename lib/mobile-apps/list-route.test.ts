import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/modules/state", () => ({ isModuleEnabled: vi.fn() }));
vi.mock("@/lib/mobile-apps/ensure-schema", () => ({ ensureMobileAppsSchema: vi.fn(async () => {}) }));
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));
vi.mock("@/lib/mobile-apps/sync", () => ({ syncApp: vi.fn(async () => []) }));
vi.mock("@/lib/mobile-apps/config", () => ({ loadMobileReviewsConfig: vi.fn(() => ({ sync: { negativeThreshold: 3 } })) }));

import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { getSql } from "@/lib/local-db";
import { GET, DELETE } from "@/app/api/mobile-apps/route";

function fakeSql(apps: unknown[]) {
  const calls: Array<{ q: string; values: unknown[] }> = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const q = strings.join("?");
    calls.push({ q, values });
    if (q.includes("from workspaces")) return Promise.resolve([{ id: "w1" }]);
    if (q.includes("from mobile_apps a")) return Promise.resolve(apps);
    return Promise.resolve([]);
  };
  return { fn, calls };
}

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
  vi.mocked(isModuleEnabled).mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/mobile-apps facts", () => {
  it("summarizes the worst report freshness by priority, not alphabetically, and never returns a rating in facts", async () => {
    const { fn } = fakeSql([
      { id: "A1", name: "One", icon_url: null, notes: null, listings: [], facts: { reviewsLast7d: 4, negativeLast7d: 1, lastCheckedAt: "x", syncFailed: false, reportStatuses: ["fresh", "stale"] } },
      { id: "A2", name: "Two", icon_url: null, notes: null, listings: [], facts: { reviewsLast7d: 0, negativeLast7d: 0, lastCheckedAt: null, syncFailed: true, reportStatuses: ["failed", "fresh"] } },
      { id: "A3", name: "Apple only", icon_url: null, notes: null, listings: [], facts: { reviewsLast7d: 0, negativeLast7d: 0, lastCheckedAt: null, syncFailed: false, reportStatuses: [] } },
    ]);
    vi.mocked(getSql).mockReturnValue(fn as never);
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.apps[0].facts).toEqual({ reviewsLast7d: 4, negativeLast7d: 1, lastCheckedAt: "x", syncFailed: false, reportsStatus: "stale" });
    expect(json.apps[1].facts.reportsStatus).toBe("failed");
    expect(json.apps[2].facts.reportsStatus).toBeNull();
    expect(JSON.stringify(json.apps.map((a: { facts: unknown }) => a.facts))).not.toMatch(/rating/i);
    expect(typeof json.asOf).toBe("string");
    expect(json.negativeThreshold).toBe(3);
  });
});

describe("DELETE /api/mobile-apps", () => {
  it("publishes an app change after deleting", async () => {
    const { fn, calls } = fakeSql([]);
    vi.mocked(getSql).mockReturnValue(fn as never);
    const res = await DELETE(new Request("http://localhost/api/mobile-apps", { method: "DELETE", body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }) }));
    expect(res.status).toBe(200);
    const notify = calls.find((c) => /pg_notify\('mobile_apps_change'/.test(c.q));
    expect(JSON.parse(String(notify?.values[0]))).toMatchObject({ kind: "app", appId: "11111111-1111-4111-8111-111111111111" });
  });
});
