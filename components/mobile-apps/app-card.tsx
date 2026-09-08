"use client";

import Link from "next/link";
import { IconAlertTriangle, IconBrandApple, IconBrandGooglePlay, IconChevronRight } from "@tabler/icons-react";
import type { AppListing, AppSummary } from "@/lib/mobile-apps/client/live-store";
import { relativeTime } from "@/lib/mobile-apps/client/format";
import { cn } from "@/lib/utils";

export type { AppListing, AppSummary };

/**
 * Store presence badge for the list. Intentionally shows NO rating: a single
 * headline rating per store is overloaded/ambiguous (Apple per-country vs Google
 * report avg vs written-review avg) and misleads in a list. Ratings live on the
 * app detail page where each number is labeled with its source.
 */
function StoreBadge({ listing }: { listing: AppListing }) {
  const Icon = listing.store === "apple" ? IconBrandApple : IconBrandGooglePlay;
  const label = listing.store === "apple" ? "App Store" : "Google Play";
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 text-xs font-medium text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

const REPORT_TONE: Record<string, { label: string; cls: string }> = {
  fresh: { label: "Reports up to date", cls: "text-success-fg" },
  refreshing: { label: "Reports refreshing", cls: "text-warning-fg" },
  stale: { label: "Report update available", cls: "text-warning-fg" },
  failed: { label: "Report refresh failed", cls: "text-danger-fg" },
  unknown: { label: "Reports not checked yet", cls: "text-muted-foreground" },
  not_configured: { label: "Reports not configured", cls: "text-muted-foreground" },
};

export function AppIcon({ app, size = "size-11" }: { app: Pick<AppSummary, "name" | "icon_url">; size?: string }) {
  return app.icon_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={app.icon_url} alt="" className={cn(size, "shrink-0 rounded-xl border border-line")} />
  ) : (
    <div className={cn(size, "grid shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-sm font-semibold text-muted-foreground")} aria-hidden>
      {app.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** One row per tracked app: identity, store presence, and honest activity facts. */
export function AppCard({ app, now }: { app: AppSummary; now: number | null }) {
  const facts = app.facts;
  const checked = now == null ? null : relativeTime(facts?.lastCheckedAt, now);
  const report = facts?.reportsStatus ? REPORT_TONE[facts.reportsStatus] ?? REPORT_TONE.unknown : null;
  const negative = facts?.negativeLast7d ?? 0;
  const recent = facts?.reviewsLast7d ?? 0;

  return (
    <Link
      href={`/mobile-apps/${app.id}`}
      prefetch={false}
      className="group/row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 outline-none transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
    >
      <AppIcon app={app} />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-semibold">{app.name}</span>
          {facts?.syncFailed ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-fg">
              <IconAlertTriangle className="size-3" aria-hidden /> Sync failed
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {app.listings.length > 0 ? app.listings.map((l) => <StoreBadge key={l.id} listing={l} />) : <span>No store listings</span>}
          {report ? <span className={cn("ml-1", report.cls)}>{report.label}</span> : null}
        </div>
      </div>

      <dl className="col-span-3 grid grid-cols-3 gap-x-4 text-xs sm:col-span-1 sm:flex sm:items-center sm:gap-6">
        <div className="min-w-0">
          <dt className="text-muted-foreground">New, 7 days</dt>
          <dd className={cn("figure text-lg leading-6", recent > 0 ? "text-foreground" : "text-muted-foreground")}>{recent.toLocaleString()}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Negative, 7 days</dt>
          <dd className={cn("figure text-lg leading-6", negative > 0 ? "text-danger-fg" : "text-muted-foreground")}>{negative.toLocaleString()}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Last checked</dt>
          <dd className="truncate text-sm leading-6 text-foreground/80">{checked ?? (facts?.lastCheckedAt ? "" : "never")}</dd>
        </div>
      </dl>

      <IconChevronRight className="hidden size-4 shrink-0 text-muted-foreground/50 transition-transform duration-(--dur-fast) ease-(--ease-out) group-hover/row:translate-x-0.5 sm:block" aria-hidden />
    </Link>
  );
}
