import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { DashboardIntro } from "@/components/dashboard/dashboard-intro";
import { DashboardTasksTable } from "@/components/dashboard/dashboard-tasks-table";
import { RefreshControl } from "@/components/dashboard/refresh-control";
import { StatStrip } from "@/components/dashboard/stat-strip";
import { ThroughputChart } from "@/components/dashboard/throughput-chart";
import { getDashboardPulse, type DashboardPulse } from "@/lib/db/dashboard-pulse";
import { getDashboardOverview } from "@/lib/db/server-data";
import { getSession } from "@/lib/auth/session";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { PageReveal } from "@/components/ui/page-reveal";

export const dynamic = "force-dynamic";

/** One honest sentence for the intro. Null when there is nothing to say. */
function summarize(pulse: DashboardPulse, ownOpen: number): string | null {
  const parts: string[] = [];
  if (pulse.tickets) {
    if (pulse.tickets.overdue > 0) parts.push(`${pulse.tickets.overdue} overdue`);
    if (pulse.tickets.dueToday > 0) parts.push(`${pulse.tickets.dueToday} due today`);
  }
  if (pulse.agenda && pulse.agenda.failed7d > 0) {
    parts.push(`${pulse.agenda.failed7d} failed ${pulse.agenda.failed7d === 1 ? "run" : "runs"} this week`);
  }
  if (pulse.services && pulse.services.error > 0) {
    parts.push(`${pulse.services.error} ${pulse.services.error === 1 ? "service" : "services"} reporting errors`);
  }
  if (parts.length > 0) return `Across the workspace: ${parts.join(", ")}.`;
  if (ownOpen > 0) return `${ownOpen} open ${ownOpen === 1 ? "ticket" : "tickets"} assigned to you. Nothing is overdue.`;
  return null;
}

export default async function DashboardPage() {
  const session = await getSession();
  const [overview, pulse] = await Promise.all([
    getDashboardOverview(session?.email ?? null),
    getDashboardPulse(),
  ]);
  const firstName = session?.name?.trim().split(/\s+/)[0] ?? null;

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 68)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageHeader page="Dashboard" actions={<RefreshControl loadedAt={pulse.loadedAt} />} />
        <div className="@container/main flex flex-1 flex-col">
          <PageReveal label="Loading dashboard…" className="page-x flex flex-col gap-(--section-gap) py-(--page-y)">
            <DashboardIntro name={firstName} summary={summarize(pulse, overview.totals.openTickets)} />

            <StatStrip pulse={pulse} series={overview.chart} />

            <div className="grid gap-(--section-gap) @4xl/main:grid-cols-[minmax(0,1fr)_minmax(18rem,21rem)]">
              <ThroughputChart data={overview.chart} />
              <AttentionPanel items={pulse.attention} now={pulse.loadedAt} />
            </div>

            <DashboardTasksTable tasks={overview.tasks} />
          </PageReveal>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
