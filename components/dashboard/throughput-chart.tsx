"use client"

import * as React from "react"
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"

import type { OverviewPoint } from "@/lib/db/server-data"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type View = "tickets" | "agenda"
type Range = "7d" | "30d" | "90d"

const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90 }
/* Controls sit under the title on narrow cards and beside it on wide ones. */
const ACTION_PLACEMENT =
  "col-span-2 row-start-3 justify-self-start @xl/card-header:col-span-1 @xl/card-header:col-start-2 @xl/card-header:row-span-2 @xl/card-header:row-start-1 @xl/card-header:justify-self-end"

const RANGE_LABEL: Record<Range, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" }

const chartConfig = {
  completed: { label: "Completed", color: "var(--viz-1)" },
  created: { label: "Created", color: "var(--viz-2)" },
  events: { label: "Scheduled", color: "var(--viz-1)" },
} satisfies ChartConfig

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function shortDate(value: string) {
  return toDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 rounded-[2px]", className)} style={{ backgroundColor: color }} />
}

type Props = {
  data: OverviewPoint[]
}

/**
 * Created vs completed per day. The summary row doubles as the legend: every
 * series is named there with its swatch and its total for the visible range.
 * Series stay direct children of the chart: Recharts 2 ignores fragments.
 */
export function ThroughputChart({ data }: Props) {
  const [view, setView] = React.useState<View>("tickets")
  const [range, setRange] = React.useState<Range>("30d")

  const visible = React.useMemo(() => data.slice(-RANGE_DAYS[range]), [data, range])
  const totals = React.useMemo(
    () =>
      visible.reduce(
        (acc, p) => ({ created: acc.created + p.created, completed: acc.completed + p.completed, events: acc.events + p.events }),
        { created: 0, completed: 0, events: 0 },
      ),
    [visible],
  )
  const isTickets = view === "tickets"
  const isEmpty = isTickets ? totals.created + totals.completed === 0 : totals.events === 0

  return (
    <Card className="@container/chart gap-4">
      <CardHeader className="gap-1">
        <CardTitle className="col-span-2 text-md @xl/card-header:col-span-1">{isTickets ? "Ticket flow" : "Agenda scheduling"}</CardTitle>
        <CardDescription className="col-span-2 @xl/card-header:col-span-1">
          {isTickets ? "Tickets created and completed per day" : "Agenda events scheduled per day"} · {RANGE_LABEL[range]}
        </CardDescription>
        <CardAction className={cn("flex flex-wrap items-center gap-2", ACTION_PLACEMENT)}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={view}
            onValueChange={(v) => v && setView(v as View)}
            aria-label="Series"
          >
            <ToggleGroupItem value="tickets" className="px-3 text-xs">Tickets</ToggleGroupItem>
            <ToggleGroupItem value="agenda" className="px-3 text-xs">Agenda</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={range}
            onValueChange={(v) => v && setRange(v as Range)}
            aria-label="Time range"
          >
            <ToggleGroupItem value="7d" className="px-3 text-xs">7d</ToggleGroupItem>
            <ToggleGroupItem value="30d" className="px-3 text-xs">30d</ToggleGroupItem>
            <ToggleGroupItem value="90d" className="px-3 text-xs">90d</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-2" aria-label="Totals for the visible range">
          {isTickets ? (
            <>
              <div className="flex items-center gap-2">
                <Swatch color="var(--viz-1)" />
                <dt className="text-xs text-muted-foreground">Completed</dt>
                <dd className="figure text-lg leading-none">{totals.completed}</dd>
              </div>
              <div className="flex items-center gap-2">
                <Swatch color="var(--viz-2)" />
                <dt className="text-xs text-muted-foreground">Created</dt>
                <dd className="figure text-lg leading-none">{totals.created}</dd>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Swatch color="var(--viz-1)" />
              <dt className="text-xs text-muted-foreground">Scheduled</dt>
              <dd className="figure text-lg leading-none">{totals.events}</dd>
            </div>
          )}
        </dl>

        <div className="relative">
          <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full @lg/chart:h-64">
            <ComposedChart data={visible} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="throughput-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="0" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={28}
                tickFormatter={shortDate}
                className="text-2xs"
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                width={36}
                className="text-2xs"
              />
              <ChartTooltip
                cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
                content={<ChartTooltipContent labelFormatter={(v) => shortDate(String(v))} indicator="line" />}
              />
              {isTickets ? (
                <Area
                  dataKey="completed"
                  type="linear"
                  stroke="var(--viz-1)"
                  strokeWidth={2}
                  fill="url(#throughput-fill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
                  isAnimationActive={false}
                />
              ) : null}
              {isTickets ? (
                <Line
                  dataKey="created"
                  type="linear"
                  stroke="var(--viz-2)"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
                  isAnimationActive={false}
                />
              ) : null}
              {isTickets ? null : (
                <Area
                  dataKey="events"
                  type="linear"
                  stroke="var(--viz-1)"
                  strokeWidth={2}
                  fill="url(#throughput-fill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ChartContainer>
          {isEmpty ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {isTickets ? "No ticket activity in this range" : "No agenda events scheduled in this range"}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
