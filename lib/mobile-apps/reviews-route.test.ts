import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/modules/state", () => ({ isModuleEnabled: vi.fn() }));
vi.mock("@/lib/mobile-apps/ensure-schema", () => ({ ensureMobileAppsSchema: vi.fn(async () => {}) }));
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));

import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { getSql } from "@/lib/local-db";
import { GET, reviewsToCsv } from "@/app/api/mobile-apps/[id]/reviews/route";

const session = vi.mocked(getSession);
const moduleEnabled = vi.mocked(isModuleEnabled);

function fakeSql() {
  const fn = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const q = strings.join(" ");
    if (q.includes("from workspaces")) return Promise.resolve([{ id: "w1" }]);
    if (q.includes("from mobile_apps where id")) return Promise.resolve([{ id: "app1" }]);
    if (q.includes("from mobile_app_listings where mobile_app_id")) return Promise.resolve([{ id: "L1" }]);
    if (q.includes("count(*)::int as total")) return Promise.resolve([{ total: 50 }]);
    if (q.includes("from app_reviews r join mobile_app_listings l"))
      return Promise.resolve(Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, store: "google", rating: 5 })));
    return Promise.resolve([]);
  };
  (fn as unknown as { array: (a: unknown) => unknown }).array = (a: unknown) => a;
  return fn;
}

const params = Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" });
const req = (qs = "") => new Request(`http://localhost/api/mobile-apps/x/reviews${qs}`);

afterEach(() => vi.restoreAllMocks());

describe("reviews route", () => {
  it("requires authentication", async () => {
    session.mockResolvedValue(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid sort value (422)", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    const res = await GET(req("?sort=banana"), { params });
    expect(res.status).toBe(422);
  });

  it("accepts a since/until window (for 'reviews of today' crons)", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    const res = await GET(req("?since=2026-06-09T00:00:00.000Z&until=2026-06-10T00:00:00.000Z"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("accepts a date-only since (2026-06-09)", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    const res = await GET(req("?since=2026-06-09"), { params });
    expect(res.status).toBe(200);
  });

  it("rejects an unparseable since value (422)", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    const res = await GET(req("?since=notadate"), { params });
    expect(res.status).toBe(422);
  });

  it("accepts fetchedSince and responded filters and stamps asOf", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    const res = await GET(req("?fetchedSince=2026-09-08T10:00:00.000Z&responded=false"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.asOf).toBe("string");
    expect(json.reviews).toHaveLength(30);
  });

  it("rejects an invalid responded value (422)", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    expect((await GET(req("?responded=maybe"), { params })).status).toBe(422);
  });

  it("exports the filtered feed as a CSV attachment", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    const res = await GET(req("?format=csv&rating=1"), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe("id,store,submitted_at,rating,title,body,author,app_version,country,language,store_response,fetched_at");
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(31);
  });

  it("escapes quotes, commas and newlines in CSV cells", () => {
    const csv = reviewsToCsv([{ id: "1", store: "google", title: 'He said "hi", then\nleft', body: null }]);
    expect(csv).toContain('"He said ""hi"", then\nleft"');
  });

  it("paginates: returns a page plus total/hasMore/nextOffset", async () => {
    session.mockResolvedValue({ sub: "s", name: "n", email: "u@example.com" });
    moduleEnabled.mockResolvedValue(true);
    vi.mocked(getSql).mockReturnValue(fakeSql() as never);
    const res = await GET(req("?limit=30&offset=0"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reviews).toHaveLength(30);
    expect(json.total).toBe(50);
    expect(json.hasMore).toBe(true);
    expect(json.nextOffset).toBe(30);
  });
});
