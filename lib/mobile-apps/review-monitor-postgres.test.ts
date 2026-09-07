import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/roles", () => ({ getSessionRole: vi.fn() }));
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { getSessionRole } from "@/lib/auth/roles";
import { PUT } from "@/app/api/mobile-apps/notifications/route";
import { ensureReviewAlertSchema } from "./review-alert-schema";
import { resetMobileAppsSchemaCache } from "./ensure-schema";
import { DEFAULT_REVIEW_ALERT_CONFIG } from "./review-alert-config";
import { deliverMobileReviewAlerts, pollMobileReviews, type MonitorDeps } from "./review-monitor";
import { DeliveryError } from "./review-alert-delivery";

const url = process.env.MOBILE_REVIEWS_TEST_DATABASE_URL;
describe.skipIf(!url)("review monitoring on PostgreSQL", () => {
  const schema = `review_alert_test_${randomUUID().replaceAll("-", "")}`;
  let admin: postgres.Sql, sql: postgres.Sql, workspaceId: string, listingId: string;
  const send = vi.fn<MonitorDeps["send"]>();
  const sync = vi.fn<MonitorDeps["sync"]>();
  const deps: MonitorDeps = { enabled: async () => true, send, sync };
  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 8, prepare: false, connection: { search_path: schema }, onnotice: () => {} });
    await sql`create table workspaces (id uuid primary key default gen_random_uuid(), created_at timestamptz default now())`;
    const [workspace] = await sql`insert into workspaces default values returning id`;
    workspaceId = workspace.id;
    resetMobileAppsSchemaCache();
    await ensureReviewAlertSchema(sql);
    const [app] = await sql`insert into mobile_apps (workspace_id, name) values (${workspaceId}, 'Fixture') returning id`;
    const [listing] = await sql`insert into mobile_app_listings (mobile_app_id, store, store_app_id) values (${app.id}, 'google', 'com.fixture') returning id`;
    listingId = listing.id;
  });
  beforeEach(async () => {
    vi.mocked(getSql).mockReturnValue(sql);
    vi.mocked(getSession).mockResolvedValue({ sub: 'fixture', email: 'admin@example.com', name: 'Admin' });
    vi.mocked(getSessionRole).mockResolvedValue('admin');
    send.mockReset().mockResolvedValue(undefined); sync.mockReset().mockResolvedValue([]);
    await sql`truncate app_reviews, mobile_review_deliveries cascade`;
    const config = { ...DEFAULT_REVIEW_ALERT_CONFIG, emailEnabled: true, emailRecipients: ['first@example.com', 'second@example.com'], telegramEnabled: true, telegramChats: ['-10012345678'], maxRating: 3 };
    await sql`update mobile_review_settings set config = ${JSON.stringify(config)}::text::jsonb, generation = gen_random_uuid(), alerts_since = now() - interval '1 minute', next_poll_at = now(), last_error = null`;
  });
  afterAll(async () => {
    await sql?.end();
    if (admin) { await admin.unsafe(`drop schema if exists ${schema} cascade`); await admin.end(); }
    resetMobileAppsSchemaCache();
  });
  async function review(key: string, rating = 2, old = false) {
    return sql`insert into app_reviews(listing_id, store_review_id, rating, body, submitted_at)
      values(${listingId}, ${key}, ${rating}, 'A review', now() - ${old ? 86400 : 0} * interval '1 second')
      on conflict(listing_id, store_review_id) do update set body = excluded.body, fetched_at = now() returning id`;
  }
  it("atomically queues one delivery per destination, suppressing old reviews, updates and unmatched ratings", async () => {
    await review('new'); await review('new'); await review('old', 1, true); await review('positive', 5);
    const rows = await sql`select channel, recipient from mobile_review_deliveries`;
    expect(rows).toHaveLength(3);
    await expect(sql.begin(async tx => { await tx.unsafe("insert into app_reviews(listing_id, store_review_id, rating, submitted_at) values($1, 'rollback', 1, now())", [listingId]); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await sql`select id from mobile_review_deliveries`).toHaveLength(3);
    await deliverMobileReviewAlerts(sql, deps); await deliverMobileReviewAlerts(sql, deps);
    expect(send).toHaveBeenCalledTimes(3);
    expect((await sql`select distinct status from mobile_review_deliveries`).map(row => row.status)).toEqual(['sent']);
  });
  it("lets only one worker send and never retries an uncertain send", async () => {
    await review('new');
    send.mockRejectedValue(new DeliveryError('Unknown outcome', 'uncertain'));
    await Promise.all([deliverMobileReviewAlerts(sql, deps), deliverMobileReviewAlerts(sql, deps)]);
    await deliverMobileReviewAlerts(sql, deps);
    expect(send).toHaveBeenCalledTimes(3);
    expect((await sql`select distinct status from mobile_review_deliveries`).map(row => row.status)).toEqual(['uncertain']);
  });
  it("retries only definitely unsent deliveries and retains successful recipients", async () => {
    await review('new');
    send.mockImplementation(async (_channel, recipient) => { if (recipient === 'first@example.com') throw new DeliveryError('Not authenticated', 'retry'); });
    await deliverMobileReviewAlerts(sql, deps);
    expect(await sql`select id from mobile_review_deliveries where status = 'sent'`).toHaveLength(2);
    expect(await sql`select id from mobile_review_deliveries where status = 'pending'`).toHaveLength(1);
    await sql`update mobile_review_deliveries set next_attempt_at = now()`;
    send.mockResolvedValue(undefined);
    await deliverMobileReviewAlerts(sql, deps);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("cancels pending alerts when settings change and pauses when the module is disabled", async () => {
    await review('new');
    await deliverMobileReviewAlerts(sql, { ...deps, enabled: async () => false });
    expect(send).not.toHaveBeenCalled();
    await sql`update mobile_review_settings set generation = gen_random_uuid()`;
    await deliverMobileReviewAlerts(sql, deps);
    expect(send).not.toHaveBeenCalled();
    expect(await sql`select id from mobile_review_deliveries where status = 'cancelled'`).toHaveLength(3);
  });
  it("marks a crashed in-flight send uncertain instead of duplicating it", async () => {
    await review('new');
    await sql`update mobile_review_deliveries set status = 'sending'`;
    await deliverMobileReviewAlerts(sql, deps);
    expect(send).not.toHaveBeenCalled();
    expect(await sql`select id from mobile_review_deliveries where status = 'uncertain'`).toHaveLength(3);
  });
  it("polls while no page is open, skips early ticks, and never requests heavy reports", async () => {
    await Promise.all([pollMobileReviews(sql, deps), pollMobileReviews(sql, deps)]);
    await pollMobileReviews(sql, deps);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0][1]).toMatchObject({ syncReports: false, syncAppleStorefronts: false, dedupeMs: 60_000 });
    const [settings] = await sql`select heartbeat_at, last_checked_at from mobile_review_settings`;
    expect(settings.heartbeat_at).not.toBeNull(); expect(settings.last_checked_at).not.toBeNull();
  });
  it("backs off large Google feeds and surfaces provider failures", async () => {
    sync.mockResolvedValue([{ store: 'google', fetched: 1000, status: 'success' }] as Awaited<ReturnType<MonitorDeps['sync']>>);
    await pollMobileReviews(sql, deps);
    const [settings] = await sql`select extract(epoch from next_poll_at - last_checked_at)::int as delay from mobile_review_settings`;
    expect(settings.delay).toBeGreaterThanOrEqual(300);
    await sql`update mobile_review_settings set next_poll_at = now()`;
    sync.mockResolvedValue([{ store: 'apple', fetched: 0, status: 'failed', error: 'Permission denied' }] as Awaited<ReturnType<MonitorDeps['sync']>>);
    await pollMobileReviews(sql, deps);
    expect((await sql`select last_error from mobile_review_settings`)[0].last_error).toContain('Permission denied');
  });
  it("requires an admin, validates recipients, and prevents stale settings from overwriting a newer save", async () => {
    const [settings] = await sql`select generation from mobile_review_settings`;
    const request = (config = DEFAULT_REVIEW_ALERT_CONFIG) => new Request('http://localhost/api/mobile-apps/notifications', {
      method: 'PUT', body: JSON.stringify({ config, generation: settings.generation }),
    });
    vi.mocked(getSessionRole).mockResolvedValue('member');
    expect((await PUT(request())).status).toBe(403);
    vi.mocked(getSessionRole).mockResolvedValue('admin');
    expect((await PUT(request({ ...DEFAULT_REVIEW_ALERT_CONFIG, emailEnabled: true }))).status).toBe(422);
    expect((await PUT(request())).status).toBe(200);
    expect((await PUT(request())).status).toBe(409);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(request())).status).toBe(401);
  });
});
