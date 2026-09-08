import { describe, expect, it, vi } from "vitest";
import { coalesceChanges, parseChange, publishChange, type MobileAppsChange } from "./change-events";

const at = "2026-09-08T10:00:00.000Z";

describe("parseChange", () => {
  it("reads a typed payload", () => {
    const change = parseChange(JSON.stringify({ kind: "reports", appId: "A1", listingId: "L1", at }));
    expect(change).toEqual({ kind: "reports", appId: "A1", listingId: "L1", at });
  });

  it("maps the legacy {appId} trigger payload to a reviews change", () => {
    expect(parseChange('{"appId":"A1"}')).toMatchObject({ kind: "reviews", appId: "A1" });
    expect(parseChange('{"appId":null}')).toMatchObject({ kind: "reviews", appId: null });
  });

  it("rejects malformed or unknown payloads", () => {
    expect(parseChange("not json")).toBeNull();
    expect(parseChange('{"kind":"bogus","appId":"A1"}')).toBeNull();
    expect(parseChange('{"kind":"reviews","appId":42}')).toBeNull();
  });

  it("keeps job fields", () => {
    const change = parseChange(JSON.stringify({ kind: "job", appId: null, jobId: "J1", jobStatus: "running", at }));
    expect(change).toMatchObject({ kind: "job", jobId: "J1", jobStatus: "running" });
  });
});

describe("coalesceChanges", () => {
  it("keeps one change per kind, app and listing, latest wins, sums inserted reviews", () => {
    const changes: MobileAppsChange[] = [
      { kind: "reviews", appId: "A1", listingId: "L1", inserted: 2, at: "2026-09-08T10:00:00.000Z" },
      { kind: "reviews", appId: "A1", listingId: "L1", inserted: 3, at: "2026-09-08T10:00:01.000Z" },
      { kind: "listing", appId: "A1", listingId: "L1", at },
      { kind: "reviews", appId: "A2", at },
      { kind: "job", appId: "A1", jobId: "J1", jobStatus: "queued", at: "2026-09-08T10:00:00.000Z" },
      { kind: "job", appId: "A1", jobId: "J1", jobStatus: "running", at: "2026-09-08T10:00:02.000Z" },
    ];
    const out = coalesceChanges(changes);
    expect(out).toHaveLength(4);
    expect(out.find(c => c.kind === "reviews" && c.appId === "A1")).toMatchObject({ inserted: 5, at: "2026-09-08T10:00:01.000Z" });
    expect(out.find(c => c.kind === "job")).toMatchObject({ jobStatus: "running" });
  });

  it("preserves first-seen order", () => {
    const out = coalesceChanges([
      { kind: "app", appId: "A9", at },
      { kind: "reviews", appId: "A1", at },
      { kind: "app", appId: "A9", at },
    ]);
    expect(out.map(c => c.kind)).toEqual(["app", "reviews"]);
  });
});

describe("publishChange", () => {
  it("notifies the mobile_apps_change channel with a stamped JSON payload", async () => {
    const calls: Array<{ q: string; values: unknown[] }> = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ q: strings.join("?"), values });
      return Promise.resolve([]);
    }) as never;
    await publishChange(sql, { kind: "reviews", appId: "A1", inserted: 1 }, () => new Date(at));
    expect(calls[0].q).toMatch(/pg_notify\('mobile_apps_change'/);
    expect(JSON.parse(String(calls[0].values[0]))).toEqual({ kind: "reviews", appId: "A1", inserted: 1, at });
  });

  it("never throws when the notify fails", async () => {
    const sql = vi.fn(() => Promise.reject(new Error("connection lost"))) as never;
    await expect(publishChange(sql, { kind: "app", appId: "A1" })).resolves.toBeUndefined();
  });
});
