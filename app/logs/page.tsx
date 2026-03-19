import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { ClearLogsButton } from "@/components/agents/clear-logs-button";
import { LogsExplorer } from "@/components/agents/logs-explorer";
import { LogsPagination } from "@/components/agents/logs-pagination";
import { LogsLiveRefresh } from "@/components/agents/logs-live-refresh";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getAgentsAndLogsData, getSidebarUser } from "@/lib/db/server-data";

type PageProps = {
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

export default async function LogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const limit = parseLimit(firstValue(params.limit));
  const page = parsePage(firstValue(params.page));

  const [sidebarUser, { agents, logs, pageInfo, logTotals }] = await Promise.all([
    getSidebarUser(),
    getAgentsAndLogsData({ page, limit }),
  ]);
  const buildHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (limit !== 200) {
      query.set("limit", String(limit));
    }
    if (nextPage > 1) {
      query.set("page", String(nextPage));
    }
    return query.size > 0 ? `/logs?${query.toString()}` : "/logs";
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
          page="Logs"
          actions={
            <div className="flex w-full items-center justify-between gap-2">
              <LogsLiveRefresh />
              <div className="flex items-center gap-2">
                <ClearLogsButton />
              </div>
            </div>
          }
        />
        <div className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
          <LogsExplorer agents={agents} logs={logs} logTotals={logTotals} />
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
