import type { getSql } from "@/lib/local-db";
import { matchImport, type MetricDefinition } from "./definition";

type Sql = ReturnType<typeof getSql>;
type Actor = { email: string; name: string | null };

export async function saveMetric(sql: Sql, workspace: string, definition: MetricDefinition, actor: Actor, id?: string) {
  const m = definition;
  if (id) {
    const rows = await sql`update metrics set
      name = ${m.title}, description = ${m.description}, sql_text = ${m.query}, chart_type = ${m.chart},
      x_column = ${m.xColumn}, y_columns = ${sql.array(m.yColumns)}, default_window = ${m.timerange},
      category = ${m.category}, notes = ${m.notes}, value_format = ${m.valueFormat},
      trend_direction = ${m.trendDirection}, kpi_aggregation = ${m.kpiAggregation},
      updated_at = now(), updated_by_email = ${actor.email}, updated_by_name = ${actor.name}
      where id = ${id} and workspace_id = ${workspace} returning id::text, name`;
    if (!rows.length) throw new Error("Metric not found.");
    return rows[0];
  }
  const rows = await sql`insert into metrics (
    workspace_id, name, description, sql_text, chart_type, x_column, y_columns, default_window,
    category, notes, value_format, trend_direction, kpi_aggregation, position,
    created_by_email, created_by_name, updated_by_email, updated_by_name
  ) values (
    ${workspace}, ${m.title}, ${m.description}, ${m.query}, ${m.chart}, ${m.xColumn}, ${sql.array(m.yColumns)}, ${m.timerange},
    ${m.category}, ${m.notes}, ${m.valueFormat}, ${m.trendDirection}, ${m.kpiAggregation},
    (select coalesce(max(position), -1) + 1 from metrics where workspace_id = ${workspace}),
    ${actor.email}, ${actor.name}, ${actor.email}, ${actor.name}
  ) returning id::text, name`;
  return rows[0];
}

export async function importMetrics(sql: Sql, workspace: string, entries: MetricDefinition[], actor: Actor, replaceExisting: boolean) {
  return sql.begin(async transaction => {
    const tx = transaction as unknown as Sql;
    await tx`select pg_advisory_xact_lock(hashtext(${`metrics-import:${workspace}`}))`;
    const existing = await tx`select id::text, name from metrics where workspace_id = ${workspace} for update` as unknown as { id: string; name: string }[];
    const counts = { created: 0, updated: 0, skipped: 0 };
    const touched = new Set<string>();
    for (const entry of entries) {
      const matched = matchImport(entry, existing);
      if (matched && touched.has(matched.id)) throw new Error(`Multiple definitions target “${matched.name}”. Import each saved metric once.`);
      if (matched) touched.add(matched.id);
      if (matched && !replaceExisting) { counts.skipped++; continue; }
      const saved = await saveMetric(tx, workspace, entry, actor, matched?.id);
      if (matched) counts.updated++;
      else { counts.created++; existing.push({ id: String(saved.id), name: entry.title }); }
    }
    return counts;
  });
}
