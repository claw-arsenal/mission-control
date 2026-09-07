import { z } from "zod";
import type { WindowName } from "./window";

export const metricDefinitionSchema = z.object({
  title: z.string().trim().min(1, "A metric needs a name.").max(200),
  description: z.string().max(12000).default(""),
  query: z.string().trim().min(1, "A metric needs a query.").max(10000),
  chart: z.enum(["bar", "line", "area", "pie", "donut", "kpi"]).default("bar"),
  xColumn: z.string().trim().max(100).default(""),
  yColumns: z.array(z.string().trim().min(1).max(100)).min(1, "Choose at least one value column.").max(10),
  timerange: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]).default("monthly"),
  category: z.string().trim().max(60).default("General"),
  notes: z.string().max(12000).default(""),
  valueFormat: z.enum(["auto", "number", "percent"]).default("auto"),
  trendDirection: z.enum(["neutral", "higher", "lower"]).default("neutral"),
  kpiAggregation: z.enum(["sum", "average", "latest"]).default("sum"),
  replaces: z.string().trim().min(1).max(200).optional(),
}).superRefine((value, context) => {
  if (value.chart !== "kpi" && !value.xColumn) context.addIssue({ code: "custom", path: ["xColumn"], message: "Choose a category or date column." });
  if (new Set(value.yColumns).size !== value.yColumns.length) context.addIssue({ code: "custom", path: ["yColumns"], message: "Value columns must be unique." });
  if (value.yColumns.includes(value.xColumn)) context.addIssue({ code: "custom", path: ["yColumns"], message: "A value column cannot also be the category column." });
});

export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
export type ValueFormat = MetricDefinition["valueFormat"];
export type MetricDef = {
  id: string;
  name: string;
  description: string | null;
  sql_text: string;
  chart_type: MetricDefinition["chart"];
  x_column: string;
  y_columns: string[];
  default_window: WindowName;
  category?: string;
  notes?: string;
  value_format?: ValueFormat;
  trend_direction?: MetricDefinition["trendDirection"];
  kpi_aggregation?: MetricDefinition["kpiAggregation"];
  updated_by_name: string | null;
  updated_at: string;
};

export function parseMetricImport(input: unknown): MetricDefinition[] {
  const parsed = z.array(metricDefinitionSchema).min(1).max(100).safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue.path[0] === "number" ? `Metric ${issue.path[0] + 1}: ` : "";
    throw new Error(`${index}${issue.path.slice(1).join(".")}${issue.path.length > 1 ? ": " : ""}${issue.message}`);
  }
  const names = parsed.data.map(item => item.title.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new Error("The file contains duplicate metric names. Give each metric a unique name.");
  return parsed.data;
}

export function exportMetric(metric: MetricDef): MetricDefinition {
  return {
    title: metric.name, description: metric.description ?? "", query: metric.sql_text,
    chart: metric.chart_type, xColumn: metric.x_column, yColumns: metric.y_columns,
    timerange: metric.default_window === "custom" ? "monthly" : metric.default_window,
    category: metric.category || "General", notes: metric.notes || "", valueFormat: metric.value_format || "auto",
    trendDirection: metric.trend_direction || "neutral", kpiAggregation: metric.kpi_aggregation || "sum",
  };
}

export function matchImport(entry: MetricDefinition, existing: Pick<MetricDef, "id" | "name">[]) {
  const names = new Set([entry.title, entry.replaces].filter(Boolean).map(name => name!.toLocaleLowerCase()));
  const matches = existing.filter(metric => names.has(metric.name.toLocaleLowerCase()));
  if (matches.length > 1) throw new Error(`More than one saved metric matches “${entry.title}”. Rename the duplicates before importing.`);
  return matches[0] ?? null;
}
