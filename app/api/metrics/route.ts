import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/modules/state";
import { guardSelectOnly, bindNamedParams } from "@/lib/metrics/sql-guard";
import { executeMetricQuery } from "@/lib/metrics/mysql";
import { metricDefinitionSchema, parseMetricImport, exportMetric, type MetricDef } from "@/lib/metrics/definition";
import { saveMetric, importMetrics } from "@/lib/metrics/store";
import { isValidWindow, resolveWindow, type WindowName } from "@/lib/metrics/window";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any -- action-based route */
type Json = Record<string, any>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });

const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = (await sql`
    select id
    from workspaces
    order by created_at asc
    limit 1
  `) as unknown as Array<{ id: string }>;

  return rows[0]?.id ?? null;
}

let _schemaEnsured = false;

async function ensureSchema(sql: ReturnType<typeof getSql>) {
  if (_schemaEnsured) return;

  await sql`
    CREATE TABLE IF NOT EXISTS metrics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text,
      sql_text text NOT NULL,
      chart_type text NOT NULL DEFAULT 'bar',
      x_column text NOT NULL DEFAULT '',
      y_columns text[] NOT NULL DEFAULT '{}'::text[],
      default_window text NOT NULL DEFAULT 'monthly',
      position integer NOT NULL DEFAULT 0,
      created_by_email text,
      created_by_name text,
      updated_by_email text,
      updated_by_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS metrics_workspace_idx ON metrics(workspace_id)`;
  await sql`CREATE INDEX IF NOT EXISTS metrics_position_idx ON metrics(workspace_id, position)`;

  await sql`
    CREATE TABLE IF NOT EXISTS metric_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      metric_id uuid REFERENCES metrics(id) ON DELETE CASCADE,
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      ran_by_email text,
      ran_by_name text,
      "window" text NOT NULL DEFAULT 'monthly',
      since timestamptz,
      until timestamptz,
      status text NOT NULL DEFAULT 'success',
      error_message text,
      row_count integer,
      duration_ms integer,
      occurred_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS metric_runs_metric_idx ON metric_runs(metric_id, occurred_at desc)`;

  await sql`ALTER TABLE metrics
    ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'General',
    ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS value_format text NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS trend_direction text NOT NULL DEFAULT 'neutral',
    ADD COLUMN IF NOT EXISTS kpi_aggregation text NOT NULL DEFAULT 'sum'`;
  _schemaEnsured = true;
}

export async function GET() {
  try {
    const session = await getSession();

    if (!session?.email) return fail("Not authenticated", 401);

    if (!(await isModuleEnabled("metrics"))) {
      return fail("Metrics module is disabled. Enable it in Settings.", 503);
    }

    const sql = getSql();

    await ensureSchema(sql);

    const wid = await workspaceId(sql);

    if (!wid) return ok({ metrics: [] });

    const rows = await sql`
      select
        id::text,
        name,
        description,
        sql_text,
        chart_type,
        x_column,
        y_columns,
        default_window,
        category, notes, value_format, trend_direction, kpi_aggregation,
        position,
        created_by_name,
        created_by_email,
        updated_by_name,
        updated_by_email,
        created_at,
        updated_at
      from metrics
      where workspace_id = ${wid}
      order by position asc, created_at asc
    `;

    return ok({ metrics: rows });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to list metrics", 500);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session?.email) return fail("Not authenticated", 401);

    if (!(await isModuleEnabled("metrics"))) {
      return fail("Metrics module is disabled. Enable it in Settings.", 503);
    }

    const sql = getSql();

    await ensureSchema(sql);

    const wid = await workspaceId(sql);

    if (!wid) return fail("Workspace not found", 500);

    let body: Json;
    try { body = await request.json(); } catch { return fail("Invalid JSON body.", 422); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Expected a JSON object.", 422);
    const action = String(body.action || "");
    const actor = {
      name: session.name?.trim() || null,
      email: session.email.toLowerCase(),
    };

    if (action === "importMetrics") {
      let entries;
      try { entries = parseMetricImport(body.metrics); } catch (error) { return fail(error instanceof Error ? error.message : "Invalid import.", 422); }
      for (const entry of entries) {
        const guard = guardSelectOnly(entry.query);
        if (!guard.ok) return fail(`${entry.title}: ${guard.reason}`, 422);
        entry.query = guard.cleaned;
      }
      const counts = await importMetrics(sql, wid, entries, actor, body.replaceExisting === true);
      return ok(counts);
    }

    if (action === "createMetric" || action === "updateMetric") {
      const updating = action === "updateMetric";
      const id = typeof body.id === "string" ? body.id : "";
      let previous = {};
      if (updating) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail("A valid metric id is required.", 422);
        const rows = await sql`select * from metrics where id = ${id} and workspace_id = ${wid}`;
        if (!rows[0]) return fail("Metric not found.", 404);
        previous = exportMetric(rows[0] as unknown as MetricDef);
      }
      const fields: Record<string, unknown> = { ...previous };
      const mapping: Record<string, string> = { name: "title", description: "description", sql: "query", sqlText: "query", chartType: "chart", xColumn: "xColumn", yColumns: "yColumns", defaultWindow: "timerange", category: "category", notes: "notes", valueFormat: "valueFormat", trendDirection: "trendDirection", kpiAggregation: "kpiAggregation" };
      for (const [key, target] of Object.entries(mapping)) if (body[key] !== undefined) fields[target] = body[key];
      const parsed = metricDefinitionSchema.safeParse(fields);
      if (!parsed.success) return fail(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" "), 422);
      const guard = guardSelectOnly(parsed.data.query);
      if (!guard.ok) return fail(guard.reason, 422);
      const metric = await saveMetric(sql, wid, { ...parsed.data, query: guard.cleaned }, actor, updating ? id : undefined);
      return ok({ metric });
    }

    if (action === "deleteMetric") {
      const id = String(body.id || "");

      if (!id) return fail("Metric id is required.");

      await sql`delete from metrics where id = ${id} and workspace_id = ${wid}`;

      return ok();
    }

    if (action === "reorderMetrics") {
      const ids = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];

      for (let i = 0; i < ids.length; i += 1) {
        await sql`
          update metrics
          set position = ${i}, updated_at = now()
          where id = ${ids[i]} and workspace_id = ${wid}
        `;
      }

      return ok();
    }

    if (action === "runMetric" || action === "previewSql") {
      const isPreview = action === "previewSql";
      const selectedWindow = isValidWindow(body.window)
        ? (body.window as WindowName)
        : "monthly";

      const resolved = resolveWindow({
        window: selectedWindow,
        since: body.since ?? null,
        until: body.until ?? null,
        bucket: body.bucket ?? null,
      });

      let sqlText: string;
      let metricId: string | null = null;

      if (isPreview) {
        sqlText = String(body.sql || "").trim();

        if (!sqlText) return fail("SQL is required.");
      } else {
        metricId = String(body.metricId || "");

        if (!metricId) return fail("Metric id is required.");

        const rows = (await sql`
          select sql_text
          from metrics
          where id = ${metricId} and workspace_id = ${wid}
          limit 1
        `) as unknown as Array<{ sql_text: string }>;

        if (!rows[0]) return fail("Metric not found.", 404);

        sqlText = rows[0].sql_text;
      }

      const guard = guardSelectOnly(sqlText);

      if (!guard.ok) return fail(guard.reason);

      const { sql: boundSql, values } = bindNamedParams(guard.cleaned, {
        since: resolved.since,
        until: resolved.until,
        bucket: resolved.bucket,
      });

      const t0 = Date.now();
      const result = await executeMetricQuery(boundSql, values);
      const durationMs = Date.now() - t0;

      if (!isPreview && metricId) {
        await sql`
          insert into metric_runs (
            metric_id,
            workspace_id,
            ran_by_email,
            ran_by_name,
            "window",
            since,
            until,
            status,
            error_message,
            row_count,
            duration_ms
          ) values (
            ${metricId},
            ${wid},
            ${actor.email},
            ${actor.name},
            ${selectedWindow},
            ${resolved.since.toISOString()},
            ${resolved.until.toISOString()},
            ${result.ok ? "success" : "failed"},
            ${result.ok ? null : result.error},
            ${result.ok ? result.rowCount : 0},
            ${durationMs}
          )
        `.catch(() => null);
      }

      if (!result.ok) return fail(result.error, 422);

      return ok({
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
        durationMs: result.durationMs,
        window: {
          name: selectedWindow,
          since: resolved.since.toISOString(),
          until: resolved.until.toISOString(),
          bucket: resolved.bucket,
        },
      });
    }

    return fail(`Unsupported action: ${action}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Metrics operation failed", 500);
  }
}