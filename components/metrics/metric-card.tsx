"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DownloadIcon, MoreHorizontalIcon, PencilIcon, RefreshCwIcon, Trash2Icon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricChart } from "./metric-chart";
import { MetricHelp } from "./metric-help";
import { describeWindow, usesWindow, usesBucket, type WindowName } from "@/lib/metrics/window";
import { computeBucketDelta, formatBucketLabel, parseDbDateTime, parseBucketStart, bucketEnd } from "@/lib/metrics/delta";
import { downloadMetricFile, formatMetricValue, isPercentColumn, metricCsv } from "@/lib/metrics/presentation";
import { useMetricQuery } from "@/hooks/use-metric-query";
import type { MetricDef } from "@/lib/metrics/definition";
export type { MetricDef } from "@/lib/metrics/definition";

export const METRIC_WINDOWS = ["hourly", "daily", "weekly", "monthly", "yearly"] as const;
type Props = { metric: MetricDef; globalWindow: WindowName | "saved"; refreshKey?: number; dataAsOf?: string | null; onEdit: () => void; onDelete: () => void };

function ResultTable({ rows, metric }: { rows: Record<string, unknown>[]; metric: MetricDef }) {
  const [limit, setLimit] = useState(25);
  const columns = [...new Set([metric.x_column, ...metric.y_columns, ...Object.keys(rows[0] ?? {})].filter(Boolean))];
  return <div>
    <div className="max-h-96 overflow-auto rounded-md border" tabIndex={0} role="region" aria-label={`${metric.name} data, scroll for more columns`}>
      <table className="w-full text-left text-xs"><caption className="sr-only">{metric.name}, all returned columns. Missing values are unavailable, not zero.</caption>
        <thead className="sticky top-0 bg-muted"><tr>{columns.map(column => <th key={column} scope="col" className="whitespace-nowrap px-3 py-2.5 font-medium">{column}</th>)}</tr></thead>
        <tbody>{rows.slice(0, limit).map((row, index) => <tr key={index} className="border-t hover:bg-muted/40">{columns.map(column => <td key={column} className="max-w-64 whitespace-nowrap px-3 py-2.5 tabular-nums">{column === metric.x_column || (!metric.y_columns.includes(column) && typeof row[column] !== "number") ? String(row[column] ?? "Not available") : formatMetricValue(row[column], column, metric.y_columns.includes(column) ? metric.value_format : "auto")}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{Math.min(limit, rows.length)} of {rows.length} rows</span>{limit < rows.length && <Button size="sm" variant="outline" onClick={() => setLimit(value => value + 25)}>Show 25 more</Button>}
      <Button size="sm" variant="ghost" onClick={() => downloadMetricFile(metricCsv(rows, columns), `${metric.name.replace(/[^a-z0-9_-]/gi, "-")}.csv`, "text/csv;charset=utf-8")}><DownloadIcon className="size-3.5" /> Download CSV</Button>
    </div>
  </div>;
}

export function MetricCard({ metric, globalWindow, refreshKey = 0, dataAsOf = null, onEdit, onDelete }: Props) {
  const id = useId();
  const [override, setOverride] = useState<WindowName | "inherit">("inherit");
  const [view, setView] = useState<"chart" | "table">("chart");
  const windowed = usesWindow(metric.sql_text);
  const bucketed = usesBucket(metric.sql_text);
  const selected = override !== "inherit" ? override : globalWindow === "saved" ? metric.default_window : globalWindow;
  const effectiveWindow = !windowed || selected === "custom" ? "monthly" : selected;
  const { result, loading, error, refresh } = useMetricQuery(metric, effectiveWindow, refreshKey);
  const asOf = useMemo(() => parseDbDateTime(dataAsOf), [dataAsOf]);
  const yColumn = metric.y_columns[0] ?? "";
  const delta = useMemo(() => bucketed && result && yColumn && !result.truncated ? computeBucketDelta({ rows: result.rows, xColumn: metric.x_column, yColumn, window: effectiveWindow, asOf }) : null, [bucketed, result, yColumn, metric.x_column, effectiveWindow, asOf]);
  const partialCount = bucketed && result ? result.rows.filter(row => {
    const start = parseBucketStart(String(row[metric.x_column]), effectiveWindow);
    return start && asOf && bucketEnd(start, effectiveWindow) > asOf;
  }).length : 0;
  const direction = metric.trend_direction || "neutral";
  const favorable = delta && direction !== "neutral" && delta.delta !== 0 ? (delta.delta > 0) === (direction === "higher") : null;
  const scope = !windowed ? "All available history" : `${describeWindow(effectiveWindow).range}${bucketed ? ` · ${describeWindow(effectiveWindow).granularity} groups` : ""}`;

  return <article aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
    <header className="px-4 pt-4">
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="mb-1 text-xs text-muted-foreground">{metric.category || (bucketed ? "Trends" : "Breakdowns")}</p><h2 id={`${id}-title`} className="break-words text-base font-semibold leading-snug">{metric.name}</h2></div>
        <MetricHelp label={metric.name}><p className="whitespace-pre-wrap">{metric.description || "This metric displays the values returned by its saved query. Add a description in Edit metric."}</p><p>Open “Definition & interpretation” below for the full method and query.</p></MetricHelp>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${metric.name}`}><MoreHorizontalIcon className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void refresh()} disabled={loading}><RefreshCwIcon className="size-4" /> Refresh metric</DropdownMenuItem><DropdownMenuItem onClick={onEdit}><PencilIcon className="size-4" /> Edit metric</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2Icon className="size-4" /> Delete metric</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
      {metric.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{metric.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t py-3">
        {windowed ? <><label htmlFor={`${id}-range`} className="sr-only">Time range for {metric.name}</label><select id={`${id}-range`} value={override} onChange={event => setOverride(event.target.value as WindowName | "inherit")} className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-xs">
          <option value="inherit">{globalWindow === "saved" ? "Saved default" : "Follow dashboard"}: {describeWindow(effectiveWindow).range}</option>
          {METRIC_WINDOWS.map(window => <option key={window} value={window}>{describeWindow(window).range}{bucketed ? ` · ${describeWindow(window).granularity}` : ""}</option>)}
        </select><MetricHelp label="Time range"><p>{scope}.</p><p>{bucketed ? "Each point groups records into an hour, day, week, month, or year. Changing the range changes both the lookback and the size of these groups." : "Categories are counted across the entire range. These are not daily counts."}</p><p>Choose “Follow dashboard” or “Saved default” to remove this card’s override.</p></MetricHelp></> : <span className="rounded-md bg-muted px-2 py-1.5 text-xs">All available history</span>}
        <div className="ml-auto flex gap-1" role="group" aria-label={`View for ${metric.name}`}>{(["chart", "table"] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={cn("rounded-md px-2.5 py-1.5 text-xs capitalize", view === mode ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent")}>{mode}</button>)}</div>
      </div>
    </header>
    {delta && <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold tabular-nums", favorable === true ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : favorable === false ? "bg-rose-500/10 text-rose-700 dark:text-rose-400" : "bg-muted text-foreground")}>
        {delta.delta > 0 ? <TrendingUpIcon className="size-3.5" /> : delta.delta < 0 ? <TrendingDownIcon className="size-3.5" /> : null}{delta.delta > 0 ? "+" : ""}{formatMetricValue(delta.delta, "", "number")}{isPercentColumn(yColumn, metric.value_format) ? " pp" : ""}
      </span><span className="text-muted-foreground">{yColumn} · {formatBucketLabel(delta.previousLabel, effectiveWindow)} to {formatBucketLabel(delta.currentLabel, effectiveWindow)}</span>
      <MetricHelp label="Change between periods"><p>{formatMetricValue(delta.previous, yColumn, metric.value_format)} became {formatMetricValue(delta.current, yColumn, metric.value_format)}.</p><p>{isPercentColumn(yColumn, metric.value_format) ? "pp means percentage points: 20% to 25% is +5 pp, a 25% relative increase." : "This is the absolute difference, not a percentage change."}</p><p>Compares adjacent, elapsed periods. The latest session timestamp is a cutoff estimate, not proof that every table is fully synced. Without a timestamp, the final returned period is excluded.</p><p>{direction === "neutral" ? "Direction is neutral; an increase is not automatically good." : `${direction === "higher" ? "Higher" : "Lower"} is marked as favorable in this metric’s settings.`}</p></MetricHelp>
    </div>}
    <div className="min-w-0 flex-1 px-3 pb-3" aria-busy={loading}>
      {error && <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"><p className="font-medium">{result ? "Refresh failed. Showing the last successful result." : "This metric could not load."}</p><p className="mt-1 break-words text-muted-foreground">{error}</p><Button variant="outline" size="sm" onClick={() => void refresh()} className="mt-2">Try again</Button></div>}
      {loading && !result ? <div role="status" className="min-h-64 space-y-5 p-5"><p className="text-sm text-muted-foreground">Loading {metric.name}…</p><div className="h-40 rounded-md bg-muted motion-safe:animate-pulse" /></div> : result ? view === "table" ? <ResultTable key={result.loadedAt} rows={result.rows} metric={metric} /> : <MetricChart type={metric.chart_type} xColumn={metric.x_column} yColumns={metric.y_columns} rows={result.rows} valueFormat={metric.value_format} kpiAggregation={metric.kpi_aggregation} sql={metric.sql_text} /> : null}
      {result?.truncated && <p role="status" className="mt-3 rounded-md border border-amber-500/40 p-2 text-xs">Result limit reached. Totals and shares cover only returned rows. Narrow the range or aggregate in SQL before interpreting this chart.</p>}
      {partialCount > 0 && <p className="mt-3 text-xs text-muted-foreground">{partialCount} period{partialCount === 1 ? " is" : "s are"} still open at the latest session timestamp. These points may be partial and are excluded from the change above.</p>}
    </div>
    <details className="border-t px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">Definition & interpretation</summary><div className="mt-3 space-y-4 leading-relaxed text-muted-foreground">
      <p className="whitespace-pre-wrap">{metric.description || "No definition yet. Add one in the metric editor."}</p>
      {metric.notes && <div><h3 className="mb-1 font-medium text-foreground">How to read it</h3><p className="whitespace-pre-wrap">{metric.notes}</p></div>}
      <dl className="grid gap-2 text-xs"><div><dt className="font-medium text-foreground">Scope</dt><dd>{scope}. {windowed ? "The query controls which records are included." : "Dashboard time controls do not affect this query."}</dd></div><div><dt className="font-medium text-foreground">Missing values</dt><dd>Unavailable values stay missing. A gap is not a zero. Distinct counts across groups may overlap.</dd></div></dl>
      <details><summary className="cursor-pointer text-xs font-medium text-foreground">View SQL query</summary><pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{metric.sql_text}</pre></details>
    </div></details>
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground"><span role="status">{loading ? result ? "Refreshing, previous result remains visible…" : "Queued or loading…" : result ? `${result.rowCount.toLocaleString()} rows · ${(result.durationMs / 1000).toFixed(1)} s` : "No successful result"}</span>{result && <span>Loaded {new Date(result.loadedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>}</footer>
  </article>;
}
