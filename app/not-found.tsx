import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyFooter, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function NotFound() {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageHeader page="Page not found" />
        <div className="page-x flex flex-1 flex-col py-(--page-y)">
          <Empty className="mx-auto w-full max-w-xl border-line bg-surface-2/60">
            <EmptyHeader>
              <CompassIcon className="mx-auto mb-2 size-8 text-muted-foreground/50" aria-hidden />
              <EmptyTitle>Page not found</EmptyTitle>
              <EmptyDescription>This page may have moved or the item may have been deleted. The sidebar lists everything that exists.</EmptyDescription>
            </EmptyHeader>
            <EmptyFooter>
              <Button asChild size="sm"><Link href="/dashboard">Go to dashboard</Link></Button>
            </EmptyFooter>
          </Empty>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
