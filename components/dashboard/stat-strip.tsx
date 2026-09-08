import Link from "next/link"
import { IconArrowDownRight, IconArrowUpRight, IconMinus } from "@tabler/icons-react"

import type { DashboardPulse } from "@/lib/db/dashboard-pulse"
import type { OverviewPoint } from "@/lib/db/server-data"
import { Sparkline } from "@/components/ui/sparkline"
import { cn } from "@/lib/utils"

type Tone = "neutral" | "success" | "warning" | "danger"

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
}

/** Change versus the previous period. `upIsGood` decides which direction earns green. */
export function Delta({
  current,
  previous,
  upIsGood,
  period,
}: {
  current: number
  previous: number
  upIsGood: boolean | null
  period: string
}) {
  const diff = current - previous
  const direction = diff === 0 ? "flat" : diff > 0 ? "up" : "down"
  const tone: Tone =
    direction === "flat" || upIsGood === null
      ? "neutral"
      : (direction === "up") === upIsGood
        ? "success"
        : "danger"
  const label =
    previous === 0
      ? diff === 0 ? "No change" : `${diff > 0 ? "+" : ""}${diff}`
      : `${diff > 0 ? "+" : ""}${Math.round((diff / previous) * 100)}%`
  const Icon = direction === "up" ? IconArrowUpRight : direction === "down" ? IconArrowDownRight : IconMinus

  return (
    <span
      data-tone={tone}
      data-direction={direction}
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", TONE_TEXT[tone])}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      <span className="sr-only"> versus {period}</span>
    </span>
  )
}

type Tile = {
  id: string
  label: string
  href: string
  value: string
  valueTone?: Tone
  context: React.ReactNode
  aside?: React.ReactNode
  unavailable?: boolean
}

function StatTile({ tile }: { tile: Tile }) {
  return (
    <Link
      href={tile.href}
      prefetch={false}
      data-slot="stat-tile"
      data-unavailable={tile.unavailable ? "" : undefined}
      className="group/tile flex min-w-0 flex-col gap-2 px-5 py-4 outline-none transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
    >
      <span className="text-xs font-medium text-muted-foreground">{tile.label}</span>
      <div className="flex items-end justify-between gap-3">
        <span
          className={cn(
            "figure text-2xl leading-none",
            tile.unavailable ? "text-muted-foreground" : tile.valueTone ? TONE_TEXT[tile.valueTone] : "text-foreground",
          )}
        >
          {tile.value}
        </span>
        {tile.aside ? <span className="mb-0.5 shrink-0">{tile.aside}</span> : null}
      </div>
      <span className="text-xs text-pretty text-muted-foreground">{tile.context}</span>
    </Link>
  )
}

function tail(series: OverviewPoint[], key: keyof OverviewPoint, days: number): number[] {
  return series.slice(-days).map((p) => Number(p[key]) || 0)
}

type Props = {
  pulse: DashboardPulse
  series: OverviewPoint[]
}

/**
 * One surface, six operational numbers. Each tile links to the place you act
 * on it. A block whose query failed renders as unavailable, never as zero.
 */
export function StatStrip({ pulse, series }: Props) {
  const { tickets, agenda, services } = pulse

  const tiles: Tile[] = [
    tickets
      ? {
          id: "open",
          label: "Open tickets",
          href: "/boards",
          value: String(tickets.open),
          context: (
            <>
              <span className={tickets.overdue > 0 ? "font-medium text-danger-fg" : undefined}>
                {tickets.overdue} overdue
              </span>
              {" · "}
              <span className={tickets.dueToday > 0 ? "font-medium text-warning-fg" : undefined}>
                {tickets.dueToday} due today
              </span>
            </>
          ),
        }
      : unavailable("open", "Open tickets", "/boards"),
    tickets
      ? {
          id: "completed",
          label: "Completed, 7 days",
          href: "/boards",
          value: String(tickets.completed7d),
          context: `${tickets.completedPrev7d} the week before`,
          aside: (
            <span className="flex items-center gap-2">
              <Delta current={tickets.completed7d} previous={tickets.completedPrev7d} upIsGood period="the previous 7 days" />
              <Sparkline values={tail(series, "completed", 14)} color="var(--viz-1)" label="Completed per day, last 14 days" />
            </span>
          ),
        }
      : unavailable("completed", "Completed, 7 days", "/boards"),
    tickets
      ? {
          id: "created",
          label: "Created, 7 days",
          href: "/boards",
          value: String(tickets.created7d),
          context: `${tickets.createdPrev7d} the week before`,
          aside: (
            <span className="flex items-center gap-2">
              <Delta current={tickets.created7d} previous={tickets.createdPrev7d} upIsGood={null} period="the previous 7 days" />
              <Sparkline values={tail(series, "created", 14)} color="var(--viz-2)" label="Created per day, last 14 days" />
            </span>
          ),
        }
      : unavailable("created", "Created, 7 days", "/boards"),
    agenda
      ? {
          id: "upcoming",
          label: "Agenda, next 24h",
          href: "/agenda",
          value: String(agenda.upcoming24h),
          context: agenda.active > 0 ? `${agenda.active} running now` : "Nothing running now",
        }
      : unavailable("upcoming", "Agenda, next 24h", "/agenda"),
    agenda
      ? {
          id: "failed",
          label: "Failed runs, 7 days",
          href: "/agenda",
          value: String(agenda.failed7d),
          valueTone: agenda.failed7d > 0 ? "danger" : undefined,
          context: agenda.failed7d > 0 ? "Open Agenda to retry" : "All runs succeeded",
        }
      : unavailable("failed", "Failed runs, 7 days", "/agenda"),
    services
      ? {
          id: "services",
          label: "Services",
          href: "/logs",
          value: services.total === 0 ? "0" : `${services.running}/${services.total}`,
          valueTone: services.error > 0 ? "danger" : services.stopped > 0 ? "warning" : undefined,
          context:
            services.total === 0
              ? "No services registered"
              : services.error > 0
                ? `${services.error} reporting errors`
                : services.stopped > 0
                  ? `${services.stopped} stopped`
                  : "All running",
        }
      : unavailable("services", "Services", "/logs"),
  ]

  return (
    <section aria-label="Operational overview" className="surface-card overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-y divide-line md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0 [&>*:nth-child(-n+2)]:border-t-0 md:[&>*:nth-child(-n+3)]:border-t-0 [&>*:nth-child(2n+1)]:border-l-0 md:[&>*:nth-child(2n+1)]:border-l md:[&>*:nth-child(3n+1)]:border-l-0 xl:[&>*:nth-child(3n+1)]:border-l xl:[&>*:first-child]:border-l-0">
        {tiles.map((tile) => (
          <StatTile key={tile.id} tile={tile} />
        ))}
      </div>
    </section>
  )
}

function unavailable(id: string, label: string, href: string): Tile {
  return { id, label, href, value: "—", context: "Unavailable right now", unavailable: true }
}
