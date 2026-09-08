"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { statusHex, statusLabel, statusMeta, statusText } from "@/lib/status-colors";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";

// ── Types ────────────────────────────────────────────────────────────────────

type ActivityEntry = {
  id: string;
  type: "ticket" | "agenda";
  title: string;
  event: string;
  agent: string;
  level: string;
  timestamp: string;
  targetUrl?: string;
  ticketId?: string;
  boardId?: string;
};

function normalizeAgendaEvent(rawEvent: string): string {
  const raw = String(rawEvent || "").trim().toLowerCase();
  if (!raw) return raw;
  const withoutPrefix = raw.startsWith("agenda.") ? raw.slice("agenda.".length) : raw;
  if (withoutPrefix === "started") return "running";
  if (withoutPrefix === "created") return "scheduled";
  return withoutPrefix;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Human-readable label for the event status/action. */
function formatActivityEvent(entry: ActivityEntry): string {
  const raw = (entry.event || "").toLowerCase();
  const normalizedAgenda = entry.type === "agenda" ? normalizeAgendaEvent(raw) : raw;

  // Agenda: use canonical labels from status-colors.ts
  if (entry.type === "agenda" && statusMeta(normalizedAgenda)) return statusLabel(normalizedAgenda);

  // Ticket / non-canonical fallback
  if (raw === "force_retry") return "Force retried";
  if (raw === "created")     return "Created";
  if (raw === "updated")     return "Updated";
  if (raw === "deleted")     return "Deleted";
  if (raw === "activity" || raw === "change") return "Activity";
  if (raw.includes("comment"))   return "Comment";
  if (raw.includes("assigned"))  return "Assigned";
  if (raw.includes("running"))   return "Running";
  if (raw.includes("succeeded") || raw.includes("completed")) return "Succeeded";
  if (raw.includes("failed")    || raw.includes("expired"))   return "Failed";
  if (raw.includes("cancelled")) return "Cancelled";
  // Title-case the raw value as last resort
  return entry.event
    ? entry.event.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Activity";
}

/** Friendly agent name. */
function agentLabel(agent: string): string {
  if (!agent || agent === "main") return "Main agent";
  if (agent === "worker")         return "Worker";
  // Strip common prefixes (e.g. "agent:main:xxx" → "xxx")
  const parts = agent.split(":");
  const last = parts[parts.length - 1];
  return last.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Dot visuals ──────────────────────────────────────────────────────────────

/** Status vocabulary for the dot and label; agenda statuses keep their own palette. */
const LEVEL_DOT: Record<string, string> = {
  success: "bg-success",
  error: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};
const LEVEL_TEXT: Record<string, string> = {
  success: "text-success-fg",
  error: "text-danger-fg",
  warning: "text-warning-fg",
  info: "text-info-fg",
};

function agendaStatus(entry: ActivityEntry) {
  if (entry.type !== "agenda") return null;
  const normalized = normalizeAgendaEvent(entry.event);
  return statusMeta(normalized) ? normalized : null;
}

/** Class and, for agenda statuses, inline colour of the status dot. */
function dotVisual(entry: ActivityEntry): { className: string; style?: React.CSSProperties } {
  const agenda = agendaStatus(entry);
  if (agenda) return { className: "", style: { backgroundColor: statusHex(agenda) } };
  return { className: LEVEL_DOT[entry.level] ?? "bg-muted-foreground/50" };
}

/** Class and, for agenda statuses, inline colour of the event label. */
function labelVisual(entry: ActivityEntry): { className: string; style?: React.CSSProperties } {
  const agenda = agendaStatus(entry);
  if (agenda) return { className: "", style: { color: statusText(agenda) } };
  return { className: LEVEL_TEXT[entry.level] ?? "text-sidebar-foreground/70" };
}

// ── Running dot animation class ───────────────────────────────────────────────

function isAnimated(entry: ActivityEntry): boolean {
  return entry.type === "agenda" && ["running", "auto_retry"].includes(normalizeAgendaEvent(entry.event));
}

const MAX_ENTRIES = 8;

// ── Singleton SSE (survives remounts, no reconnect flicker) ──────────────────

let _globalEs: EventSource | null = null;
let _globalEntries: ActivityEntry[] = [];
let _globalConnected = false;
let _initialLoaded = false;
let _maxEntries = MAX_ENTRIES;
const _listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of _listeners) fn();
}

async function loadInitialEntries() {
  if (_initialLoaded) return;
  _initialLoaded = true;
  try {
    const res = await fetch("/api/notifications/recent", { cache: "reload" });
    const json = await res.json();
    if (json.ok && Array.isArray(json.entries)) {
      if (typeof json.limit === "number" && json.limit > 0) {
        _maxEntries = json.limit;
      }
      _globalEntries = json.entries.slice(0, _maxEntries);
      notifyListeners();
    }
  } catch {
    /* ignore fetch errors */
  }
}

function ensureConnection() {
  if (_globalEs && _globalEs.readyState !== EventSource.CLOSED) return;

  _globalEs = new EventSource("/api/notifications/stream");

  _globalEs.addEventListener("connected", () => {
    _globalConnected = true;
    notifyListeners();
  });

  _globalEs.addEventListener("activity", (e) => {
    try {
      const entry: ActivityEntry = JSON.parse(e.data);
      // Prepend and deduplicate — most recent update for a given id wins
      _globalEntries = [
        entry,
        ..._globalEntries.filter((x) => x.id !== entry.id),
      ].slice(0, _maxEntries);
      _globalConnected = true;
      notifyListeners();
    } catch {
      /* ignore parse errors */
    }
  });

  _globalEs.onerror = () => {
    _globalConnected = false;
    notifyListeners();
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function NavActivity(): React.ReactElement {
  const router = useRouter();
  const [entries, setEntries] = useState<ActivityEntry[]>(_globalEntries);
  const [connected, setConnected] = useState(_globalConnected);

  useEffect(() => {
    void loadInitialEntries();
    ensureConnection();

    const listener = () => {
      setEntries([..._globalEntries]);
      setConnected(_globalConnected);
    };
    _listeners.add(listener);
    listener();

    return () => {
      _listeners.delete(listener);
    };
  }, []);

  // Refresh relative timestamps every 30 s
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Deduplicate before render — same id can arrive from both initial load + SSE
  const dedupedEntries = [...new Map(entries.map((e) => [e.id, e])).values()];

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="eyebrow flex h-7 items-center justify-between text-sidebar-foreground/55">
        <span>Live activity</span>
        <span className="flex items-center gap-1.5 normal-case tracking-normal" role="status">
          <span
            className={cn(
              "size-1.5 rounded-full transition-colors",
              connected ? "bg-success" : "bg-warning animate-pulse"
            )}
            aria-hidden
          />
          <span className="text-2xs font-medium text-sidebar-foreground/55">
            {connected ? "Live" : "Connecting…"}
          </span>
        </span>
      </SidebarGroupLabel>

      <SidebarGroupContent>
        <div className="flex flex-col gap-px px-2 pb-1">
          {dedupedEntries.length === 0 ? (
            <p className="py-3 text-center text-xs text-sidebar-foreground/45">
              No recent activity
            </p>
          ) : (
            dedupedEntries.map((entry) => {
              const href = entry.targetUrl || (entry.type === "agenda" ? "/agenda" : "/boards");
              const dot = dotVisual(entry);
              const label = labelVisual(entry);
              const animated = isAnimated(entry);

              const handleEntryClick = (e: React.MouseEvent) => {
                e.preventDefault();
                if (entry.type === "ticket" && entry.ticketId && entry.boardId) {
                  // Navigate to the board, then dispatch a custom event to open
                  // the ticket modal — no ?ticket= in the URL so refresh is clean
                  router.push(`/boards?board=${encodeURIComponent(entry.boardId)}`);
                  window.dispatchEvent(new CustomEvent("mc:open-ticket", {
                    detail: { ticketId: entry.ticketId, boardId: entry.boardId },
                  }));
                } else {
                  router.push(href);
                }
              };

              return (
                <button
                  key={entry.id}
                  onClick={handleEntryClick}
                  className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-(--dur-fast) ease-(--ease-out) outline-none hover:bg-sidebar-accent/60 focus-visible:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
                  title={`${entry.title} — ${formatActivityEvent(entry)}`}
                >
                  {/* Status dot */}
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      dot.className,
                      animated && "animate-pulse"
                    )}
                    style={dot.style}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Top row: event label + timestamp */}
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn("truncate text-xs font-medium", label.className)}
                        style={label.style}
                      >
                        {formatActivityEvent(entry)}
                      </span>
                      <span className="shrink-0 text-2xs tabular-nums text-sidebar-foreground/45">
                        {relativeTime(entry.timestamp)}
                      </span>
                    </div>

                    {/* Bottom row: title + agent badge */}
                    <div className="flex items-center gap-1 min-w-0">
                      <p className="flex-1 truncate text-xs leading-snug text-sidebar-foreground/70">
                        {entry.title}
                      </p>
                      {entry.agent && (
                        <span className="shrink-0 text-2xs text-sidebar-foreground/45">
                          {agentLabel(entry.agent)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
