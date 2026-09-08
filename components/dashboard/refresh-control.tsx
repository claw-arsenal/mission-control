"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconRefresh } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function relativeLabel(loadedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - loadedAt) / 1000))
  if (seconds < 45) return "Updated just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `Updated ${hours}h ago`
}

/**
 * Shows when the server data was rendered and re-fetches it in place.
 * The icon spins only while the refresh is pending: motion as state.
 */
export function RefreshControl({ loadedAt }: { loadedAt: number }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [now, setNow] = React.useState<number | null>(null)

  React.useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [loadedAt])

  const label = now === null ? " " : relativeLabel(loadedAt, now)

  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline" aria-live="polite">
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh dashboard"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        <IconRefresh className={cn("size-4", pending && "animate-spin")} aria-hidden />
      </Button>
    </div>
  )
}
