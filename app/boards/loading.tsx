import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/** Route-level skeleton: the shell stays put and the board sketches its lists. */
export default function BoardsLoading() {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageHeader page="Boards" />
        <div className="page-x flex items-center gap-3 border-b border-line py-2">
          <Skeleton className="h-8 w-full max-w-sm" />
        </div>
        <div className="page-x flex min-h-0 flex-1 gap-3 overflow-hidden py-(--page-y)" aria-busy="true" aria-label="Loading boards">
          {Array.from({ length: 4 }).map((_, list) => (
            <div key={list} className="flex w-[280px] shrink-0 flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-2.5">
              <div className="flex items-center gap-2 pb-1">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-4 w-6 rounded-full" />
              </div>
              {Array.from({ length: 3 - (list % 2) }).map((_, card) => (
                <Skeleton key={card} className="h-24 rounded-xl bg-surface-1" />
              ))}
            </div>
          ))}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
