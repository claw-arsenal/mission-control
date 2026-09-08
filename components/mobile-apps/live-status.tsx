"use client";

import { IconRefresh } from "@tabler/icons-react";
import type { Connection } from "@/lib/mobile-apps/client/live-store";
import { clockTime, relativeTime } from "@/lib/mobile-apps/client/format";
import { cn } from "@/lib/utils";

type Props = {
  connection: Connection;
  /** Server time of the data on screen. */
  loadedAt: string | null;
  /** A store refresh or freshness check is in flight. */
  refreshing?: boolean;
  now: number | null;
  className?: string;
};

/**
 * One pill that says whether the page is live, and how old what you see is.
 * Text always accompanies the colour; the dot pulses only while live.
 */
export function LiveStatus({ connection, loadedAt, refreshing = false, now, className }: Props) {
  const age = now == null ? null : relativeTime(loadedAt, now);
  const at = now == null ? null : clockTime(loadedAt, now);
  const tone = connection === "live" ? "success" : connection === "offline" ? "danger" : connection === "reconnecting" ? "warning" : "muted";
  const label = refreshing
    ? "Refreshing"
    : connection === "live"
      ? age ? `Live · updated ${age}` : "Live"
      : connection === "reconnecting"
        ? at ? `Reconnecting · data from ${at}` : "Reconnecting"
        : connection === "offline"
          ? at ? `Offline · data from ${at}` : "Offline"
          : connection === "connecting"
            ? "Connecting"
            : age ? `Updated ${age}` : "";
  const dot = {
    success: "bg-success",
    danger: "bg-danger",
    warning: "bg-warning",
    muted: "bg-muted-foreground/50",
  }[tone];
  const text = { success: "text-success-fg", danger: "text-danger-fg", warning: "text-warning-fg", muted: "text-muted-foreground" }[tone];

  return (
    <span
      data-connection={connection}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 text-xs font-medium tabular-nums", text, className)}
      title={loadedAt ? `Data as of ${new Date(loadedAt).toLocaleString()}` : undefined}
    >
      {refreshing ? (
        <IconRefresh className="size-3 motion-safe:animate-spin" aria-hidden />
      ) : (
        <span className={cn("relative flex size-2", dot, "rounded-full")} aria-hidden>
          {connection === "live" ? <span className="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping" /> : null}
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}
