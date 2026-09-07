"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDownIcon, DownloadIcon, MoreHorizontalIcon, PencilIcon, RefreshCwIcon, TableIcon, Trash2Icon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricChart } from "./metric-chart";
import { describeWindow, usesWindow, usesBucket, type WindowName } from "@/lib/metrics/window";
import { computeBucketDelta, formatBucketLabel, parseDbDateTime, parseBucketStart, bucketEnd } from "@/lib/metrics/delta";
import { downloadMetricFile, formatMetricValue, isPercentColumn, metricCsv } from "@/lib/metrics/presentation";
import { useMetricQuery } from "@/hooks/use-metric-query";
import type { MetricDef } from "@/lib/metrics/definition";
export type { MetricDef } from "@/lib/metrics/definition";

export const METRIC_WINDOWS = ["hourly", "daily", "weekly", "monthly", "yearly"] as const;
export type MetricCardSettings = { override: WindowName | "inherit"; view: "chart" | "table" };
type Props = { metric: MetricDef; globalWindow: WindowName | "saved"; refreshKey?: number; dataAsOf?: string | null; onEdit: () => void; onDelete: () => void; settings?: MetricCardSettings; onSettingsChange?: (settings: MetricCardSettings) => void };
const DEFAULT_SETTINGS: MetricCardSettings = { override: "inherit", view: "chart" };
const CHANGE_TONES = {
  neutral: "text-muted-foreground",
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  negative: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

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

export function MetricCard({ metric, globalWindow, refreshKey = 0, dataAsOf = null, onEdit, onDelete, settings, onSettingsChange }: Props) {
  const id = useId();
  const [localSettings, setLocalSettings] = useState(DEFAULT_SETTINGS);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { override, view } = settings ?? localSettings;
  const updateSettings = (patch: Partial<MetricCardSettings>) => {
    const next = { ...(settings ?? localSettings), ...patch };
    setLocalSettings(next);
    onSettingsChange?.(next);
  };
  const windowed = usesWindow(metric.sql_text);
  const bucketed = usesBucket(metric.sql_text);
  const inheritedWindow = globalWindow === "saved" ? metric.default_window : globalWindow;
  const selected = override !== "inherit" ? override : inheritedWindow;
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
  const tone = favorable === true ? "positive" : favorable === false ? "negative" : "neutral";
  const changeLabel = favorable === true ? "Improved" : favorable === false ? "Worsened" : delta?.delta === 0 ? "No change" : (delta?.delta ?? 0) > 0 ? "Up" : "Down";
  const scope = !windowed ? "All available history" : `${describeWindow(effectiveWindow).range}${bucketed ? ` · ${describeWindow(effectiveWindow).granularity} groups` : ""}`;

  return <article aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
    <header className="px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {metric.category && metric.category !== "General" && <p className="mb-1 text-xs text-muted-foreground">{metric.category}</p>}
          <h2 id={`${id}-title`} className="break-words text-base font-semibold leading-snug">{metric.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{scope}{override !== "inherit" && windowed ? " (custom range)" : ""}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${metric.name}`}><MoreHorizontalIcon className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => updateSettings({ view: view === "chart" ? "table" : "chart" })}><TableIcon className="size-4" />{view === "chart" ? "Show table" : "Show chart"}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDetailsOpen(true)}>Definition and time range</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void refresh()} disabled={loading}><RefreshCwIcon className="size-4" />Refresh metric</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEdit}><PencilIcon className="size-4" />Edit metric</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2Icon className="size-4" />Delete metric</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {delta && <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span data-tone={tone} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium tabular-nums", CHANGE_TONES[tone])}>
          {delta.delta > 0 ? <TrendingUpIcon className="size-3.5" /> : delta.delta < 0 ? <TrendingDownIcon className="size-3.5" /> : null}
          <span>{changeLabel}</span>
          {delta.delta !== 0 && <span>{delta.delta > 0 ? "+" : ""}{formatMetricValue(delta.delta, "", "number")}{isPercentColumn(yColumn, metric.value_format) ? " pp" : ""}</span>}
        </span>
        <span className="text-muted-foreground">{yColumn} &middot; {formatBucketLabel(delta.previousLabel, effectiveWindow)} to {formatBucketLabel(delta.currentLabel, effectiveWindow)}</span>
      </div>}
    </header>
    <div className="min-w-0 flex-1 px-3 pb-3 sm:px-4" aria-busy={loading}>
      {error && <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"><p className="font-medium">{result ? "Refresh failed. Showing the last successful result." : "This metric could not load."}</p><p className="mt-1 break-words text-muted-foreground">{error}</p><Button variant="outline" size="sm" onClick={() => void refresh()} className="mt-2">Try again</Button></div>}
      {loading && !result ? <div role="status" className="min-h-56 space-y-5 p-4"><span className="sr-only">Loading {metric.name}</span><div className="h-44 rounded-md bg-muted/40 motion-safe:animate-pulse" /></div>
        : result ? view === "table" ? <ResultTable key={result.loadedAt} rows={result.rows} metric={metric} />
          : <MetricChart type={metric.chart_type} xColumn={metric.x_column} yColumns={metric.y_columns} rows={result.rows} valueFormat={metric.value_format} kpiAggregation={metric.kpi_aggregation} sql={metric.sql_text} /> : null}
      {result?.truncated && <p role="status" className="mt-3 rounded-md border border-amber-500/40 p-2 text-xs">Result limit reached. Totals cover only returned rows. Narrow the range before interpreting this chart.</p>}
      {partialCount > 0 && <p className="mt-2 text-xs text-muted-foreground">Latest {partialCount === 1 ? "period is" : `${partialCount} periods are`} incomplete and excluded from the change.</p>}
    </div>
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2 sm:px-5">
      <button type="button" aria-label={`Details for ${metric.name}`} aria-expanded={detailsOpen} aria-controls={`${id}-details`} onClick={() => setDetailsOpen(open => !open)} className="inline-flex min-h-8 items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        Details <ChevronDownIcon className={cn("size-3.5 transition-transform", detailsOpen && "rotate-180")} />
      </button>
      {loading && <span role="status" className="text-xs text-muted-foreground">{result ? "Updating..." : "Loading..."}</span>}
      {view === "table" && <Button variant="ghost" size="sm" onClick={() => updateSettings({ view: "chart" })}>Show chart</Button>}
    </div>
    {detailsOpen && <section id={`${id}-details`} aria-label={`Details for ${metric.name}`} className="space-y-4 border-t px-4 py-4 text-sm sm:px-5">
      <p className="whitespace-pre-wrap break-words text-muted-foreground">{metric.description || "No definition yet. Add one in the metric editor."}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {windowed && <label className="flex min-w-0 flex-col gap-1.5 text-xs">Time range for {metric.name}
          <select value={override} onChange={event => updateSettings({ override: event.target.value as WindowName | "inherit" })} className="h-9 max-w-full rounded-md border bg-background px-2 text-xs">
            <option value="inherit">{globalWindow === "saved" ? "Saved default" : "Follow dashboard"}: {describeWindow(inheritedWindow).range}</option>
            {METRIC_WINDOWS.map(window => <option key={window} value={window}>{describeWindow(window).range}</option>)}
          </select>
        </label>}
        <div className="flex gap-1" role="group" aria-label={`View for ${metric.name}`}>{(["chart", "table"] as const).map(mode => <Button key={mode} size="sm" variant={view === mode ? "secondary" : "ghost"} aria-pressed={view === mode} onClick={() => updateSettings({ view: mode })}>{mode === "chart" ? "Chart" : "Table"}</Button>)}</div>
      </div>
      {metric.notes && <div><h3 className="mb-1 text-xs font-medium">How to read it</h3><p className="whitespace-pre-wrap break-words text-muted-foreground">{metric.notes}</p></div>}
      {delta && <p className="text-xs leading-relaxed text-muted-foreground">{formatMetricValue(delta.previous, yColumn, metric.value_format)} became {formatMetricValue(delta.current, yColumn, metric.value_format)}. {isPercentColumn(yColumn, metric.value_format) ? "The change is in percentage points (pp), not relative percent." : "The change is an absolute difference."} {direction === "neutral" ? "Up and down describe direction, not whether the change is good or bad." : `${direction === "higher" ? "Higher" : "Lower"} values are favorable according to this metric's settings.`} Compares adjacent completed periods; the latest session timestamp is a cutoff estimate.</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">{scope}. Missing values are unavailable, not zero. {windowed ? "The query determines which records are included." : "Time controls do not affect this query."} Distinct counts across groups can overlap.</p>
      <details><summary className="cursor-pointer text-xs font-medium">SQL query</summary><pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{metric.sql_text}</pre></details>
      {result && <p className="text-xs text-muted-foreground">{result.rowCount.toLocaleString()} rows &middot; {(result.durationMs / 1000).toFixed(1)} s &middot; Loaded {new Date(result.loadedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>}
    </section>}
  </article>;
}
