"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PlusIcon, RefreshCwIcon, DownloadIcon, UploadIcon, BookOpenIcon, SearchIcon, SlidersHorizontalIcon, MoreHorizontalIcon, InfoIcon, XIcon } from "lucide-react";
import { useModules } from "@/components/modules/modules-provider";
import { MetricCard, METRIC_WINDOWS, type MetricCardSettings } from "./metric-card";
import { MetricViewSwitch, MetricVisibilityControls } from "./metric-visibility-controls";
import { useMetricVisibility } from "@/hooks/use-metric-visibility";
import { MetricEditorModal, type MetricFormData } from "./metric-editor-modal";
import { PageHeader } from "@/components/layout/page-header";
import { describeWindow, type WindowName } from "@/lib/metrics/window";
import { exportMetric, parseMetricImport, matchImport, type MetricDef, type MetricDefinition } from "@/lib/metrics/definition";
import { downloadMetricFile } from "@/lib/metrics/presentation";

type Health = { ok: boolean; error?: string | null; database?: string | null; isReadOnlyUser?: boolean | null; dataAsOf?: string | null };
async function mutation(body: Record<string, unknown>) {
  const response = await fetch("/api/metrics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(json.error || "The change could not be saved. Try again.");
  return json;
}

export function MetricsClient() {
  const router = useRouter();
  const { ready, isEnabled } = useModules();
  const [metrics, setMetrics] = useState<MetricDef[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [globalWindow, setGlobalWindow] = useState<WindowName | "saved">("saved");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [guide, setGuide] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [cardSettings, setCardSettings] = useState<Record<string, MetricCardSettings>>({});
  const [choosingMetrics, setChoosingMetrics] = useState(false);
  const visibility = useMetricVisibility(metrics);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MetricFormData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MetricDef | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; entries: MetricDefinition[] } | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const loadController = useRef<AbortController | null>(null);

  useEffect(() => { if (ready && !isEnabled("metrics")) router.replace("/settings#modules"); }, [ready, isEnabled, router]);
  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    setLoading(true);
    setError(null);
    await Promise.all([
      (async () => {
        try {
          const response = await fetch("/api/metrics", { cache: "no-store", signal });
          const json = await response.json();
          if (!response.ok || !json.ok || !Array.isArray(json.metrics)) throw new Error(json.error || "Metric definitions could not load.");
          if (!controller.signal.aborted) setMetrics(json.metrics);
        } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load metrics."); }
      })(),
      (async () => {
        try {
          const response = await fetch("/api/metrics/health", { cache: "no-store", signal });
          const json = await response.json();
          if (!controller.signal.aborted) setHealth(previous => response.ok && json.ok ? json : { ...previous, ok: false, error: json.error || "The connection check failed." });
        } catch { if (!controller.signal.aborted) setHealth(previous => ({ ...previous, ok: false, error: "The connection check timed out or could not reach the server." })); }
      })(),
    ]);
    if (!controller.signal.aborted) setLoading(false);
  }, []);
  useEffect(() => { void load(); return () => loadController.current?.abort(); }, [load]);

  const categories = useMemo(() => [...new Set((metrics ?? []).map(metric => metric.category || "General"))].sort(), [metrics]);
  const focused = (metrics ?? []).filter(metric => visibility.mode === "all" || visibility.selectedIds.has(metric.id));
  const matching = (metrics ?? []).filter(metric => (category === "All categories" || (metric.category || "General") === category) && [metric.name, metric.description, metric.notes, metric.category].filter(Boolean).join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const visible = matching.filter(metric => visibility.mode === "all" || visibility.selectedIds.has(metric.id));
  const filterCount = Number(category !== "All categories") + Number(globalWindow !== "saved");
  const resetFilters = () => { setSearch(""); setCategory("All categories"); setGlobalWindow("saved"); };
  const importPlan = useMemo(() => {
    try { return { rows: pendingImport?.entries.map(entry => ({ entry, matched: matchImport(entry, metrics ?? []) })) ?? [], error: null }; }
    catch (cause) { return { rows: [], error: cause instanceof Error ? cause.message : "Unable to match existing metrics." }; }
  }, [pendingImport, metrics]);
  const importChanges = importPlan.rows.filter(row => !row.matched || replaceExisting).length;

  const reviewImport = async (file: File) => {
    setError(null); setNotice(null);
    try {
      if (file.size > 1024 * 1024) throw new Error("Choose a metrics JSON file smaller than 1 MB, with at most 100 definitions.");
      const entries = parseMetricImport(JSON.parse(await file.text()));
      setPendingImport({ name: file.name, entries }); setReplaceExisting(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This file could not be read."); }
    if (input.current) input.current.value = "";
  };
  const applyImport = async () => {
    if (!pendingImport || importing) return;
    setImporting(true); setError(null);
    try {
      const result = await mutation({ action: "importMetrics", metrics: pendingImport.entries, replaceExisting });
      setNotice(`Import complete: ${result.created} added, ${result.updated} updated, ${result.skipped} skipped.`);
      setPendingImport(null); await load(); setRefreshKey(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Import failed. No partial import was saved."); }
    finally { setImporting(false); }
  };
  const openEdit = (metric: MetricDef) => {
    const definition = exportMetric(metric);
    setEditing({ id: metric.id, name: definition.title, description: definition.description, sql: definition.query, chartType: definition.chart, xColumn: definition.xColumn, yColumns: definition.yColumns, defaultWindow: definition.timerange, category: definition.category, notes: definition.notes, valueFormat: definition.valueFormat, trendDirection: definition.trendDirection, kpiAggregation: definition.kpiAggregation });
    setEditorOpen(true);
  };
  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setError(null);
    try { await mutation({ action: "deleteMetric", id: deleteTarget.id }); setDeleteTarget(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This metric could not be deleted."); }
    finally { setDeleting(false); }
  };

  return <TooltipProvider delayDuration={300}><div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <PageHeader page="Metrics" actions={<><MetricViewSwitch visibility={visibility} /><Button variant="outline" size="sm" aria-label="New metric" onClick={() => { setEditing(null); setEditorOpen(true); }}><PlusIcon className="size-4" /><span className="hidden sm:inline">New metric</span></Button></>} />
    <div className="flex-1 overflow-auto">
      <div className="space-y-3 border-b px-4 py-4 sm:px-6">
        <h1 className="sr-only">Metrics</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-32 flex-1 sm:max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input aria-label="Search metrics" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} className="pr-9 pl-9" />
            {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute top-0 right-0 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><XIcon className="size-3.5" /></button>}
          </div>
          <Button variant={filtersOpen ? "secondary" : "outline"} size="sm" aria-expanded={filtersOpen} aria-controls="metric-filters" onClick={() => setFiltersOpen(open => !open)}>
            <SlidersHorizontalIcon className="size-3.5" /> Filters {filterCount > 0 && <span className="rounded bg-foreground/10 px-1.5 tabular-nums">{filterCount}</span>}
          </Button>
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Refresh visible metrics" title="Refresh visible metrics" disabled={loading} onClick={() => { void load(); setRefreshKey(value => value + 1); }}><RefreshCwIcon className={loading ? "size-4 motion-safe:animate-spin" : "size-4"} /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button ref={optionsButton} variant="ghost" size="icon-sm" aria-label="Metrics options"><MoreHorizontalIcon className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={importing || metrics === null} onClick={() => input.current?.click()}><UploadIcon className="size-4" /> Import metrics</DropdownMenuItem>
                <DropdownMenuItem disabled={!metrics?.length} onClick={() => downloadMetricFile(JSON.stringify(metrics!.map(exportMetric), null, 2), `metrics-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json")}><DownloadIcon className="size-4" /> Export all metrics</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setGuide(open => !open)}><BookOpenIcon className="size-4" />{guide ? "Hide" : "Show"} reading guide</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setConnectionOpen(open => !open)}><InfoIcon className="size-4" />{connectionOpen ? "Hide" : "Show"} connection details</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="Metrics JSON file" onChange={event => { if (event.target.files?.[0]) void reviewImport(event.target.files[0]); }} />
        </div>
        {filtersOpen && <section id="metric-filters" aria-label="Metric filters" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          {(categories.length > 1 || category !== "All categories") && <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">Category
            <select aria-label="Metric category" value={category} onChange={event => setCategory(event.target.value)} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm text-foreground"><option>All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
          </label>}
          <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">Dashboard time range
            <select value={globalWindow} onChange={event => setGlobalWindow(event.target.value as WindowName | "saved")} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm text-foreground"><option value="saved">Each metric&apos;s saved range</option>{METRIC_WINDOWS.map(window => <option key={window} value={window}>{describeWindow(window).range}</option>)}</select>
          </label>
          <p className="max-w-xs pb-1 text-xs leading-relaxed text-muted-foreground">Applies to metrics following the dashboard. Custom ranges and all-history queries keep their own scope.</p>
        </section>}
        {(filterCount > 0 || search.trim()) && <div className="flex flex-wrap items-center gap-2 text-xs">
          {category !== "All categories" && <Button variant="outline" size="sm" aria-label={`Clear category filter: ${category}`} onClick={() => setCategory("All categories")}>{category}<XIcon className="size-3" /></Button>}
          {globalWindow !== "saved" && <Button variant="outline" size="sm" aria-label="Use each metric's saved range" onClick={() => setGlobalWindow("saved")}>{describeWindow(globalWindow).range}<XIcon className="size-3" /></Button>}
          <button type="button" onClick={resetFilters} className="min-h-8 rounded px-1 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Reset filters</button>
        </div>}
        {!!metrics?.length && visibility.ready && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p role="status">{visible.length} of {metrics.length} metrics{visibility.mode === "focused" ? " in Focus" : ""}</p>
          {visibility.mode === "focused" && <button ref={chooseButton} type="button" aria-expanded={choosingMetrics} aria-controls="metric-selection" onClick={() => setChoosingMetrics(open => !open)} className="min-h-8 rounded px-1 underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Choose metrics</button>}
        </div>}
        {!!metrics?.length && visibility.ready && choosingMetrics && visibility.mode === "focused" && <MetricVisibilityControls metrics={metrics} visibility={visibility} onChoosingChange={open => { setChoosingMetrics(open); if (!open) chooseButton.current?.focus(); }} />}
        {guide && <section aria-label="Metrics reading guide" className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Reading metrics</h2><Button variant="ghost" size="icon-sm" aria-label="Close reading guide" onClick={() => { setGuide(false); optionsButton.current?.focus(); }}><XIcon className="size-4" /></Button></div>
          <div className="grid gap-4 text-sm leading-relaxed text-muted-foreground md:grid-cols-3">
            <p>Each card shows its time range. A month is a group of records, not a daily average. Open Details to change the range or inspect the query.</p>
            <p>A session is a visit; a player is a distinct person within a group. Distinct-player counts can overlap. A change from 20% to 25% is +5 percentage points (pp).</p>
            <p>Recent periods can be incomplete. Missing values stay missing. Red and green changes reflect the metric&apos;s favorable-direction setting; chart colors identify series.</p>
          </div>
        </section>}
        {connectionOpen && <section aria-label="Connection details" className="rounded-lg border p-4 text-sm">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Connection details</h2><Button variant="ghost" size="icon-sm" aria-label="Close connection details" onClick={() => { setConnectionOpen(false); optionsButton.current?.focus(); }}><XIcon className="size-4" /></Button></div>
          <p className="mt-2">{health === null ? "Checking connection..." : health.ok ? `Connected to ${health.database || "MySQL"}` : "Connection needs attention"}</p>
          <p className="mt-1 text-muted-foreground">Latest session: {health?.dataAsOf || "unknown"}</p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">The newest PlayerSession timestamp is an activity cutoff estimate, not a replication check. Queries use the server&apos;s current time and database calendar. A delayed backup may leave recent periods empty or incomplete.</p>
        </section>}
      </div>
      <section aria-label="Metric results" className="space-y-4 p-4 sm:p-6">
        {notice && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">{notice}</p>}
        {error && <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm"><p>{error}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Retry loading</Button></div>}
        {health && !health.ok && <div role="status" className="rounded-lg border border-amber-500/40 p-3 text-sm"><p className="font-medium">The database connection could not be verified.</p><p className="mt-1 break-words text-muted-foreground">{health.error} Saved definitions remain available. Check the server connection settings or retry.</p></div>}
        {pendingImport && <section aria-label="Review metrics import" className="rounded-lg border p-4"><h2 className="font-semibold">Review import</h2><p className="mt-1 break-words text-sm text-muted-foreground">{pendingImport.name} · {pendingImport.entries.length} definitions. Queries are saved here and run when the cards load.</p><label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={replaceExisting} disabled={importing} onChange={event => setReplaceExisting(event.target.checked)} className="mt-1" />Update matching saved metrics, keeping their IDs and history. Unchecked matches are skipped.</label>{importPlan.error && <p role="alert" className="text-sm text-destructive">{importPlan.error}</p>}<ul className="max-h-64 overflow-auto divide-y text-sm">{importPlan.rows.map(({ entry, matched }) => <li key={entry.title} className="flex justify-between gap-3 py-2"><span className="min-w-0 break-words">{entry.title}{matched && matched.name !== entry.title && <span className="block text-xs text-muted-foreground">Previously: {matched.name}</span>}</span><span className="shrink-0 text-muted-foreground">{matched ? replaceExisting ? "Update" : "Skip" : "Add"}</span></li>)}</ul><div className="mt-4 flex gap-2"><Button disabled={importing || !importChanges || !!importPlan.error} onClick={() => void applyImport()}>{importing ? "Importing…" : `Apply ${importChanges} changes`}</Button><Button variant="outline" disabled={importing} onClick={() => setPendingImport(null)}>Cancel</Button></div></section>}
        {(metrics === null && loading) || !visibility.ready ? <div role="status" className="grid gap-4 lg:grid-cols-2"><span className="sr-only">Loading metric definitions</span>{[0, 1, 2, 3].map(key => <div key={key} className="h-80 rounded-xl border bg-muted/30 motion-safe:animate-pulse" />)}</div> : metrics?.length === 0 ? <div className="py-16 text-center"><h2 className="text-lg font-semibold">Build your first view</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Import a metrics export or create a query. Add a definition so everyone understands the value.</p><Button className="mt-4" onClick={() => { setEditing(null); setEditorOpen(true); }}>Create a metric</Button></div> : <>
          {metrics && !focused.length && <div className="py-10 text-center"><h2 className="text-lg font-semibold">Choose the metrics that matter to you</h2><p className="mt-2 text-sm text-muted-foreground">Your focused view is empty. Choose metrics above or switch to Show all.</p><Button variant="outline" className="mt-4" onClick={() => setChoosingMetrics(true)}>Customize focused view</Button></div>}
          {!!focused.length && !visible.length && <div className="py-10 text-center text-sm text-muted-foreground"><p>No metrics match these filters in this view.</p><div className="mt-3 flex flex-wrap justify-center gap-2"><Button variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button>{matching.length > 0 && <Button variant="outline" size="sm" onClick={() => visibility.setMode("all")}>Show {matching.length} matching {matching.length === 1 ? "metric" : "metrics"} outside Focus</Button>}</div></div>}
          <div className="grid items-start gap-5 lg:grid-cols-2">{visible.map(metric => <div key={metric.id} className="min-w-0"><MetricCard metric={metric} globalWindow={globalWindow} refreshKey={refreshKey} dataAsOf={health?.dataAsOf} settings={cardSettings[metric.id]} onSettingsChange={settings => setCardSettings(current => ({ ...current, [metric.id]: settings }))} onEdit={() => openEdit(metric)} onDelete={() => setDeleteTarget(metric)} /></div>)}</div>
        </>}

      </section>
    </div>
    {editorOpen && <MetricEditorModal key={editing?.id || "new"} open initial={editing || undefined} onClose={() => setEditorOpen(false)} onSaved={() => { void load(); setRefreshKey(value => value + 1); }} />}
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the saved definition and its run history. Source database records stay unchanged.</AlertDialogDescription></AlertDialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={event => { event.preventDefault(); void remove(); }}>{deleting ? "Deleting…" : "Delete metric"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div></TooltipProvider>;
}
