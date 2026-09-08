"use client";

import type { ReactNode } from "react";
import { SourceBadge } from "@/components/mobile-apps/source-badge";
import { cn } from "@/lib/utils";

type Fact = { id: string; label: string; value: string; context: ReactNode; tone?: "danger" | "warning" | "neutral"; badge?: ReactNode; onClick?: () => void; active?: boolean };

/**
 * Four honest counts for the selected store. Counts are facts; the rating
 * lives in the store card where each value is labelled with its source.
 */
export function FactsStrip({
  store,
  total,
  negative,
  needsReply,
  responded,
  negativeThreshold,
  onShowNeedsReply,
  needsReplyActive,
}: {
  store: "apple" | "google";
  total: number;
  negative: number;
  needsReply: number;
  responded: number;
  negativeThreshold: number;
  onShowNeedsReply?: () => void;
  needsReplyActive?: boolean;
}) {
  const replyRate = total > 0 ? `${Math.round((responded / total) * 100)}%` : "—";
  const facts: Fact[] = [
    {
      id: "total",
      label: "Stored written reviews",
      value: total.toLocaleString(),
      context: store === "apple" ? "App Store Connect API" : "Play Reviews API + monthly exports",
      badge: <SourceBadge kind="official-api" label="API + CSV" title={store === "apple" ? "App Store Connect API customerReviews." : "Play Reviews API (last ~7 days) + monthly Play Console review CSV exports."} />,
    },
    {
      id: "negative",
      label: `Negative, ${negativeThreshold}★ or lower`,
      value: negative.toLocaleString(),
      tone: negative > 0 ? "danger" : "neutral",
      context: total > 0 ? `${Math.round((negative / total) * 100)}% of stored reviews` : "No stored reviews",
    },
    {
      id: "needs-reply",
      label: "Needs a reply",
      value: needsReply.toLocaleString(),
      tone: needsReply > 0 ? "warning" : "neutral",
      context: needsReply > 0 ? "Negative without a developer response" : "Every negative review has a response",
      onClick: onShowNeedsReply,
      active: needsReplyActive,
    },
    {
      id: "replies",
      label: "Developer reply rate",
      value: replyRate,
      context: `${responded.toLocaleString()} with a response`,
      badge: <SourceBadge kind="derived" title="Share of stored reviews that have a developer response — computed from review data." />,
    },
  ];

  return (
    <section aria-label="Review facts" className="surface-card overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-y divide-line lg:grid-cols-4 lg:divide-y-0 [&>*:nth-child(-n+2)]:border-t-0 [&>*:nth-child(2n+1)]:border-l-0 lg:[&>*:nth-child(2n+1)]:border-l lg:[&>*:first-child]:border-l-0">
        {facts.map((fact) => {
          const Tag = fact.onClick ? "button" : "div";
          return (
            <Tag
              key={fact.id}
              type={fact.onClick ? "button" : undefined}
              onClick={fact.onClick}
              aria-pressed={fact.onClick ? fact.active : undefined}
              className={cn(
                "flex min-w-0 flex-col gap-1.5 px-4 py-3.5 text-left outline-none sm:px-5",
                fact.onClick && "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                fact.active && "bg-warning-soft/60",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{fact.label}{fact.badge}</span>
              <span className={cn("figure text-2xl leading-none", fact.tone === "danger" ? "text-danger-fg" : fact.tone === "warning" ? "text-warning-fg" : "text-foreground")}>
                {fact.value}
              </span>
              <span className="truncate text-xs text-muted-foreground">{fact.context}</span>
            </Tag>
          );
        })}
      </div>
    </section>
  );
}
