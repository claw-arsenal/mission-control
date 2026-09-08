import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  AgentLogChannelType,
  AgentLogDirection,
  AgentLogEventType,
  AgentLogLevel,
  AgentLogMemorySource,
  AgentLogType,
  AgentStatus,
} from "@/types/agents";

/**
 * One status vocabulary for every agent badge. Severity uses the status tokens;
 * identity (log type, channel, direction) uses the chart hues, which are the
 * palette reserved for telling categories apart.
 */
const statusClass: Record<AgentStatus, string> = {
  running: "border-success/40 bg-success-soft text-success-fg",
  idle: "border-warning/40 bg-warning-soft text-warning-fg",
  degraded: "border-danger/40 bg-danger-soft text-danger-fg",
};

const levelClass: Record<AgentLogLevel, string> = {
  info: "border-info/40 bg-info-soft text-info-fg",
  debug: "border-line-strong bg-surface-2 text-muted-foreground",
  warning: "border-warning/40 bg-warning-soft text-warning-fg",
  error: "",
};

const levelVariant: Record<AgentLogLevel, "outline" | "destructive"> = {
  info: "outline",
  debug: "outline",
  warning: "outline",
  error: "destructive",
};

const typeClass: Record<AgentLogType, string> = {
  workflow: "border-chart-2/30 bg-chart-2/10 text-chart-2",
  tool: "border-chart-3/30 bg-chart-3/10 text-chart-3",
  memory: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  system: "border-line-strong bg-surface-2 text-muted-foreground",
  worker: "border-chart-1/30 bg-chart-1/10 text-chart-1",
  cron: "border-chart-5/30 bg-chart-5/10 text-chart-5",
};

const eventTypeClass: Record<AgentLogEventType, string> = {
  "chat.user_in": "border-chart-1/30 bg-chart-1/10 text-chart-1",
  "chat.assistant_out": "border-chart-3/30 bg-chart-3/10 text-chart-3",
  "chat.reaction": "border-chart-5/30 bg-chart-5/10 text-chart-5",
  "tool.start": "border-chart-3/30 bg-chart-3/10 text-chart-3",
  "tool.success": "border-success/30 bg-success-soft text-success-fg",
  "tool.error": "border-danger/30 bg-danger-soft text-danger-fg",
  "system.startup": "border-chart-2/30 bg-chart-2/10 text-chart-2",
  "system.shutdown": "border-line-strong bg-surface-2 text-muted-foreground",
  "system.error": "border-danger/30 bg-danger-soft text-danger-fg",
  "system.warning": "border-warning/30 bg-warning-soft text-warning-fg",
  "heartbeat.tick": "border-line-strong bg-surface-2 text-muted-foreground",
  "heartbeat.status_change": "border-chart-1/30 bg-chart-1/10 text-chart-1",
  "memory.read": "border-chart-2/30 bg-chart-2/10 text-chart-2",
  "memory.write": "border-chart-4/30 bg-chart-4/10 text-chart-4",
  "memory.search": "border-chart-5/30 bg-chart-5/10 text-chart-5",
  "memory.upsert": "border-chart-4/30 bg-chart-4/10 text-chart-4",
  "memory.error": "border-danger/30 bg-danger-soft text-danger-fg",
};

const channelTypeClass: Record<AgentLogChannelType, string> = {
  internal: "border-line-strong bg-surface-2 text-muted-foreground",
  telegram: "border-chart-2/30 bg-chart-2/10 text-chart-2",
  gateway: "border-chart-3/30 bg-chart-3/10 text-chart-3",
  qdrant: "border-chart-5/30 bg-chart-5/10 text-chart-5",
};

const directionClass: Record<AgentLogDirection, string> = {
  inbound: "border-chart-2/30 bg-chart-2/10 text-chart-2",
  outbound: "border-chart-3/30 bg-chart-3/10 text-chart-3",
  internal: "border-line-strong bg-surface-2 text-muted-foreground",
};

const memorySourceClass: Record<Exclude<AgentLogMemorySource, "">, string> = {
  session: "border-chart-2/30 bg-chart-2/10 text-chart-2",
  daily_file: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  long_term_file: "border-chart-1/30 bg-chart-1/10 text-chart-1",
  episodic_file: "border-chart-5/30 bg-chart-5/10 text-chart-5",
  qdrant_vector: "border-chart-3/30 bg-chart-3/10 text-chart-3",
};

const levelLabel: Record<AgentLogLevel, string> = {
  info: "Info",
  debug: "Debug",
  warning: "Warning",
  error: "Error",
};

const typeLabel: Record<AgentLogType, string> = {
  workflow: "Workflow",
  tool: "Tool",
  memory: "Memory",
  system: "System",
  worker: "Worker",
  cron: "Cron",
};

const eventTypeLabel: Record<AgentLogEventType, string> = {
  "chat.user_in": "User Message",
  "chat.assistant_out": "Assistant Reply",
  "chat.reaction": "Chat Reaction",
  "tool.start": "Tool Start",
  "tool.success": "Tool Success",
  "tool.error": "Tool Failure",
  "system.startup": "System Startup",
  "system.shutdown": "System Shutdown",
  "system.error": "System Error",
  "system.warning": "System Warning",
  "heartbeat.tick": "Heartbeat Tick",
  "heartbeat.status_change": "Heartbeat State",
  "memory.read": "Memory Read",
  "memory.write": "Memory Write",
  "memory.search": "Memory Search",
  "memory.upsert": "Memory Upsert",
  "memory.error": "Memory Error",
};

const channelLabel: Record<AgentLogChannelType, string> = {
  internal: "Internal",
  telegram: "Telegram",
  gateway: "Gateway",
  qdrant: "Memory",
};

const directionLabel: Record<AgentLogDirection, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  internal: "Internal",
};

const memorySourceLabel: Record<Exclude<AgentLogMemorySource, "">, string> = {
  session: "Session",
  daily_file: "Daily File",
  long_term_file: "Long-term File",
  episodic_file: "Episodic File",
  qdrant_vector: "Vector Memory",
};

const memorySourceHelpText: Record<Exclude<AgentLogMemorySource, "">, string> = {
  session: "In-session context only (not persisted as long-term memory).",
  daily_file: "Persisted in workspace daily memory markdown files under ~/.openclaw/workspace/memory/*.md.",
  long_term_file: "Persisted in long-term markdown memory files (MEMORY.md / shared memory docs).",
  episodic_file: "Persisted in episodic memory files under ~/.openclaw/workspace/memory/episodes/.",
  qdrant_vector: "Persisted in vector memory store for semantic retrieval.",
};

const statusHelpText: Record<AgentStatus, string> = {
  running: "Running: agent heartbeat is recent and runtime is active.",
  idle: "Idle: agent is healthy but no recent activity is detected.",
  degraded: "Degraded: heartbeat is stale or runtime signals are partially unavailable.",
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("cursor-help capitalize", statusClass[status])}>
            {status}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {statusHelpText[status]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AgentLogLevelBadge({ level }: { level: AgentLogLevel }) {
  return (
    <Badge
      variant={levelVariant[level]}
      className={cn(levelClass[level])}
    >
      {levelLabel[level]}
    </Badge>
  );
}

export function AgentLogTypeBadge({ type }: { type: AgentLogType }) {
  return (
    <Badge variant="outline" className={cn(typeClass[type])}>
      {typeLabel[type]}
    </Badge>
  );
}

export function AgentLogEventTypeBadge({ eventType }: { eventType: AgentLogEventType }) {
  return (
    <Badge variant="outline" className={cn(eventTypeClass[eventType])}>
      {eventTypeLabel[eventType]}
    </Badge>
  );
}

export function AgentLogChannelBadge({ channel }: { channel: AgentLogChannelType }) {
  return (
    <Badge variant="outline" className={cn(channelTypeClass[channel])}>
      {channelLabel[channel]}
    </Badge>
  );
}

export function AgentLogDirectionBadge({ direction }: { direction: AgentLogDirection }) {
  return (
    <Badge variant="outline" className={cn(directionClass[direction])}>
      {directionLabel[direction]}
    </Badge>
  );
}

export function AgentLogMemorySourceBadge({ memorySource }: { memorySource: Exclude<AgentLogMemorySource, ""> }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("cursor-help", memorySourceClass[memorySource])}>
            {memorySourceLabel[memorySource]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6} className="max-w-xs text-xs">
          {memorySourceHelpText[memorySource]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const genericBotNamePattern = /^(openclaw|dashboard)\s+bot(?:\s+(.+))?$/i;

export function formatAgentName(value: string) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw) return "Agent";

  const match = raw.match(genericBotNamePattern);
  if (!match) return raw;

  const suffix = (match[2] || "").trim();
  return suffix || "Bot";
}

const AMSTERDAM_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return AMSTERDAM_FORMATTER.format(date).replace(/\u202f/g, " ").replace(" at ", ", ");
}
