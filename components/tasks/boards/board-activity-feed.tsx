"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import {
  ActivityIcon,
  ArrowDownIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  XCircleIcon,
  InfoIcon,
  BotIcon,
  UserIcon,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export type LiveLog = {
  id: string;
  ticket_id?: string;
  ticket_title?: string;
  source?: string;
  event?: string;
  details?: string;
  level?: string;
  actor_name?: string | null;
  actor_email?: string | null;
  occurred_at?: string;
};

type Props = {
  activity: LiveLog[];
  loading: boolean;
  onTicketClick: (ticketId: string) => void;
  /** Set when the feed query failed; renders a retry alert instead of an empty state. */
  error?: string | null;
  onRetry?: () => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string, now: number): string {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Activity levels read as severity, so they use the status vocabulary. */
const LEVEL_CONFIG: Record<string, {
  ink: string;
  soft: string;
  word: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  success: { ink: "text-success-fg", soft: "bg-success-soft", word: "Success", icon: CheckCircle2Icon },
  error: { ink: "text-danger-fg", soft: "bg-danger-soft", word: "Error", icon: XCircleIcon },
  warning: { ink: "text-warning-fg", soft: "bg-warning-soft", word: "Warning", icon: AlertTriangleIcon },
  info: { ink: "text-info-fg", soft: "bg-info-soft", word: "Info", icon: InfoIcon },
};

// ── Component ────────────────────────────────────────────────────────────────

export function BoardActivityFeed({ activity, loading, onTicketClick, error, onRetry }: Props) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(activity.length);

  // Auto-scroll to top when new entries arrive.
  useEffect(() => {
    if (autoScroll && activity.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevCountRef.current = activity.length;
  }, [activity.length, autoScroll]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <ActivityIcon className="size-3.5 text-primary" aria-hidden />
          <h3 className="eyebrow text-foreground">Activity</h3>
          <Badge variant="secondary" className="h-5 px-1.5 text-2xs tabular-nums">
            {activity.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full transition-colors duration-(--dur-base) ease-(--ease-out)",
              error ? "bg-danger" : loading ? "bg-warning motion-safe:animate-pulse" : "bg-success",
            )}
            aria-hidden
          />
          <span className="text-2xs text-muted-foreground">
            {error ? "Offline" : loading ? "Connecting…" : "Live"}
          </span>
          <Toggle
            size="sm"
            pressed={autoScroll}
            onPressedChange={setAutoScroll}
            aria-label={autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
            className="ml-1 size-6 min-w-6 px-0"
          >
            <ArrowDownIcon className="size-3" />
          </Toggle>
        </div>
      </div>

      <div ref={scrollRef} className="-mx-1 flex-1 overflow-y-auto px-1 pt-2">
        {error ? (
          <Alert variant="destructive" className="mt-2">
            <XCircleIcon />
            <AlertTitle>Activity is unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            {onRetry && (
              <AlertActions>
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Try again
                </Button>
              </AlertActions>
            )}
          </Alert>
        ) : loading && activity.length === 0 ? (
          <div className="flex flex-col gap-1" aria-busy="true" aria-label="Loading activity">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-lg border border-line px-2.5 py-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="mt-1.5 h-2.5 w-1/2" />
              </div>
            ))}
          </div>
        ) : activity.length === 0 ? (
          <Empty className="min-h-40 border-line">
            <EmptyHeader>
              <EmptyTitle className="text-sm">No activity yet</EmptyTitle>
              <EmptyDescription className="text-xs">
                Runs, comments, and status changes on this board show up here as they happen.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ActivityList
            activity={activity}
            expandedId={expandedId}
            toggleExpand={toggleExpand}
            onTicketClick={onTicketClick}
          />
        )}
      </div>
    </div>
  );
}

function ActivityList({
  activity,
  expandedId,
  toggleExpand,
  onTicketClick,
}: {
  activity: LiveLog[];
  expandedId: string | null;
  toggleExpand: (id: string) => void;
  onTicketClick: (ticketId: string) => void;
}) {
  const now = useNow().getTime();
  const startOfToday = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const fmtMonth = (d: Date) =>
    d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const bucketFor = (iso: string | undefined) => {
    if (!iso) return "Earlier";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "Earlier";
    if (t >= startOfToday) return "Today";
    if (t >= startOfYesterday) return "Yesterday";
    return fmtMonth(new Date(t));
  };
  const rows = activity.slice(0, 30);
  let lastBucket: string | null = null;
  const out: React.ReactNode[] = [];
  rows.forEach((entry, index) => {
    const bucket = bucketFor(entry.occurred_at);
    if (bucket !== lastBucket) {
      out.push(
        <li key={`hdr-${bucket}-${index}`} className="eyebrow mt-2 px-1 pt-1 first:mt-0">
          {bucket}
        </li>,
      );
      lastBucket = bucket;
    }

    const config = LEVEL_CONFIG[entry.level || "info"] || LEVEL_CONFIG.info;
    const LevelIcon = config.icon;
    const isExpanded = expandedId === entry.id;
    const isNew = index === 0 && activity.length > 1;
    const isWorker = entry.source === "Worker";
    const openable = Boolean(entry.ticket_id);

    out.push(
      <li
        key={entry.id}
        className={cn(
          "relative rounded-lg border border-line px-2.5 py-1.5",
          "transition-colors duration-(--dur-fast) ease-(--ease-out)",
          openable && "hover:bg-surface-hover",
          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
          entry.level === "error" && config.soft,
          isNew && "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2",
        )}
      >
        <div className="flex items-center gap-2">
          <LevelIcon className={cn("size-3 shrink-0", config.ink)} aria-hidden />
          {openable ? (
            <button
              type="button"
              onClick={() => onTicketClick(entry.ticket_id!)}
              className={cn(
                "flex-1 truncate rounded text-left text-xs font-semibold outline-none",
                "after:absolute after:inset-0 after:content-['']",
                config.ink,
              )}
            >
              <span className="sr-only">{config.word}: </span>
              {entry.event}
            </button>
          ) : (
            <span className={cn("flex-1 truncate text-xs font-semibold", config.ink)}>
              <span className="sr-only">{config.word}: </span>
              {entry.event}
            </span>
          )}
          {entry.occurred_at && (
            <time
              dateTime={entry.occurred_at}
              className="shrink-0 text-2xs tabular-nums text-muted-foreground"
            >
              {relativeTime(entry.occurred_at, now)}
            </time>
          )}
        </div>
        {entry.ticket_title && (
          <p className="mt-0.5 truncate pl-5 text-xs font-medium text-foreground/80">
            {entry.ticket_title}
          </p>
        )}
        {(entry.actor_name || (entry.source && !isWorker)) && (
          <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-2xs text-muted-foreground">
            {entry.actor_name ? (
              <span className="inline-flex items-center gap-1" title={entry.actor_email || undefined}>
                <UserIcon className="size-2.5" aria-hidden />
                <span className="font-medium">{entry.actor_name}</span>
              </span>
            ) : null}
            {entry.source && !isWorker && (
              <span className="inline-flex items-center gap-1">
                {entry.actor_name ? <span aria-hidden>·</span> : null}
                <BotIcon className="size-2.5" aria-hidden />
                <span>{entry.source}</span>
              </span>
            )}
          </div>
        )}
        {entry.details && (
          <button
            type="button"
            onClick={() => toggleExpand(entry.id)}
            aria-expanded={isExpanded}
            className={cn(
              "relative z-10 mt-0.5 ml-5 block rounded text-left text-2xs leading-relaxed text-muted-foreground",
              "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              !isExpanded && "line-clamp-1",
            )}
          >
            {entry.details}
          </button>
        )}
      </li>,
    );
  });

  return (
    <ol className="flex flex-col gap-1" aria-label="Board activity">
      {out}
    </ol>
  );
}
