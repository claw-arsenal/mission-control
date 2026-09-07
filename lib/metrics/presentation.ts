import type { ValueFormat, MetricDefinition } from "./definition";

export function metricNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isPercentColumn(column: string, format: ValueFormat = "auto"): boolean {
  return format === "percent" || (format === "auto" && /%|\bpercent(?:age)?\b/i.test(column));
}

export function formatMetricValue(value: unknown, column = "", format: ValueFormat = "auto", compact = false): string {
  const number = metricNumber(value);
  if (number === null) return "Not available";
  const text = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2, ...(compact ? { notation: "compact" as const } : {}),
  }).format(number);
  return `${text}${isPercentColumn(column, format) ? "%" : ""}`;
}

export function aggregateMetric(rows: Record<string, unknown>[], column: string, aggregation: MetricDefinition["kpiAggregation"]) {
  if (aggregation === "latest") return metricNumber(rows.at(-1)?.[column]);
  const values = rows.map(row => metricNumber(row[column])).filter((value): value is number => value !== null);
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return aggregation === "average" ? sum / values.length : sum;
}

export function metricCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    // Spreadsheet applications may evaluate text beginning with a formula marker.
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns, ...rows.map(row => columns.map(column => row[column]))].map(row => row.map(cell).join(",")).join("\r\n");
}

export function downloadMetricFile(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
