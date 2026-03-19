import { AppSidebar } from "@/components/layout/app-sidebar"
import { ChartAreaInteractive } from "@/components/dashboard/chart-area-interactive"
import { DataTable } from "@/components/dashboard/data-table"
import { SectionCards } from "@/components/dashboard/section-cards"
import { ActivityLogs } from "@/components/dashboard/activity-logs"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SetupModal } from "@/components/dashboard/setup-modal"
import { getDashboardData, getSidebarUser, getSetupStatus } from "@/lib/db/server-data"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

export default async function DashboardPage() {
  const [sidebarUser, { boardId, board, tickets, activityLogs, chartData, logs24h }, setupCompleted] = await Promise.all([
    getSidebarUser(),
    getDashboardData(),
    getSetupStatus(),
  ])

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
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <SectionCards board={board} logs24h={logs24h} />
              <div className="px-4 lg:px-6">
                <ChartAreaInteractive data={chartData} />
              </div>
              <div className="px-4 lg:px-6">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div className="min-w-0 h-full">
                    <DataTable data={tickets} boardId={boardId} />
                  </div>
                  <div className="min-w-0 h-full">
                    <ActivityLogs logs={activityLogs} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <SetupModal initialSetupCompleted={setupCompleted} />
      </SidebarInset>
    </SidebarProvider>
  )
}
