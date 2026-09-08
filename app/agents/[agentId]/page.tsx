import { notFound } from "next/navigation";
import { getAgentDetailsData, getSidebarUser } from "@/lib/db/server-data";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { AgentStatusBadge, formatAgentName } from "@/components/agents/agent-ui";
import { AgentDetailLogsClient } from "./agent-detail-logs-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActivityIcon, CpuIcon, ClockIcon, LayersIcon } from "lucide-react";
import { getSql } from "@/lib/local-db";
import { formatDistanceToNow } from "date-fns";
import type { AgentLog } from "@/types/agents";

export const dynamic = "force-dynamic";

type LogRow = {
  id: string;
  agent_id: string;
  runtime_agent_id: string | null;
  occurred_at: string;
  level: AgentLog["level"];
  type: AgentLog["type"];
  run_id: string | null;
  message: string | null;
  event_id: string | null;
  event_type: AgentLog["eventType"] | null;
  direction: AgentLog["direction"] | null;
  channel_type: AgentLog["channelType"] | null;
  session_key: string | null;
  source_message_id: string | null;
  correlation_id: string | null;
  status: string | null;
  retry_count: number | null;
  message_preview: string | null;
  is_json: boolean | null;
  contains_pii: boolean | null;
  memory_source: AgentLog["memorySource"] | null;
  memory_key: string | null;
  collection: string | null;
  query_text: string | null;
  result_count: number | null;
  raw_payload: unknown | null;
};

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const [sidebarUser, data] = await Promise.all([getSidebarUser(), getAgentDetailsData(agentId)]);
  const agent = data.agent;
  if (!agent || agent.id !== agentId) notFound();

  // Fetch agent-specific logs
  const sql = getSql();
  const limit = 50;
  const [{ count }] = await sql`select count(*)::int as count from agent_logs where runtime_agent_id = ${agentId}`;
  const rows = await sql<LogRow[]>`
    select
      l.id, l.agent_id, l.runtime_agent_id, l.occurred_at, l.level, l.type,
      l.run_id, l.message, l.event_id, l.event_type, l.direction, l.channel_type,
      l.session_key, l.source_message_id, l.correlation_id, l.status, l.retry_count,
      l.message_preview, l.is_json, l.contains_pii, l.memory_source, l.memory_key,
      l.collection, l.query_text, l.result_count, l.raw_payload
    from agent_logs l
    where l.runtime_agent_id = ${agentId}
    order by l.occurred_at desc
    limit ${limit}
  `;

  const agentLogs: AgentLog[] = rows.map((row) => ({
    id: row.id,
    agentId: row.runtime_agent_id || row.agent_id,
    occurredAt: row.occurred_at,
    level: row.level,
    type: row.type,
    runId: row.run_id || "",
    message: row.message || "",
    eventId: row.event_id || undefined,
    eventType: row.event_type || undefined,
    direction: row.direction || undefined,
    channelType: row.channel_type || undefined,
    sessionKey: row.session_key || undefined,
    sourceMessageId: row.source_message_id || undefined,
    correlationId: row.correlation_id || undefined,
    status: row.status || undefined,
    retryCount: row.retry_count ?? undefined,
    messagePreview: row.message_preview || undefined,
    isJson: row.is_json ?? undefined,
    containsPii: row.contains_pii ?? undefined,
    memorySource: row.memory_source || undefined,
    memoryKey: row.memory_key || undefined,
    collection: row.collection || undefined,
    queryText: row.query_text || undefined,
    resultCount: row.result_count ?? undefined,
    rawPayload: row.raw_payload ?? null,
  }));

  const pageInfo = {
    page: 1,
    limit,
    totalCount: count,
    pageCount: Math.max(1, Math.ceil(Number(count || 0) / limit)),
  };

  // Snapshot the server time for hydration-safe relative timestamps
  const initialNowIso = new Date().toISOString();

  // Agent status colors
  const statusGradient = agent.status === "running"
    ? "from-success/20 via-success/5 to-transparent"
    : agent.status === "degraded"
      ? "from-red-500/20 via-red-500/5 to-transparent"
      : "from-warning/15 via-warning/5 to-transparent";

  const statusRingColor = agent.status === "running"
    ? "ring-success/20"
    : agent.status === "degraded"
      ? "ring-red-500/20"
      : "ring-warning/20";

  return (
    <SidebarProvider style={{ "--header-height": "calc(var(--spacing) * 14)" } as React.CSSProperties}>
      <AppSidebar variant="inset" initialUser={sidebarUser} />
      <SidebarInset>
        <PageHeader page={`Agent: ${formatAgentName(agent.name)}`} />
        <div className="flex flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:gap-6 lg:px-8">
          {/* Agent hero card */}
          <Card className={`overflow-hidden ring-1 ${statusRingColor}`}>
            <div className={`h-2 w-full bg-gradient-to-r ${statusGradient}`} />
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-6 pt-5 pb-4">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="relative">
                  <div className="flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-elev-1">
                    <CpuIcon className="size-7" aria-hidden />
                  </div>
                  {agent.status === "running" && (
                    <span className="absolute -top-1 -right-1 flex size-4">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex rounded-full size-4 bg-success border-2 border-card" />
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-2xl tracking-tight">{formatAgentName(agent.name)}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary" className="font-mono text-2xs">{agent.id}</Badge>
                    <span className="text-border">•</span>
                    <span>{agent.runtime.model ?? "unknown model"}</span>
                  </div>
                </div>
              </div>
              <AgentStatusBadge status={agent.status} />
            </CardHeader>

            <CardContent className="px-6 pb-5">
              <AgentDebugOverlay agent={agent} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mt-4">
                <Card className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardDescription>Status</CardDescription>
                      <div className="size-8 rounded-lg bg-success-soft flex items-center justify-center">
                        <ActivityIcon className="size-4 text-success-fg" />
                      </div>
                    </div>
                    <CardTitle className="text-2xl">
                      <Badge
                        variant="outline"
                        className={
                          agent.status === "running"
                            ? "border-success/40 bg-success-soft text-success-fg"
                            : agent.status === "degraded"
                              ? "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300"
                              : "border-warning/40 bg-warning-soft text-warning-fg"
                        }
                      >
                        {agent.status}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardDescription>Model</CardDescription>
                      <div className="size-8 rounded-lg bg-info-soft flex items-center justify-center">
                        <CpuIcon className="size-4 text-info-fg" />
                      </div>
                    </div>
                    <CardTitle className="text-sm font-medium text-foreground/80 truncate">{agent.runtime.model ?? "unknown"}</CardTitle>
                  </CardHeader>
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardDescription>Last Heartbeat</CardDescription>
                      <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <ClockIcon className="size-4 text-primary" />
                      </div>
                    </div>
                    <CardTitle className="text-sm font-medium">
                      {agent.runtime.lastHeartbeatAt
                        ? formatDistanceToNow(new Date(agent.runtime.lastHeartbeatAt), { addSuffix: true })
                        : "unknown"}
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardDescription>Queue Depth</CardDescription>
                      <div className="size-8 rounded-lg bg-chart-5/10 flex items-center justify-center">
                        <LayersIcon className="size-4 text-chart-5" />
                      </div>
                    </div>
                    <CardTitle className="text-2xl text-chart-5">{agent.runtime.queueDepth ?? 0}</CardTitle>
                  </CardHeader>
                </Card>
              </div>
            </CardContent>
          </Card>

          {/* Agent-specific logs with live streaming */}
          <AgentDetailLogsClient
            agentId={agentId}
            initialLogs={agentLogs}
            initialPageInfo={pageInfo}
            initialNowIso={initialNowIso}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
