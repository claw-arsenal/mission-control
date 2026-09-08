"use client";

import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/** A page failed to render. The shell stays so the reader can navigate away. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageHeader page="Something went wrong" />
        <div className="page-x flex flex-1 flex-col py-(--page-y)">
          <Alert variant="destructive" className="mx-auto w-full max-w-xl">
            <AlertTriangleIcon />
            <AlertTitle>This page could not load</AlertTitle>
            <AlertDescription>
              <p>Try loading it again. If the problem continues, return to the dashboard and check System for service status.</p>
              {error.digest ? <p className="font-mono text-xs opacity-80">Reference {error.digest}</p> : null}
            </AlertDescription>
            <AlertActions>
              <Button size="sm" onClick={reset}>Try again</Button>
              <Button size="sm" variant="outline" asChild><Link href="/dashboard">Go to dashboard</Link></Button>
            </AlertActions>
          </Alert>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
