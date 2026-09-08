import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton: the shell stays put and the content area sketches the
 * layout that is about to arrive, so nothing jumps when data lands.
 */
export default function DashboardLoading() {
  return (
    <SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 68)" } as React.CSSProperties}>
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageHeader page="Dashboard" />
        <div className="page-x flex flex-col gap-(--section-gap) py-(--page-y)" aria-busy="true" aria-label="Loading dashboard">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-64" />
          </div>

          <div className="surface-card grid grid-cols-2 divide-x divide-y divide-line overflow-hidden md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3 px-5 py-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>

          <div className="grid gap-(--section-gap) @4xl/main:grid-cols-[minmax(0,1fr)_minmax(18rem,21rem)]">
            <div className="surface-card flex flex-col gap-5 p-6">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-8 w-40" />
              </div>
              <Skeleton className="h-56 w-full" />
            </div>
            <div className="surface-card flex flex-col gap-4 p-6">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-48" />
              <div className="mt-2 flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-7 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="surface-card flex flex-col gap-4 p-6">
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
