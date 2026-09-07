import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main id="main-content" className="mx-auto flex min-h-svh max-w-xl flex-col items-start justify-center gap-4 p-6">
    <h1 className="text-2xl font-semibold">Page not found</h1>
    <p className="text-muted-foreground">This page may have moved or the item may have been deleted.</p>
    <Button asChild><Link href="/dashboard">Go to dashboard</Link></Button>
  </main>;
}
