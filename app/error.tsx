"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main-content" className="mx-auto flex min-h-svh max-w-xl flex-col items-start justify-center gap-4 p-6">
    <div role="alert">
      <h1 className="text-2xl font-semibold">This page could not load</h1>
      <p className="mt-2 text-muted-foreground">Try loading it again. If the problem continues, return to the dashboard and check System for service status.</p>
    </div>
    <div className="flex flex-wrap gap-3">
      <Button onClick={reset}>Try again</Button>
      <Button variant="outline" asChild><Link href="/dashboard">Go to dashboard</Link></Button>
    </div>
  </main>;
}
