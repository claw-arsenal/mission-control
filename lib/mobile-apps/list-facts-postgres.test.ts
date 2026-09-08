import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: "s", name: "n", email: "u@example.com" })) }));
vi.mock("@/lib/modules/state", () => ({ isModuleEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));
vi.mock("./config", async (original) => ({
  ...(await original<typeof import("./config")>()),
  loadMobileReviewsConfig: vi.fn(() => ({ sync: { negativeThreshold: 3 } })),
}));
vi.mock("./sync", () => ({ syncApp: vi.fn(async () => []) }));

import { getSql } from "@/lib/local-db";
import { ensureMobileAppsSchema, resetMobileAppsSchemaCache } from "./ensure-schema";
import { GET } from "@/app/api/mobile-apps/route";

// Opt in with a disposable PostgreSQL database; each run owns a unique schema.
const databaseUrl = process.env.MOBILE_REPORTS_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("app list facts on PostgreSQL", () => {
  const schema = `mobile_list_test_${randomUUID().replaceAll("-", "")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    await admin`create schema ${admin(schema)}`;
    sql = postgres(databaseUrl!, { max: 2, prepare: false, connection: { search_path: schema }, onnotice: () => {} });
    vi.mocked(getSql).mockReturnValue(sql as never);

    // `workspaces` belongs to the core schema, not this module's.
    await sql`create table workspaces (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now())`;
    resetMobileAppsSchemaCache();
    await ensureMobileAppsSchema(sql);

    const [workspace] = await sql<{ id: string }[]>`insert into workspaces default values returning id::text`;

    // Alpha: two listings, recent reviews, one failed check, Google reports stale.
    const [alpha] = await sql<{ id: string }[]>`
      insert into mobile_apps (workspace_id, name) values (${workspace.id}::uuid, 'Alpha') returning id::text`;
    const [alphaGoogle] = await sql<{ id: string }[]>`
      insert into mobile_app_listings (mobile_app_id, store, store_app_id, country, last_synced_at)
      values (${alpha.id}::uuid, 'google', 'com.alpha', 'nl', now() - interval '3 minutes') returning id::text`;
    const [alphaApple] = await sql<{ id: string }[]>`
      insert into mobile_app_listings (mobile_app_id, store, store_app_id, country, last_synced_at)
      values (${alpha.id}::uuid, 'apple', '111', 'nl', now() - interval '9 minutes') returning id::text`;
    for (const [store_review_id, rating, ago] of [["r1", 5, "1 day"], ["r2", 2, "2 days"], ["r3", 1, "3 days"], ["old", 1, "40 days"]] as const) {
      await sql`
        insert into app_reviews (listing_id, store_review_id, rating, submitted_at)
        values (${alphaGoogle.id}::uuid, ${store_review_id}, ${rating}, now() - ${ago}::interval)`;
    }
    await sql`
      insert into app_review_sync_runs (listing_id, store, app_identifier, status, started_at)
      values (${alphaApple.id}::uuid, 'apple', '111', 'failed', now())`;
    await sql`
      insert into app_review_sync_runs (listing_id, store, app_identifier, status, started_at)
      values (${alphaApple.id}::uuid, 'apple', '111', 'success', now() - interval '1 hour')`;
    await sql`
      insert into mobile_app_report_freshness (listing_id, status, checked_at)
      values (${alphaGoogle.id}::uuid, 'stale', now())`;

    // Bravo: Apple only, no reviews, no freshness row.
    const [bravo] = await sql<{ id: string }[]>`
      insert into mobile_apps (workspace_id, name) values (${workspace.id}::uuid, 'Bravo') returning id::text`;
    await sql`
      insert into mobile_app_listings (mobile_app_id, store, store_app_id, country)
      values (${bravo.id}::uuid, 'apple', '222', 'us')`;
  });

  afterAll(async () => {
    await admin`drop schema if exists ${admin(schema)} cascade`.catch(() => null);
    await sql?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
    resetMobileAppsSchemaCache();
  });

  it("computes activity, sync health and the worst report freshness in one query", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      apps: Array<{ name: string; listings: Array<{ store: string }>; facts: Record<string, unknown> }>;
      negativeThreshold: number;
      asOf: string;
    };

    const alpha = json.apps.find((a) => a.name === "Alpha")!;
    // Three reviews in the window; the 40-day-old one is excluded.
    expect(alpha.facts.reviewsLast7d).toBe(3);
    // Two of them are at or below the negative threshold of 3.
    expect(alpha.facts.negativeLast7d).toBe(2);
    // The most recent check across the app's listings.
    expect(typeof alpha.facts.lastCheckedAt).toBe("string");
    // Only the LATEST run per listing counts, so an older success cannot mask it.
    expect(alpha.facts.syncFailed).toBe(true);
    expect(alpha.facts.reportsStatus).toBe("stale");
    expect(alpha.listings).toHaveLength(2);

    const bravo = json.apps.find((a) => a.name === "Bravo")!;
    expect(bravo.facts.reviewsLast7d).toBe(0);
    expect(bravo.facts.negativeLast7d).toBe(0);
    expect(bravo.facts.lastCheckedAt).toBeNull();
    expect(bravo.facts.syncFailed).toBe(false);
    // An app with no Google listing has no report freshness to report.
    expect(bravo.facts.reportsStatus).toBeNull();

    expect(json.negativeThreshold).toBe(3);
    expect(Date.parse(json.asOf)).toBeGreaterThan(0);
    // Facts are counts and states; a rating in the list would be ambiguous.
    expect(JSON.stringify(json.apps.map((a) => a.facts))).not.toMatch(/rating/i);
  });
});
