"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRightIcon } from "lucide-react";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { AgentStatusBadge, formatAgentName } from "@/components/agents/agent-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

type AgentEntry = {
  id: string;
  name: string;
  status: "running" | "idle" | "degraded";
  model: string | null;
  queueDepth: number | null;
  lastHeartbeatAt: string | null;
};

function resolveAgentCardStatus(
  status: "running" | "idle" | "degraded",
  lastActivityAt: string | null,
  referenceTs: number | null,
) {
  if (status !== "idle") return status;
  if (!lastActivityAt || referenceTs == null) return status;
  const lastActivityTs = new Date(lastActivityAt).valueOf();
  return Number.isFinite(lastActivityTs) && referenceTs - lastActivityTs <= 2 * 60 * 1000
    ? "running"
    : status;
}

function AgentsPageSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total agents</CardDescription><CardTitle className="text-2xl">—</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Running</CardDescription><CardTitle className="text-2xl text-emerald-700 dark:text-emerald-300">—</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Responses (1h)</CardDescription><CardTitle className="text-2xl text-blue-700 dark:text-blue-300">—</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Memory ops (1h)</CardDescription><CardTitle className="text-2xl text-fuchsia-700 dark:text-fuchsia-300">—</CardTitle></CardHeader></Card>
      </div>
      <p className="text-sm text-muted-foreground">Loading agents…</p>
    </>
  );
}

function AgentsClientGrid({ showAgentDebug }: { showAgentDebug: boolean }) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        let raw: any[] = [];
        try {
          const { stdout } = await execFileAsync(
            "openclaw",
            ["sessions", "--all-agents", "--json"],
            { timeout: 8000 },
          );
          raw = JSON.parse(stdout);
        } catch {
          // no runtime data available
        }
        if (cancelled) return;

        const entries: AgentEntry[] = raw
          .filter((s: any) => s?.agentId)
          .map((s: any) => ({
            id: s.agentId,
            name: s.identity?.name || s.name || s.agentId,
            status: s.status === "running" || s.status === "degraded" ? s.status : "idle",
            model: s.model ?? null,
            queueDepth: s.queueDepth ?? null,
            lastHeartbeatAt: s.lastHeartbeatAt ?? null,
          }));

        setAgents(entries);
      } catch (err) {
        console.error("Failed to load agents", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading agents…</p>;

  if (agents.length === 0) {
    return (
      <Empty className="min-h-72">
        <EmptyHeader>
          <EmptyTitle>No agents yet</EmptyTitle>
          <EmptyDescription>Create or connect agents to see them here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const referenceTs = Date.now();
  const runningCount = agents.filter(
    (a) => resolveAgentCardStatus(a.status, a.lastHeartbeatAt, referenceTs) === "running",
  ).length;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total agents</CardDescription><CardTitle className="text-2xl">{agents.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Running</CardDescription><CardTitle className="text-2xl text-emerald-700 dark:text-emerald-300">{runningCount}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Responses (1h)</CardDescription><CardTitle className="text-2xl text-blue-700 dark:text-blue-300">—</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Memory ops (1h)</CardDescription><CardTitle className="text-2xl text-fuchsia-700 dark:text-emerald-300">—</CardTitle></CardHeader></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((agent) => {
          const cardStatus = resolveAgentCardStatus(agent.status, agent.lastHeartbeatAt, referenceTs);
          return (
            <Link key={agent.id} href={`/agents/${encodeURIComponent(agent.id)}`} className="block">
              <Card className="h-full border transition-transform hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40">
                <CardHeader className="gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <CardTitle className="text-base">{formatAgentName(agent.name)}</CardTitle>
                      {showAgentDebug ? <AgentDebugOverlay agent={agent as any} /> : null}
                    </div>
                    <AgentStatusBadge status={cardStatus} />
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Model</span><span>{agent.model ?? "unknown"}</span></div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last heartbeat</span>
                    <span>{agent.lastHeartbeatAt ? formatDistanceToNow(new Date(agent.lastHeartbeatAt), { addSuffix: true }) : "unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Queue depth</span><span>{agent.queueDepth ?? "unknown"}</span></div>
                  <div className="flex items-center justify-end text-primary"><span>Open</span><ArrowRightIcon className="ml-1 size-4" /></div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export { AgentsClientGrid, AgentsPageSkeleton };
