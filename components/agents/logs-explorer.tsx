"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { classifyAgentLogChannel, classifyAgentLogEvent } from "@/lib/agent-log-utils";
import type { Agent, AgentLog, AgentLogChannelType, AgentLogEventType } from "@/types/agents";
import {
  AgentLogChannelBadge,
  AgentLogDirectionBadge,
  AgentLogEventTypeBadge,
  AgentLogLevelBadge,
  AgentLogMemorySourceBadge,
  formatAgentName,
  formatTimestamp,
} from "@/components/agents/agent-ui";
import { LogDetailsModal } from "@/components/agents/log-details-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type LogsExplorerProps = {
  agents: Agent[];
  logs: AgentLog[];
  runtimeAgentId?: string;
  logTotals?: {
    total: number;
    info: number;
    warning: number;
    error: number;
  };
};

type FilterKey = "all" | "messages" | "tools" | "memory" | "issues";

type NormalizedLog = AgentLog & {
  eventType: AgentLogEventType;
  channelType: AgentLogChannelType;
  messagePreview: string;
};

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "messages", label: "Messages" },
  { key: "tools", label: "Tools" },
  { key: "memory", label: "Memory" },
  { key: "issues", label: "Warnings & Errors" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstNonEmptyText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function extractActorNameFromPayload(payload: unknown) {
  const root = asRecord(payload);
  if (!root) return "";

  const nestedMessage = asRecord(root.message);
  const scope = nestedMessage ?? root;

  const sender = firstNonEmptyText(scope.sender, root.sender);
  const label = firstNonEmptyText(scope.label, root.label);
  const name = firstNonEmptyText(scope.name, root.name);
  const username = firstNonEmptyText(scope.username, root.username);
  const senderId = firstNonEmptyText(scope.sender_id, root.sender_id, scope.id, root.id);

  if (label) return label;
  if (sender) return sender;
  if (name && senderId) return `${name} (${senderId})`;
  if (name) return name;
  if (username && senderId) return `${username} (${senderId})`;
  if (username) return username;
  return "";
}

function toPreview(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177)}...`;
}

function shortOpaqueId(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function truncateWithTooltip(value: string, max = 36) {
  const text = value.trim();
  if (text.length <= max) {
    return { display: text, tooltip: "" };
  }
  return {
    display: `${text.slice(0, Math.max(0, max - 3))}...`,
    tooltip: text,
  };
}

function prettifyLogPreview(messagePreview: string) {
  let next = messagePreview;

  next = next.replace(/\b(call_[A-Za-z0-9_-]{8})[A-Za-z0-9_-]*\b/g, "$1...");
  next = next.replace(/\b(fc_[A-Za-z0-9_-]{8})[A-Za-z0-9_-]*\b/g, "$1...");
  next = next.replace(/\s+result=\{[\s\S]*$/i, "");
  next = next.replace(/\s+error=\{[\s\S]*$/i, "");

  const toolHeader = next.match(/^Tool\s+([^\s]+)\s+\(([^)]+)\)\s+-\s*/i);
  if (toolHeader) {
    const toolName = toolHeader[1] ?? "tool";
    const status = toolHeader[2] ?? "status";

    const actionMatch = next.match(/\baction=([^\s]+)/i);
    const pathMatch = next.match(/"path"\s*:\s*"([^"]+)"/i);
    const memoryMatch = next.match(/\b(collection|memory_source|memorySource)\s*=\s*([^\s]+)/i);

    const action = actionMatch?.[1] ?? "n/a";
    const path = pathMatch?.[1]?.split("/").pop();
    const memoryHint = memoryMatch ? `${memoryMatch[1]}=${memoryMatch[2]}` : "";

    const extras = [action !== "n/a" ? `action=${action}` : "", path ? `file=${path}` : "", memoryHint]
      .filter(Boolean)
      .join(" · ");

    return extras ? `${toolName} · ${status} · ${extras}` : `${toolName} · ${status}`;
  }

  return next;
}

function normalizeLogs(logs: AgentLog[]): NormalizedLog[] {
  return logs.map((log) => {
    const baseMessage = (log.message ?? "").trim();
    const level = log.level;
    const type = log.type;
    let eventType =
      log.eventType ?? classifyAgentLogEvent(level, type, baseMessage || log.messagePreview || "");

    if (type === "tool" && eventType.startsWith("memory.")) {
      eventType = classifyAgentLogEvent(level, "tool", baseMessage || log.messagePreview || "");
    }
    const channelType = log.channelType ?? classifyAgentLogChannel(baseMessage || log.messagePreview || "");
    const messagePreview = log.messagePreview?.trim() ? log.messagePreview.trim() : toPreview(baseMessage);
    return {
      ...log,
      eventType,
      channelType,
      messagePreview: prettifyLogPreview(messagePreview),
    };
  });
}

function matchFilter(log: NormalizedLog, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "messages") {
    return (
      log.eventType === "chat.user_in" ||
      log.eventType === "chat.assistant_out" ||
      log.eventType === "chat.reaction" ||
      log.type === "workflow"
    );
  }
  if (filter === "tools") {
    return (
      log.type === "tool" ||
      log.eventType === "tool.start" ||
      log.eventType === "tool.success" ||
      log.eventType === "tool.error"
    );
  }
  if (filter === "memory") {
    return (
      log.eventType === "memory.read" ||
      log.eventType === "memory.write" ||
      log.eventType === "memory.search" ||
      log.eventType === "memory.upsert" ||
      log.eventType === "memory.error" ||
      Boolean(log.memorySource)
    );
  }
  return (
    log.level === "warning" ||
    log.level === "error" ||
    log.eventType.endsWith(".warning") ||
    log.eventType.endsWith(".error")
  );
}

const LIVE_EVENTS_CHANNEL = "agent-logs-live";

function canonicalRuntimeAgentId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("runtime:") ? text.slice("runtime:".length) : text;
}

export function LogsExplorer({ agents, logs, runtimeAgentId = "", logTotals }: LogsExplorerProps) {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [liveLogs, setLiveLogs] = useState<AgentLog[]>(logs);
  const [selectedLog, setSelectedLog] = useState<NormalizedLog | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string>("");
  const [pendingDeleteLog, setPendingDeleteLog] = useState<NormalizedLog | null>(null);
  const refreshInFlightRef = useRef(false);
  const liveLogCountRef = useRef(logs.length);
  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, formatAgentName(agent.name)])),
    [agents],
  );

  useEffect(() => {
    setLiveLogs(logs);
    liveLogCountRef.current = logs.length;
  }, [logs]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    const scopeRuntimeId = canonicalRuntimeAgentId(runtimeAgentId);

    const reloadLogs = async () => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        const url = new URL("/api/agent/logs", window.location.origin);
        url.searchParams.set("limit", String(Math.max(liveLogCountRef.current, 50)));
        if (scopeRuntimeId) {
          url.searchParams.set("runtimeAgentId", scopeRuntimeId);
        }

        const response = await fetch(url.toString(), { cache: "no-store" });
        const payload = (await response.json()) as { logs?: AgentLog[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to refresh logs.");
        }

        const nextLogs = Array.isArray(payload.logs) ? payload.logs : [];
        liveLogCountRef.current = nextLogs.length;
        setLiveLogs(nextLogs);
      } catch (error) {
        console.error("[logs-live] refresh failed", error);
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    const channel = supabase
      .channel(LIVE_EVENTS_CHANNEL)
      .on("broadcast", { event: "agent_log_insert" }, (message) => {
        const payload = (message?.payload ?? {}) as Record<string, unknown>;
        const eventRuntimeId = canonicalRuntimeAgentId(
          typeof payload.runtime_agent_id === "string" ? payload.runtime_agent_id : "",
        );
        if (scopeRuntimeId && eventRuntimeId !== scopeRuntimeId) {
          return;
        }
        void reloadLogs();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [runtimeAgentId]);

  const normalizedLogs = useMemo(() => normalizeLogs(liveLogs), [liveLogs]);
  const filteredLogs = useMemo(
    () => normalizedLogs.filter((log) => matchFilter(log, activeFilter)),
    [activeFilter, normalizedLogs],
  );

  const infoCount = logTotals?.info ?? normalizedLogs.filter((log) => log.level === "info").length;
  const warningCount = logTotals?.warning ?? normalizedLogs.filter((log) => log.level === "warning").length;
  const errorCount = logTotals?.error ?? normalizedLogs.filter((log) => log.level === "error").length;
  const totalCount = logTotals?.total ?? normalizedLogs.length;

  function openLogDetails(log: NormalizedLog) {
    setSelectedLog(log);
    setModalOpen(true);
  }

  function deleteLog(log: NormalizedLog) {
    setPendingDeleteLog(log);
  }

  async function confirmDeleteLog() {
    if (!pendingDeleteLog) return;

    setDeletingLogId(pendingDeleteLog.id);
    try {
      const response = await fetch("/api/agent/logs", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ logId: pendingDeleteLog.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete log entry.");
      }

      toast.success("Log entry deleted");
      setPendingDeleteLog(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete log entry.");
    } finally {
      setDeletingLogId("");
    }
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total events</CardDescription>
            <CardTitle className="text-2xl">{totalCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Info</CardDescription>
            <CardTitle className="text-2xl text-blue-700 dark:text-blue-300">{infoCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Warnings</CardDescription>
            <CardTitle className="text-2xl text-amber-700 dark:text-amber-300">{warningCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Errors</CardDescription>
            <CardTitle className="text-2xl text-destructive">{errorCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>Agent Event Stream</CardTitle>
            <CardDescription>
              Filter by event class, inspect traces, and view sanitized full payloads.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={activeFilter === item.key ? "default" : "outline"}
                onClick={() => setActiveFilter(item.key)}
              >
                {item.label}
              </Button>
            ))}
            <Badge variant="outline" className="ml-auto">
              {filteredLogs.length} shown
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {filteredLogs.length === 0 ? (
            <Empty className="min-h-64 rounded-lg border">
              <EmptyHeader>
                <EmptyTitle>No logs for current filters</EmptyTitle>
                <EmptyDescription>Change filters or wait for new runtime activity.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Memory</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Preview</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => {
                    const rawAgentName = agentNameById[log.agentId] ?? log.agentId;
                    const isUuidId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(log.agentId);
                    const agentName =
                      rawAgentName === log.agentId && isUuidId
                        ? `Agent ${shortOpaqueId(log.agentId)}`
                        : rawAgentName;
                    const actorRaw =
                      log.eventType === "chat.user_in"
                        ? extractActorNameFromPayload(log.rawPayload)
                            .replace(/\s*\((call_[^)]+\|fc_[^)]+)\)\s*$/i, "")
                            .trim()
                        : "";
                    const actorName = actorRaw ? formatAgentName(actorRaw) : "";
                    const actorLabel = truncateWithTooltip(actorName || agentName, 34);
                    const viaLabel = truncateWithTooltip(agentName, 28);
                    const isUserEvent = log.eventType === "chat.user_in";
                    const showActor =
                      actorName && actorName.toLowerCase() !== agentName.toLowerCase();

                    return (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatTimestamp(log.occurredAt)}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            {isUserEvent && showActor ? (
                              <p className="text-sm font-medium" title={actorLabel.tooltip || undefined}>{actorLabel.display}</p>
                            ) : (
                              <Link
                                href={`/agents/${encodeURIComponent(log.agentId)}`}
                                prefetch={false}
                                className="text-sm text-primary hover:underline"
                                title={actorLabel.tooltip || undefined}
                              >
                                {actorLabel.display}
                              </Link>
                            )}
                            {isUserEvent && showActor ? (
                              <Link
                                href={`/agents/${encodeURIComponent(log.agentId)}`}
                                prefetch={false}
                                className="text-xs text-muted-foreground hover:underline"
                                title={viaLabel.tooltip || undefined}
                              >
                                via {viaLabel.display}
                              </Link>
                            ) : showActor ? (
                              <p className="text-xs text-muted-foreground" title={actorLabel.tooltip || undefined}>{actorLabel.display}</p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <AgentLogEventTypeBadge eventType={log.eventType} />
                        </TableCell>
                        <TableCell>
                          {log.direction ? <AgentLogDirectionBadge direction={log.direction} /> : null}
                        </TableCell>
                        <TableCell>
                          <AgentLogChannelBadge channel={log.channelType} />
                        </TableCell>
                        <TableCell>
                          {log.memorySource ? <AgentLogMemorySourceBadge memorySource={log.memorySource} /> : null}
                        </TableCell>
                        <TableCell>
                          <AgentLogLevelBadge level={log.level} />
                        </TableCell>
                        <TableCell className="max-w-[460px] whitespace-normal text-sm">
                          <p>{log.messagePreview}</p>
                          {log.sourceMessageId ? (
                            <p className="mt-1 text-xs text-muted-foreground font-mono">
                              ref: {shortOpaqueId(log.sourceMessageId)}
                            </p>
                          ) : null}
                          {log.isJson ? (
                            <Badge variant="outline" className="mt-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                              JSON
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => openLogDetails(log)}>
                              View Full
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => void deleteLog(log)}
                              disabled={deletingLogId === log.id}
                              aria-label="Delete log"
                              title="Delete log"
                            >
                              <Trash2Icon className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(pendingDeleteLog)}
        onOpenChange={(open) => {
          if (!open && !deletingLogId) {
            setPendingDeleteLog(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete log entry</DialogTitle>
            <DialogDescription>
              This will permanently delete this log entry from the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDeleteLog(null)}
              disabled={Boolean(deletingLogId)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDeleteLog()}
              disabled={Boolean(deletingLogId)}
            >
              {deletingLogId ? "Deleting..." : "Delete log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LogDetailsModal log={selectedLog} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
