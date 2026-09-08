import { AppSidebar } from "@/components/layout/app-sidebar";
import { Suspense } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { MobileAppsClient } from "@/components/mobile-apps/mobile-apps-client";

export const dynamic = "force-dynamic";

export default function MobileAppsPage() {
  return (
    <SidebarProvider
      style={
        {
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset className="h-svh md:h-[calc(100svh-1rem)] overflow-hidden min-h-0">
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <Suspense fallback={null}>
            <MobileAppsClient />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
