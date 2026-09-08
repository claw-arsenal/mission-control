"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRightIcon, ActivityIcon, ClipboardListIcon, CodeIcon, CpuIcon, BrainCircuitIcon, FlaskConicalIcon, PenLineIcon, SearchIcon, ZapIcon, type LucideIcon } from "lucide-react";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { AgentStatusBadge, formatAgentName } from "@/components/agents/agent-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ContainerLoader } from "@/components/ui/container-loader";
import type { Agent } from "@/types/agents";

type AgentEntry = {
  id: string;
  name: string;
  status: "running" | "idle" | "degraded";
  model: string | null;
  queueDepth: number | null;
  lastHeartbeatAt: string | null;
  isDefault?: boolean;
};

// ── Agent emoji/icon mapping ─────────────────────────────────────────────────

/** A glyph per agent role. Icons render identically on every platform, unlike emoji. */
const AGENT_ICONS: Array<[string, LucideIcon]> = [
  ["main", CpuIcon],
  ["planner", ClipboardListIcon],
  ["developer", CodeIcon],
  ["writer", PenLineIcon],
  ["researcher", SearchIcon],
  ["test", FlaskConicalIcon],
];

function getAgentIcon(name: string, id: string): LucideIcon {
  const lower = (name || id || "").toLowerCase();
  for (const [key, Icon] of AGENT_ICONS) {
    if (lower.includes(key)) return Icon;
  }
  return ZapIcon;
}

// ── Status gradient mapping ──────────────────────────────────────────────────

const STATUS_GRADIENTS: Record<string, string> = {
  running: "from-success/15 via-success/5 to-transparent",
  idle: "from-primary/8 via-primary/2 to-transparent",
  degraded: "from-danger/15 via-danger/5 to-transparent",
};

const STATUS_GLOW: Record<string, string> = {
  running: "shadow-elev-1",
  idle: "",
  degraded: "shadow-elev-1",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveAgentCardStatus(
  status: "running" | "idle" | "degraded",
  lastActivityAt: string | null,
  referenceTs: number | null,
): "running" | "idle" | "degraded" {
  if (status !== "idle") return status;
  if (!lastActivityAt || referenceTs == null) return status;
  const lastActivityTs = new Date(lastActivityAt).valueOf();
  return Number.isFinite(lastActivityTs) && referenceTs - lastActivityTs <= 2 * 60 * 1000
    ? "running"
    : status;
}

function toDebugAgent(agent: AgentEntry): Agent {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    runtime: {
      model: agent.model,
      queueDepth: agent.queueDepth ?? null,
      activeRuns: null,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      uptimeMinutes: null,
    },
  };
}

// ── Loading state ────────────────────────────────────────────────────────────

function AgentsPageSkeleton(): React.ReactElement {
  return (
    <div className="relative min-h-[400px]">
      <ContainerLoader label="Loading agents…" />
    </div>
  );
}

// ── Stat card configs ────────────────────────────────────────────────────────

const STAT_CONFIGS = [
  { label: "Total agents", color: "text-primary", bg: "bg-primary/10", icon: CpuIcon },
  { label: "Running", color: "text-success-fg", bg: "bg-success-soft", icon: ActivityIcon },
  { label: "Responses (1h)", color: "text-info-fg", bg: "bg-info-soft", icon: ZapIcon },
  { label: "Memory ops (1h)", color: "text-muted-foreground", bg: "bg-surface-2", icon: BrainCircuitIcon },
] as const;

// ── Main grid ────────────────────────────────────────────────────────────────

function AgentsClientGrid({ showAgentDebug }: { showAgentDebug: boolean }): React.ReactElement | null {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents", { cache: "no-cache" });
      if (!res.ok) throw new Error(`The agent list request failed (${res.status}).`);
      const json = await res.json();
      setAgents(json.agents ?? []);
      setError(null);
    } catch (err) {
      // A failed request must not read as "no agents online".
      setError(err instanceof Error ? err.message : "The agent list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void loadAgents();
  }, [loadAgents]);

  if (!mounted) return null;
  if (loading && agents.length === 0) return <AgentsPageSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Agents could not be loaded</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <AlertActions>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void loadAgents()}>
            {loading ? <Spinner className="size-3" /> : null}
            Try again
          </Button>
        </AlertActions>
      </Alert>
    );
  }

  if (agents.length === 0) {
    return (
      <Empty className="min-h-72 border-line bg-surface-2/60">
        <EmptyHeader>
          <CpuIcon className="mx-auto mb-2 size-8 text-muted-foreground/50" aria-hidden />
          <EmptyTitle>No agents online</EmptyTitle>
          <EmptyDescription>
            Agents appear here once they connect. Start an agent to see it listed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const referenceTs = Date.now();
  const runningCount = agents.filter(
    (a) => resolveAgentCardStatus(a.status, a.lastHeartbeatAt, Date.now()) === "running",
  ).length;

  // Response and memory counters are not collected yet; the tiles say so rather
  // than showing a number that would be invented.
  const statValues = [agents.length, runningCount, "Not tracked", "Not tracked"];

  return (
    <>
      {/* Stat cards with individual colors */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STAT_CONFIGS.map((cfg, i) => {
          const Icon = cfg.icon;
          return (
            <Card key={cfg.label} className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{cfg.label}</CardDescription>
                  <div className={`size-8 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                    <Icon className={`size-4 ${cfg.color}`} />
                  </div>
                </div>
                <CardTitle className={`text-2xl ${cfg.color}`}>
                  {statValues[i]}
                </CardTitle>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      {/* Agent cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((agent) => {
          const cardStatus = resolveAgentCardStatus(agent.status, agent.lastHeartbeatAt, referenceTs);
          const gradient = STATUS_GRADIENTS[cardStatus] ?? STATUS_GRADIENTS.idle;
          const glow = STATUS_GLOW[cardStatus] ?? "";
          const AgentIcon = getAgentIcon(agent.name, agent.id);
          const isRunning = cardStatus === "running";

          return (
            <Link key={agent.id} href={`/agents/${encodeURIComponent(agent.id)}`} className="block group">
              <Card className={`h-full overflow-hidden border transition-[transform,box-shadow,border-color] duration-(--dur-base) ease-(--ease-out) hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elev-2 ${glow}`}>
                {/* Gradient accent bar */}
                <div className={`h-1.5 w-full bg-gradient-to-r ${gradient}`} />

                <CardHeader className="gap-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Agent avatar */}
                      <div className="relative">
                        <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                          <AgentIcon className="size-5" aria-hidden />
                        </div>
                        {/* Pulse indicator for running agents */}
                        {isRunning && (
                          <span className="absolute -top-0.5 -right-0.5 flex size-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                            <span className="relative inline-flex rounded-full size-3 bg-success" />
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <CardTitle className="text-base group-hover:text-primary transition-colors">
                          {formatAgentName(agent.name)}
                        </CardTitle>
                        {showAgentDebug ? <AgentDebugOverlay agent={toDebugAgent(agent)} /> : null}
                      </div>
                    </div>
                    <AgentStatusBadge status={cardStatus} />
                  </div>
                </CardHeader>

                <CardContent className="grid gap-3 text-sm pt-0">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Model</span>
                    <span className="text-sm text-foreground/80 truncate max-w-[320px]">{agent.model ?? "unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last heartbeat</span>
                    <span className="text-sm">
                      {agent.lastHeartbeatAt
                        ? formatDistanceToNow(new Date(agent.lastHeartbeatAt), { addSuffix: true })
                        : "unknown"}
                    </span>
                  </div>
                  {agent.isDefault && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Role</span>
                      <Badge variant="outline" className="text-2xs">Default agent</Badge>
                    </div>
                  )}

                  <div className="pt-3 flex items-end justify-end text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-sm font-medium">View details</span>
                    <ArrowRightIcon className="ml-1.5 size-4" />
                  </div>
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
