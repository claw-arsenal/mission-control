"use client"

import * as React from "react"

function greetingFor(hour: number) {
  if (hour < 5) return "Working late"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

type Props = {
  name: string | null
  /** One honest sentence about what needs doing, or null when nothing does. */
  summary: string | null
}

/**
 * The page's opening line. Local time resolves after mount to avoid a
 * server/client mismatch; the layout reserves the height so nothing jumps.
 */
export function DashboardIntro({ name, summary }: Props) {
  const [now, setNow] = React.useState<Date | null>(null)

  React.useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const greeting = now ? greetingFor(now.getHours()) : "Welcome back"
  const dateLabel = now
    ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : " "

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
      <div className="min-w-0">
        <p className="eyebrow" aria-live="off">{dateLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {greeting}
          {name ? `, ${name}` : ""}
        </h1>
      </div>
      {summary ? (
        <p className="max-w-[48ch] text-sm text-muted-foreground">{summary}</p>
      ) : null}
    </div>
  )
}
