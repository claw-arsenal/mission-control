import Link from "next/link"
import { IconArrowUpRight, IconCalendarEvent, IconCircleCheck, IconServer, IconTicket } from "@tabler/icons-react"

import type { AttentionItem, AttentionKind, AttentionSeverity } from "@/lib/db/dashboard-pulse"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const KIND_ICON: Record<AttentionKind, React.ElementType> = {
  service: IconServer,
  agenda: IconCalendarEvent,
  ticket: IconTicket,
}

const KIND_LABEL: Record<AttentionKind, string> = {
  service: "Service",
  agenda: "Agenda run",
  ticket: "Ticket",
}

const SEVERITY_DOT: Record<AttentionSeverity, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
}

function relative(iso: string | null, now: number): string {
  if (!iso) return ""
  const then = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime()
  if (Number.isNaN(then)) return ""
  const diffMin = Math.round((now - then) / 60_000)
  const abs = Math.abs(diffMin)
  const ago = diffMin >= 0
  let unit: string
  if (abs < 60) unit = `${abs}m`
  else if (abs < 60 * 24) unit = `${Math.round(abs / 60)}h`
  else unit = `${Math.round(abs / (60 * 24))}d`
  return ago ? `${unit} ago` : `in ${unit}`
}

type Props = {
  items: AttentionItem[]
  /** Reference time (ms) for the relative timestamps; the server's load time. */
  now: number
}

/**
 * Failed agenda runs, unhealthy services and overdue tickets, in that order.
 * Each row links to where the operator recovers it.
 */
export function AttentionPanel({ items, now }: Props) {
  const count = items.length

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b border-line py-5">
        <CardTitle className="flex items-center gap-2 text-md">
          Needs attention
          {count > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-soft px-1.5 text-xs font-semibold tabular-nums text-danger-fg">
              {count}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>Failed runs, stopped services, overdue work</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {count === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success-fg">
              <IconCircleCheck className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Nothing needs attention</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Failed agenda runs, unhealthy services and overdue tickets will show up here.
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line" aria-label="Items needing attention">
            {items.map((item) => {
              const Icon = KIND_ICON[item.kind]
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    className="group/row flex items-start gap-3 px-5 py-3 outline-none transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover focus-visible:bg-surface-hover"
                  >
                    <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
                      <Icon className="size-4" aria-hidden />
                      <span
                        className={cn("absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface-1", SEVERITY_DOT[item.severity])}
                        aria-hidden
                      />
                      <span className="sr-only">{KIND_LABEL[item.kind]}, {item.severity === "danger" ? "failed" : "warning"}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{relative(item.at, now)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.detail}</span>
                    </span>
                    <IconArrowUpRight
                      className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
                      aria-hidden
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
