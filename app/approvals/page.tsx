import Link from "next/link";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyFooter, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/** Plan approvals were retired with manual ticketing; the route stays so old links land somewhere useful. */
export default function ApprovalsPage() {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageHeader page="Approvals" />
        <div className="page-x flex flex-1 flex-col py-(--page-y)">
          <Empty className="mx-auto w-full max-w-xl border-line bg-surface-2/60">
            <EmptyHeader>
              <EmptyTitle>Approvals are no longer used</EmptyTitle>
              <EmptyDescription>Boards run in manual ticketing mode, so there is nothing to approve here. Work happens on the boards.</EmptyDescription>
            </EmptyHeader>
            <EmptyFooter>
              <Button asChild size="sm"><Link href="/boards">Open boards</Link></Button>
            </EmptyFooter>
          </Empty>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
