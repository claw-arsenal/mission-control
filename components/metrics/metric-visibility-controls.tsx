"use client";

import { useState } from "react";
import { CheckIcon, ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MetricDef } from "@/lib/metrics/definition";
import type { useMetricVisibility } from "@/hooks/use-metric-visibility";

type Props = {
  metrics: MetricDef[];
  visibility: ReturnType<typeof useMetricVisibility>;
  choosing: boolean;
  onChoosingChange: (choosing: boolean) => void;
};

export function MetricVisibilityControls({ metrics, visibility, choosing, onChoosingChange }: Props) {
  const [search, setSearch] = useState("");
  const selectedCount = metrics.filter(metric => visibility.selectedIds.has(metric.id)).length;
  const options = metrics.filter(metric => `${metric.name} ${metric.category || "General"}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return <section aria-label="Dashboard metrics" className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Metrics view" className="flex rounded-lg border p-1">
        <Button size="sm" variant={visibility.mode === "focused" ? "secondary" : "ghost"} aria-pressed={visibility.mode === "focused"} onClick={() => visibility.setMode("focused")}>
          {visibility.mode === "focused" && <CheckIcon className="size-3.5" />} Focused view
        </Button>
        <Button size="sm" variant={visibility.mode === "all" ? "secondary" : "ghost"} aria-pressed={visibility.mode === "all"} onClick={() => visibility.setMode("all")}>
          {visibility.mode === "all" && <CheckIcon className="size-3.5" />} Show all
        </Button>
      </div>
      <Button size="sm" variant="outline" aria-expanded={choosing} aria-controls="metric-selection" onClick={() => onChoosingChange(!choosing)}>
        <SlidersHorizontalIcon className="size-4" /> Choose metrics <ChevronDownIcon className={`size-3.5 transition-transform ${choosing ? "rotate-180" : ""}`} />
      </Button>
      <p className="text-xs text-muted-foreground">{visibility.mode === "focused" ? `${selectedCount} of ${metrics.length} in your focused view` : `All ${metrics.length} metrics`} · Saved in this browser</p>
    </div>
    {choosing && <div id="metric-selection" className="rounded-lg border bg-muted/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Your focused view</h2><p className="mt-1 text-xs text-muted-foreground">Choose what you check regularly. The first six are selected to get you started.</p></div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => visibility.select(metrics.map(metric => metric.id))}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={() => visibility.select([])}>Clear selection</Button>
          <Button size="sm" variant="outline" onClick={() => onChoosingChange(false)}>Done</Button>
        </div>
      </div>
      <Input aria-label="Find metrics to include" placeholder="Find metrics to include…" value={search} onChange={event => setSearch(event.target.value)} className="mt-3 max-w-sm" />
      <fieldset className="mt-3 grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
        <legend className="sr-only">Metrics included in your focused view</legend>
        {options.map(metric => <label key={metric.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
          <input type="checkbox" aria-label={metric.name} checked={visibility.selectedIds.has(metric.id)} onChange={() => visibility.toggle(metric.id)} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{metric.name}</span><span className="block text-xs text-muted-foreground">{metric.category || "General"}</span></span>
        </label>)}
      </fieldset>
      {!options.length && <p className="py-4 text-sm text-muted-foreground">No metric names or categories match “{search}”.</p>}
    </div>}
  </section>;
}
