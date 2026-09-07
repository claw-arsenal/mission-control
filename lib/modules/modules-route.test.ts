import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/roles", () => ({ getSessionRole: vi.fn() }));
vi.mock("@/lib/skills/discovery", () => ({ discoverSkills: vi.fn() }));
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { getSessionRole } from "@/lib/auth/roles";
import { discoverSkills } from "@/lib/skills/discovery";
import { GET, POST } from "@/app/api/modules/route";
import { invalidateModuleCache } from "./state";
import { resetMobileAppsSchemaCache } from "@/lib/mobile-apps/ensure-schema";

const url = process.env.MOBILE_REVIEWS_TEST_DATABASE_URL;
describe.skipIf(!url)("module settings on PostgreSQL", () => {
  const schema = `module_test_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql, sql: postgres.Sql;
  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, prepare: false, connection: { search_path: schema }, onnotice: () => {} });
    await sql`create table workspaces (id uuid primary key default gen_random_uuid(), created_at timestamptz default now())`;
    await sql`insert into workspaces default values`;
    resetMobileAppsSchemaCache();
  });
  beforeEach(() => {
    vi.mocked(getSql).mockReturnValue(sql); invalidateModuleCache();
    vi.mocked(getSession).mockResolvedValue({ sub: 'admin', name: 'Admin', email: 'admin@example.com' });
    vi.mocked(getSessionRole).mockResolvedValue('admin');
    vi.mocked(discoverSkills).mockReturnValue([{ key: 'mission-control', name: 'Mission Control', description: '', directory: '/fixture', enabled: true, capabilities: ['mobile-apps.reviews.read'] }]);
  });
  afterAll(async () => { await sql?.end(); if (admin) { await admin.unsafe(`drop schema if exists ${schema} cascade`); await admin.end(); } resetMobileAppsSchemaCache(); invalidateModuleCache(); });
  const request = (action: string, moduleId = 'mobile-apps') => new Request('http://localhost/api/modules', { method: 'POST', body: JSON.stringify({ action, moduleId }) });
  it("preserves all app data across disable and re-enable without typed deletion confirmation", async () => {
    expect((await POST(request('enable'))).status).toBe(200);
    await sql`insert into mobile_apps (workspace_id, name) select id, 'Preserved' from workspaces`;
    expect((await POST(request('disable'))).status).toBe(200);
    expect(await sql`select name from mobile_apps`).toHaveLength(1);
    expect((await (await GET()).json()).enabledIds).not.toContain('mobile-apps');
    expect((await POST(request('enable'))).status).toBe(200);
    expect(await sql`select name from mobile_apps`).toHaveLength(1);
  });
  it("keeps the enabled preference when a skill disappears and restores activity when it returns", async () => {
    await POST(request('enable'));
    const installed = discoverSkills();
    vi.mocked(discoverSkills).mockReturnValue([]);
    const missing = await (await GET()).json();
    expect(missing.modules.find((m: { id: string }) => m.id === 'mobile-apps')).toMatchObject({ enabled: true, active: false, available: false });
    expect((await POST(request('enable'))).status).toBe(409);
    vi.mocked(discoverSkills).mockReturnValue(installed);
    expect((await (await GET()).json()).enabledIds).toContain('mobile-apps');
  });
  it("rejects member toggles, unauthenticated access and core disables", async () => {
    vi.mocked(getSessionRole).mockResolvedValue('member');
    expect((await POST(request('disable'))).status).toBe(403);
    vi.mocked(getSessionRole).mockResolvedValue('admin');
    expect((await POST(request('disable', 'kanban'))).status).toBe(400);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
