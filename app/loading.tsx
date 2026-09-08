import { Spinner } from "@/components/ui/spinner";

/** Cold-navigation fallback. Routes with a layout to mirror ship their own skeleton instead. */
export default function GlobalLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
