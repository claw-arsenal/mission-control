"use client";

import "./metric-chart.css";

import { useId, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, Pie, PieChart, Cell, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { aggregateMetric, formatMetricValue, isPercentColumn, metricNumber } from "@/lib/metrics/presentation";
import type { MetricDefinition, ValueFormat } from "@/lib/metrics/definition";
import { usesBucket } from "@/lib/metrics/window";

type Row = Record<string, unknown>;
type Props = {
  type: MetricDefinition["chart"]; xColumn: string; yColumns: string[]; rows: Row[];
  valueFormat?: ValueFormat; kpiAggregation?: MetricDefinition["kpiAggregation"]; sql?: string;
};
const COLORS = [1, 2, 3, 4, 5, 6, 7].map(index => `var(--metric-chart-${index})`);
function formatXTick(value: unknown) {
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:/.test(text)) return text.slice(11, 16);
  if (/^\d{4}-W\d{2}$/.test(text)) return text.slice(5);
  if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day || 1).toLocaleDateString(undefined, { month: "short", ...(day ? { day: "numeric" } : { year: "2-digit" }) });
  }
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}

export function MetricChart(props: Props) {
  return <div className="metrics-visual min-w-0"><MetricChartContent {...props} /></div>;
}

function MetricChartContent({ type, xColumn, yColumns, rows, valueFormat = "auto", kpiAggregation = "sum", sql = "" }: Props) {
  const id = useId().replaceAll(":", "");
  // Internal keys support SQL aliases containing spaces, dots, or brackets.
  const data = useMemo(() => rows.map(row => Object.fromEntries([
    ["category", String(row[xColumn] ?? "Unknown")],
    ...yColumns.map((column, index) => [`series${index}`, metricNumber(row[column])]),
  ])), [rows, xColumn, yColumns]);
  const config: ChartConfig = Object.fromEntries(yColumns.map((column, index) => [`series${index}`, { label: column, color: COLORS[index % COLORS.length] }]));
  const hasPercent = yColumns.some(column => isPercentColumn(column, valueFormat));
  const hasNumber = yColumns.some(column => !isPercentColumn(column, valueFormat));
  const mixed = hasPercent && hasNumber;
  const first = yColumns[0];
  const horizontal = type === "bar" && !mixed && !usesBucket(sql) && !rows.every(row => /^\d{4}[- ]/.test(String(row[xColumn])));
  const height = horizontal ? Math.max(260, Math.min(rows.length, 15) * 36) : 250;

  if (!rows.length) return <div className="flex min-h-52 items-center justify-center px-5 text-center text-sm text-muted-foreground">No results in this range. Try a longer range or check the query filters.</div>;
  if (!first) return <p className="p-5 text-sm text-muted-foreground">Choose a value column in the metric editor to draw a chart.</p>;

  const legend = <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 px-2 pt-3 text-xs text-muted-foreground" aria-label="Chart series">
    {yColumns.map((column, index) => <li key={column} className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLORS[index % COLORS.length] }} /><span className="break-words">{column}</span></li>)}
  </ul>;
  const tooltip = <ChartTooltip key="tooltip" content={({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return <div className="max-w-80 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="mb-2 font-semibold">{String(label ?? payload[0]?.payload?.category ?? "")}</p>
      <dl className="space-y-1.5">{payload.map(item => {
        const index = Number(String(item.dataKey).replace("series", ""));
        const column = yColumns[index];
        return <div key={String(item.dataKey)} className="flex justify-between gap-5"><dt>{column}</dt><dd className="font-medium tabular-nums">{formatMetricValue(item.value, column, valueFormat)}</dd></div>;
      })}</dl>
    </div>;
  }} />;

  if (type === "kpi") {
    const value = aggregateMetric(rows, first, kpiAggregation);
    return <div className="flex min-h-60 flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="text-4xl font-semibold tabular-nums">{formatMetricValue(value, first, valueFormat)}</p>
      <p className="text-sm font-medium">{first}</p>
      <p className="max-w-72 text-xs text-muted-foreground">{kpiAggregation === "latest" ? "Value in the last returned row. Query order determines which row is last." : kpiAggregation === "average" ? "Unweighted average of available row values." : "Sum of available row values. Distinct people can appear in more than one row."}</p>
    </div>;
  }
  if (type === "pie" || type === "donut") {
    const items = data.map((row, index) => ({ name: String(row.category), value: metricNumber(row.series0), fill: COLORS[index % COLORS.length] }));
    if (items.some(item => item.value !== null && item.value < 0)) return <p className="p-5 text-sm text-muted-foreground">A share chart cannot represent negative values. Choose a bar chart or open the table.</p>;
    const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0);
    if (!total) return <p className="p-5 text-sm text-muted-foreground">No positive values to show as shares. Open the table for the returned values.</p>;
    return <div className="grid min-w-0 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ChartContainer config={config} className="h-60 min-w-0 w-full">
        <PieChart accessibilityLayer>
          <ChartTooltip content={({ active, payload }) => active && payload?.[0] ? <div className="rounded-lg border bg-popover p-3 text-xs shadow-md"><p className="font-semibold">{payload[0].name}</p><p>{formatMetricValue(payload[0].value, first, valueFormat)} {first}</p><p>{formatMetricValue(Number(payload[0].value) / total * 100, "", "percent")} of returned total</p></div> : null} />
          <Pie data={items.filter(item => item.value !== null && item.value > 0)} dataKey="value" nameKey="name" innerRadius={type === "donut" ? 55 : 0} outerRadius={85} isAnimationActive={false} stroke="var(--card)" strokeWidth={2}>
            {items.filter(item => item.value !== null && item.value > 0).map((item, index) => <Cell key={index} fill={item.fill} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="min-w-0 px-2"><p className="mb-3 text-xs font-medium">{first} · share of returned total</p><ul className="max-h-64 space-y-2 overflow-auto text-xs" aria-label="Category shares">
        {items.map((item, index) => <li key={index} className="flex items-start gap-2"><span className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ background: item.fill }} /><span className="min-w-0 flex-1 break-words">{item.name}</span><span className="text-right tabular-nums"><span className="block font-medium">{formatMetricValue(item.value, first, valueFormat)}</span><span className="text-muted-foreground">{item.value === null ? "Unknown share" : formatMetricValue(item.value / total * 100, "", "percent")}</span></span></li>)}
      </ul></div>
    </div>;
  }
  const axes = [
    <CartesianGrid key="grid" vertical={horizontal} horizontal={!horizontal} strokeDasharray="3 3" />,
    <XAxis key="x" type={horizontal ? "number" : "category"} dataKey={horizontal ? undefined : "category"} tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} fontSize={11} tickFormatter={horizontal ? value => formatMetricValue(value, first, valueFormat, true) : formatXTick} />,
    <YAxis key="y" yAxisId="number" type={horizontal ? "category" : "number"} dataKey={horizontal ? "category" : undefined} width={horizontal ? 115 : 55} tickLine={false} axisLine={false} fontSize={11} tickFormatter={horizontal ? formatXTick : value => formatMetricValue(value, "", hasPercent && !hasNumber ? "percent" : "number", true)} domain={!horizontal && hasPercent && !hasNumber ? [0, 100] : undefined} />,
    mixed && <YAxis key="percent" yAxisId="percent" orientation="right" width={45} domain={[0, 100]} tickLine={false} axisLine={false} tickFormatter={value => `${value}%`} fontSize={11} />,
    tooltip,
  ];
  const axis = (column: string) => mixed && isPercentColumn(column, valueFormat) ? "percent" : "number";
  const chartProps = { data: horizontal ? data.slice(0, 15) : data, accessibilityLayer: true, margin: { top: 10, right: 12, left: 0, bottom: 8 } };
  return <div className="min-w-0">
    {mixed && <p className="mb-2 px-2 text-xs text-muted-foreground">Counts use the left axis. Percentages use the right axis.</p>}
    <ChartContainer config={config} className="min-w-0 w-full" style={{ height }}>
      {type === "line" ? <LineChart {...chartProps}>{axes}{yColumns.map((column, index) => <Line key={column} yAxisId={axis(column)} type="linear" dataKey={`series${index}`} name={column} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={data.length === 1} connectNulls={false} isAnimationActive={false} />)}</LineChart>
        : type === "area" ? <AreaChart {...chartProps}>{axes}<defs>{yColumns.map((column, index) => <linearGradient key={column} id={`${id}-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.25} /><stop offset="100%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.02} /></linearGradient>)}</defs>{yColumns.map((column, index) => <Area key={column} yAxisId={axis(column)} type="linear" dataKey={`series${index}`} name={column} stroke={COLORS[index % COLORS.length]} fill={`url(#${id}-${index})`} strokeWidth={2} connectNulls={false} isAnimationActive={false} />)}</AreaChart>
          : <BarChart {...chartProps} layout={horizontal ? "vertical" : "horizontal"}>{axes}{yColumns.map((column, index) => <Bar key={column} yAxisId={axis(column)} dataKey={`series${index}`} name={column} fill={COLORS[index % COLORS.length]} radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} isAnimationActive={false} />)}</BarChart>}
    </ChartContainer>
    {legend}
    {horizontal && data.length > 15 && <p className="mt-2 text-center text-xs text-muted-foreground">First 15 categories shown. The table contains all returned rows.</p>}
  </div>;
}
