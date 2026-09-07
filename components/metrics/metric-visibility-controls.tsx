"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { MetricDef } from "@/lib/metrics/definition";
import type { useMetricVisibility } from "@/hooks/use-metric-visibility";

type Props = {
  metrics: MetricDef[];
  visibility: ReturnType<typeof useMetricVisibility>;
  onChoosingChange: (choosing: boolean) => void;
};

export function MetricViewSwitch({ visibility }: Pick<Props, "visibility">) {
  const showAll = visibility.ready && visibility.mode === "all";
  return <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs">
    <span className={cn(showAll && "text-muted-foreground")}>Focus</span>
    <Switch aria-label="Show all metrics" checked={showAll} disabled={!visibility.ready} onCheckedChange={checked => visibility.setMode(checked ? "all" : "focused")} />
    <span className={cn(!showAll && "text-muted-foreground")}>Show all</span>
  </label>;
}

export function MetricVisibilityControls({ metrics, visibility, onChoosingChange }: Props) {
  const [search, setSearch] = useState("");
  const selectedCount = metrics.filter(metric => visibility.selectedIds.has(metric.id)).length;
  const options = metrics.filter(metric => `${metric.name} ${metric.category || "General"}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return <section id="metric-selection" aria-label="Choose focused metrics" className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Your focused view</h2><p className="mt-1 text-xs text-muted-foreground">Choose the metrics you check regularly. {selectedCount} selected, saved in this browser.</p></div>
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
  </section>;
}
