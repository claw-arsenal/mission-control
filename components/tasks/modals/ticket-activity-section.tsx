"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TicketActivity } from "@/types/tasks";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  InfoIcon,
  ListIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";

const formatDate = (v: string) =>
  new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Activity levels read as severity, so they use the status vocabulary. */
const LEVEL_CONFIG: Record<string, {
  ink: string;
  word: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  success: { ink: "text-success-fg", word: "Success", icon: CheckCircle2Icon },
  error: { ink: "text-danger-fg", word: "Error", icon: XCircleIcon },
  warning: { ink: "text-warning-fg", word: "Warning", icon: AlertTriangleIcon },
  info: { ink: "text-info-fg", word: "Info", icon: InfoIcon },
};

// ── Markdown renderer for agent output ───────────────────────────────────────

function renderActivityInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-2xs">{codeMatch[1]}</code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="font-bold">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) { parts.push(remaining); break; }
    if (nextSpecial === 0) { parts.push(remaining[0]); remaining = remaining.slice(1); }
    else { parts.push(remaining.slice(0, nextSpecial)); remaining = remaining.slice(nextSpecial); }
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function ActivityMarkdown({ text }: { text: string }) {
  const cleaned = text.replace(/\n*>\s*`Agent:.*`$/, "").trim();
  const lines = cleaned.split("\n");
  return (
    <div className="flex flex-col gap-0.5 text-xs leading-relaxed text-foreground/90">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h4 key={i} className="mt-2 mb-0.5 text-xs font-bold">{renderActivityInline(line.slice(4))}</h4>;
        if (line.startsWith("## ")) return <h3 key={i} className="mt-2 mb-0.5 text-sm font-bold">{renderActivityInline(line.slice(3))}</h3>;
        if (line.startsWith("# ")) return <h2 key={i} className="mt-2 mb-0.5 text-base font-bold">{renderActivityInline(line.slice(2))}</h2>;
        if (/^[-*]\s/.test(line)) return (
          <div key={i} className="flex gap-1.5 pl-1">
            <span className="shrink-0 text-muted-foreground" aria-hidden>•</span>
            <span>{renderActivityInline(line.replace(/^[-*]\s/, ""))}</span>
          </div>
        );
        if (/^\d+\.\s/.test(line)) {
          const num = line.match(/^(\d+)\./)?.[1];
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="shrink-0 tabular-nums text-muted-foreground">{num}.</span>
              <span>{renderActivityInline(line.replace(/^\d+\.\s/, ""))}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{renderActivityInline(line)}</p>;
      })}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

type Props = {
  activity: TicketActivity[];
  loading: boolean;
};

export function TicketActivitySection({ activity, loading }: Props) {
  const hasAgentOutput = activity.some((e) => e.event === "Agent response" || e.event === "Plan generated");
  const [open, setOpen] = useState(hasAgentOutput);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger
        className={cn(
          "flex items-center gap-1.5 rounded text-xs font-semibold text-muted-foreground",
          "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <ZapIcon className="size-3" aria-hidden /> Activity and output ({activity.length})
        <ChevronDownIcon
          className={cn(
            "size-3 transition-transform duration-(--dur-fast) ease-(--ease-out)",
            !open && "-rotate-90",
          )}
          aria-hidden
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        {loading && activity.length === 0 ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading activity">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : activity.length === 0 ? (
          <Empty className="min-h-0 border-line py-4">
            <EmptyHeader>
              <EmptyDescription className="text-xs">
                Nothing has run on this ticket yet. Runs, plans, and agent replies land here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <ul className="space-y-2">
              {activity.map((e) => {
                const isAgentOutput = e.source !== "Worker" && e.source !== "Tasks" && e.event === "Agent response";
                const isPlan = e.event === "Plan generated" || e.event === "Plan ready";
                const hasDetails = Boolean(e.details?.trim());
                const config = LEVEL_CONFIG[e.level || "info"] ?? LEVEL_CONFIG.info;
                const LevelIcon = config.icon;
                return (
                  <li key={e.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <LevelIcon className={cn("size-3 shrink-0", config.ink)} aria-hidden />
                        {isAgentOutput && <BotIcon className="size-3 shrink-0 text-primary" aria-hidden />}
                        {isPlan && <ListIcon className="size-3 shrink-0 text-primary" aria-hidden />}
                        <span
                          className={cn(
                            "truncate text-xs font-semibold",
                            isAgentOutput && e.level !== "error" ? "text-primary" : config.ink,
                          )}
                        >
                          <span className="sr-only">{config.word}: </span>
                          {e.event}
                        </span>
                        {e.source && e.source !== "Tasks" && (
                          <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-2xs">
                            {e.source}
                          </Badge>
                        )}
                      </div>
                      <time dateTime={e.occurredAt} className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                        {formatDate(e.occurredAt)}
                      </time>
                    </div>

                    {e.actorName && (
                      <p className="mb-0.5 text-2xs text-muted-foreground" title={e.actorEmail || undefined}>
                        by <span className="font-medium text-foreground/70">{e.actorName}</span>
                      </p>
                    )}

                    {hasDetails && (isAgentOutput || isPlan) ? (
                      <div className="mt-1.5 rounded-md border border-line bg-card p-3">
                        <ActivityMarkdown text={e.details} />
                      </div>
                    ) : hasDetails ? (
                      <p className="mt-0.5 line-clamp-4 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                        {e.details}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
