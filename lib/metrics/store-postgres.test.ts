import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/local-db", () => ({ getSql: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ email: "operator@example.test", name: "Operator" }) }));
vi.mock("@/lib/modules/state", () => ({ isModuleEnabled: async () => true }));
vi.mock("./mysql", () => ({ executeMetricQuery: vi.fn() }));
import { getSql } from "@/lib/local-db";
import { GET, POST } from "@/app/api/metrics/route";
import { metricDefinitionSchema } from "./definition";
import { importMetrics, saveMetric } from "./store";

const url = process.env.METRICS_TEST_DATABASE_URL;
describe.skipIf(!url)("metrics storage on PostgreSQL", () => {
  const schema = `metrics_test_${randomUUID().replaceAll("-", "")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let workspace: string;
  const actor = { email: "operator@example.test", name: "Operator" };
  const definition = metricDefinitionSchema.parse({ title: "Players", description: "Original", query: "SELECT '2026-08' AS bucket, 20 AS players", chart: "line", xColumn: "bucket", yColumns: ["players"], category: "Engagement", notes: "Counts distinct players in each group.", trendDirection: "higher" });
  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, prepare: false, connection: { search_path: schema }, onnotice: () => {} });
    await sql`create table workspaces (id uuid primary key default gen_random_uuid(), created_at timestamptz default now())`;
    const [row] = await sql`insert into workspaces default values returning id`;
    workspace = row.id;
    vi.mocked(getSql).mockReturnValue(sql);
    expect((await GET()).status).toBe(200);
  });
  beforeEach(async () => { await sql`truncate metrics cascade`; });
  afterAll(async () => { await sql?.end(); if (admin) { await admin.unsafe(`drop schema if exists ${schema} cascade`); await admin.end(); } });

  it("round-trips the definition, explanation, and interpretation settings", async () => {
    await saveMetric(sql, workspace, definition, actor);
    const json = await (await GET()).json();
    expect(json.metrics[0]).toMatchObject({ name: "Players", y_columns: ["players"], category: "Engagement", notes: definition.notes, trend_direction: "higher", value_format: "auto" });
  });
  it("skips matches by default and updates renamed definitions without changing their id", async () => {
    const original = await saveMetric(sql, workspace, definition, actor);
    const renamed = { ...definition, title: "Active players", replaces: "Players" };
    expect(await importMetrics(sql, workspace, [renamed], actor, false)).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(await importMetrics(sql, workspace, [renamed], actor, true)).toEqual({ created: 0, updated: 1, skipped: 0 });
    const [row] = await sql`select id::text, name from metrics`;
    expect(row).toMatchObject({ id: original.id, name: "Active players" });
  });
  it("rolls back the whole import when later definitions conflict", async () => {
    await saveMetric(sql, workspace, definition, actor);
    await expect(importMetrics(sql, workspace, [
      { ...definition, description: "Changed" },
      { ...definition, title: "Renamed", replaces: "Players" },
    ], actor, true)).rejects.toThrow("Multiple definitions");
    const [row] = await sql`select description from metrics`;
    expect(row.description).toBe("Original");
  });
  it("validates every query before inserting any definitions", async () => {
    const response = await POST(new Request("http://localhost/api/metrics", { method: "POST", body: JSON.stringify({ action: "importMetrics", metrics: [definition, { ...definition, title: "Unsafe", query: "SELECT 1 INTO OUTFILE '/tmp/test'" }] }) }));
    expect(response.status).toBe(422);
    expect(await sql`select id from metrics`).toHaveLength(0);
  });
  it("refuses a cross-workspace edit", async () => {
    const [other] = await sql`insert into workspaces default values returning id`;
    const saved = await saveMetric(sql, other.id, definition, actor);
    const response = await POST(new Request("http://localhost/api/metrics", { method: "POST", body: JSON.stringify({ action: "updateMetric", id: saved.id, name: "Changed" }) }));
    expect(response.status).toBe(404);
    const [row] = await sql`select name from metrics where id = ${saved.id}`;
    expect(row.name).toBe("Players");
  });
});
