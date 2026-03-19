import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { EyeIcon } from "lucide-react";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { ClearLogsButton } from "@/components/agents/clear-logs-button";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { LogsExplorer } from "@/components/agents/logs-explorer";
import { LogsPagination } from "@/components/agents/logs-pagination";
import { LogsLiveRefresh } from "@/components/agents/logs-live-refresh";
import {
  AgentStatusBadge,
  formatAgentName,
  formatTimestamp,
} from "@/components/agents/agent-ui";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getAgentDetailsData, getSidebarUser } from "@/lib/db/server-data";

type Props = {
  params: Promise<{
    agentId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseLimit(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 200;
  return Math.min(500, Math.max(50, Math.trunc(parsed)));
}

function parsePage(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

function formatHeartbeatAge(value: number | null | undefined) {
  if (value == null) return "Unknown";
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr`;
}

function formatRuntimeCount(value: number | null | undefined) {
  return value == null ? "N/A" : String(value);
}

function formatUptimeMinutes(value: number | null | undefined) {
  if (value == null) return "N/A";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "N/A";
  return formatDistanceToNow(date, { addSuffix: true });
}

export default async function AgentDetailsPage({ params, searchParams }: Props) {
  const showAgentDebug = process.env.NEXT_PUBLIC_AGENT_DEBUG_OVERLAY === "true";
  const { agentId } = await params;
  const resolvedAgentId = decodeURIComponent(agentId);
  const query = await searchParams;
  const limit = parseLimit(firstValue(query.limit));
  const page = parsePage(firstValue(query.page));

  const [sidebarUser, { agent, logs: agentLogs, pageInfo, healthActivity, queueSummary }] = await Promise.all([
    getSidebarUser(),
    getAgentDetailsData(resolvedAgentId, { page, limit }),
  ]);
  if (!agent) notFound();
  const buildHref = (nextPage: number) => {
    const nextParams = new URLSearchParams();
    if (limit !== 200) {
      nextParams.set("limit", String(limit));
    }
    if (nextPage > 1) {
      nextParams.set("page", String(nextPage));
    }
    const encodedAgentId = encodeURIComponent(agent.id);
    return nextParams.size > 0 ? `/agents/${encodedAgentId}?${nextParams.toString()}` : `/agents/${encodedAgentId}`;
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        initialUser={
          sidebarUser
            ? {
                name: sidebarUser.name,
                email: sidebarUser.email,
                avatar: sidebarUser.avatarUrl,
              }
            : null
        }
      />
      <SidebarInset>
        <PageHeader
          page={formatAgentName(agent.name)}
          crumbs={[{ label: "Agents", href: "/agents" }]}
          actions={
            <div className="flex w-full items-center justify-between gap-2">
              <LogsLiveRefresh />
              <div className="flex items-center gap-2">
                <ClearLogsButton agentId={agent.id} />
              </div>
            </div>
          }
        />
        <div className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">{formatAgentName(agent.name)}</h1>
              {showAgentDebug ? <AgentDebugOverlay agent={agent} /> : null}
            </div>
            <AgentStatusBadge status={agent.status} />
          </div>

          <div className="grid gap-4 2xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Identity</CardTitle>
                <CardDescription>Loaded from each agent&apos;s IDENTITY.md</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{agent.identity?.name || formatAgentName(agent.name)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Role</span>
                  <span className="font-medium">{agent.identity?.role || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Emoji</span>
                  <span className="font-medium">{agent.identity?.emoji || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground">Soul</p>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="icon-sm" aria-label="View soul" title="View soul">
                        <EyeIcon className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>{agent.identity?.name || formatAgentName(agent.name)} — Soul</DialogTitle>
                        <DialogDescription>Loaded from SOUL.md</DialogDescription>
                      </DialogHeader>
                      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-foreground">
                        {agent.soul || "No SOUL.md detected"}
                      </pre>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Runtime</CardTitle>
                <CardDescription>Only fields we can verify from current data sources</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-medium">{agent.runtime.model && agent.runtime.model !== "unknown" ? agent.runtime.model : "Unavailable"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Heartbeat age</span>
                  <span className="font-medium tabular-nums">
                    {formatHeartbeatAge(agent.runtimeMeta?.heartbeatAgeSec)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Health, Activity & Skills</CardTitle>
                <CardDescription>Recent useful signals from runtime, logs, and loaded skills</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Uptime</span>
                  <span className="font-medium tabular-nums">{formatUptimeMinutes(agent.runtime.uptimeMinutes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last heartbeat</span>
                  <span className="text-muted-foreground text-xs">
                    {formatTimestamp(agent.runtime.lastHeartbeatAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last activity</span>
                  <span className="font-medium">{formatRelativeTime(healthActivity.lastActivityAt)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Responses (1h)</span>
                  <span className="font-medium tabular-nums">{formatRuntimeCount(healthActivity.responses1h)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Errors (1h)</span>
                  <span className="font-medium tabular-nums">{formatRuntimeCount(healthActivity.errors1h)}</span>
                </div>
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground">Active skills</p>
                  <p className="mt-1 text-sm">
                    {agent.activeSkills && agent.activeSkills.length > 0
                      ? agent.activeSkills.join(", ")
                      : "No active skills detected"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Task Queue</CardTitle>
                <CardDescription>Assigned and execution queue signals for this agent</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Assigned tickets</span>
                  <span className="font-medium tabular-nums">{formatRuntimeCount(queueSummary.assigned)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Queued</span>
                  <span className="font-medium tabular-nums">{formatRuntimeCount(queueSummary.queued)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Running</span>
                  <span className="font-medium tabular-nums">{formatRuntimeCount(queueSummary.running)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Blocked (schedule)</span>
                  <span className="font-medium tabular-nums">{formatRuntimeCount(queueSummary.blockedBySchedule)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Blocked (approval)</span>
                  <span className="font-medium tabular-nums">{formatRuntimeCount(queueSummary.blockedByApproval)}</span>
                </div>
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground">Next up queue</p>
                  {queueSummary.nextUp.length > 0 ? (
                    <ul className="mt-1 space-y-1 text-xs">
                      {queueSummary.nextUp.map((item) => (
                        <li key={item.id} className="truncate text-foreground">
                          {item.priority.toUpperCase()} · {item.title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">No queued tickets</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <LogsExplorer agents={[agent]} logs={agentLogs} runtimeAgentId={agent.id} />

          <LogsPagination
            buildHref={buildHref}
            page={pageInfo.page}
            pageCount={pageInfo.pageCount}
            shownCount={pageInfo.shownCount}
            totalCount={pageInfo.totalCount}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
