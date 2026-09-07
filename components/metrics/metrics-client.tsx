"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PlusIcon, RefreshCwIcon, DownloadIcon, UploadIcon, BookOpenIcon, SearchIcon } from "lucide-react";
import { useModules } from "@/components/modules/modules-provider";
import { MetricCard, METRIC_WINDOWS } from "./metric-card";
import { MetricHelp } from "./metric-help";
import { MetricVisibilityControls } from "./metric-visibility-controls";
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
          if (!controller.signal.aborted) setHealth(response.ok ? json : { ok: false, error: json.error || "The connection check failed." });
        } catch { if (!controller.signal.aborted) setHealth({ ok: false, error: "The connection check timed out or could not reach the server." }); }
      })(),
    ]);
    if (!controller.signal.aborted) setLoading(false);
  }, []);
  useEffect(() => { void load(); return () => loadController.current?.abort(); }, [load]);

  const categories = useMemo(() => [...new Set((metrics ?? []).map(metric => metric.category || "General"))].sort(), [metrics]);
  const focused = (metrics ?? []).filter(metric => visibility.mode === "all" || visibility.selectedIds.has(metric.id));
  const visible = focused.filter(metric => (category === "All categories" || (metric.category || "General") === category) && `${metric.name} ${metric.description} ${metric.notes}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
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
    <PageHeader page="Metrics" actions={<Button variant="outline" size="sm" onClick={() => { setEditing(null); setEditorOpen(true); }}><PlusIcon className="size-4" /> New metric</Button>} />
    <div className="flex-1 overflow-auto">
      <div className="space-y-4 border-b px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">Understand your players</h1><p className="mt-1 text-sm text-muted-foreground">Explore activity, acquisition, and gameplay. Open any definition to see what is counted.</p></div>
          <div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" aria-expanded={guide} onClick={() => setGuide(value => !value)}><BookOpenIcon className="size-4" /> Reading guide</Button><Button variant="ghost" size="sm" disabled={loading} onClick={() => { void load(); setRefreshKey(value => value + 1); }}><RefreshCwIcon className={loading ? "size-4 motion-safe:animate-spin" : "size-4"} /> Refresh visible</Button><input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="Metrics JSON file" onChange={event => { if (event.target.files?.[0]) void reviewImport(event.target.files[0]); }} /><Button variant="ghost" size="sm" disabled={importing || metrics === null} onClick={() => input.current?.click()}><UploadIcon className="size-4" /> Import</Button><Button variant="ghost" size="sm" disabled={!metrics?.length} onClick={() => downloadMetricFile(JSON.stringify(metrics!.map(exportMetric), null, 2), `metrics-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json")}><DownloadIcon className="size-4" /> Export</Button></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>{metrics === null ? "Loading definitions…" : `${metrics.length} saved metrics`}</span><span>{health === null ? "Checking connection…" : health.ok ? `Connected to ${health.database || "MySQL"}` : "Connection needs attention"}</span><div className="flex items-center">Latest session: {health?.dataAsOf || "unknown"}<MetricHelp label="Latest session"><p>The newest PlayerSession timestamp found in the connected database. This is an activity timestamp, not a replication status or a guarantee that every table is current.</p><p>Queries use the server’s current time. A delayed backup may leave recent periods empty or incomplete. SQL bucket labels use the database’s calendar.</p></MetricHelp></div></div>
        {guide && <section aria-label="Metrics reading guide" className="grid gap-5 rounded-lg border bg-muted/20 p-4 md:grid-cols-3"><div><h2 className="text-sm font-semibold">Choose the right time scale</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Saved defaults keep each metric’s intended range. A dashboard range applies to cards that follow it. All-history queries ignore time controls. A month is a group of records, not a daily average.</p></div><div><h2 className="text-sm font-semibold">Read counts and rates differently</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">A session is a visit; a player is a distinct person within a group. Percentages show a share. Moving from 20% to 25% is +5 percentage points (pp). Do not add distinct-player counts across overlapping groups.</p></div><div><h2 className="text-sm font-semibold">Check completeness before acting</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Recent periods can be partial. Missing values stay missing. Green or red changes appear only when a metric defines a favorable direction. Use Table for exact values and Definition for caveats.</p></div></section>}
        {!!metrics?.length && visibility.ready && <MetricVisibilityControls metrics={metrics} visibility={visibility} choosing={choosingMetrics} onChoosingChange={setChoosingMetrics} />}
        <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-40 flex-1 sm:max-w-xs"><SearchIcon className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search metrics" placeholder="Find a metric…" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div><select aria-label="Metric category" value={category} onChange={event => setCategory(event.target.value)} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"><option>All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select><label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Dashboard range<select aria-label="Dashboard time range" value={globalWindow} onChange={event => setGlobalWindow(event.target.value as WindowName | "saved")} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm text-foreground"><option value="saved">Saved defaults</option>{METRIC_WINDOWS.map(window => <option key={window} value={window}>{describeWindow(window).range} · {describeWindow(window).granularity}</option>)}</select></label></div>
      </div>
      <section aria-label="Metric results" className="space-y-4 p-4 sm:p-6">
        {notice && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">{notice}</p>}
        {error && <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm"><p>{error}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Retry loading</Button></div>}
        {health && !health.ok && <div role="status" className="rounded-lg border border-amber-500/40 p-3 text-sm"><p className="font-medium">The database connection could not be verified.</p><p className="mt-1 break-words text-muted-foreground">{health.error} Saved definitions remain available. Check the server connection settings or retry.</p></div>}
        {pendingImport && <section aria-label="Review metrics import" className="rounded-lg border p-4"><h2 className="font-semibold">Review import</h2><p className="mt-1 break-words text-sm text-muted-foreground">{pendingImport.name} · {pendingImport.entries.length} definitions. Queries are saved here and run when the cards load.</p><label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={replaceExisting} disabled={importing} onChange={event => setReplaceExisting(event.target.checked)} className="mt-1" />Update matching saved metrics, keeping their IDs and history. Unchecked matches are skipped.</label>{importPlan.error && <p role="alert" className="text-sm text-destructive">{importPlan.error}</p>}<ul className="max-h-64 overflow-auto divide-y text-sm">{importPlan.rows.map(({ entry, matched }) => <li key={entry.title} className="flex justify-between gap-3 py-2"><span className="min-w-0 break-words">{entry.title}{matched && matched.name !== entry.title && <span className="block text-xs text-muted-foreground">Previously: {matched.name}</span>}</span><span className="shrink-0 text-muted-foreground">{matched ? replaceExisting ? "Update" : "Skip" : "Add"}</span></li>)}</ul><div className="mt-4 flex gap-2"><Button disabled={importing || !importChanges || !!importPlan.error} onClick={() => void applyImport()}>{importing ? "Importing…" : `Apply ${importChanges} changes`}</Button><Button variant="outline" disabled={importing} onClick={() => setPendingImport(null)}>Cancel</Button></div></section>}
        {(metrics === null && loading) || !visibility.ready ? <div role="status" className="grid gap-4 lg:grid-cols-2"><span className="sr-only">Loading metric definitions</span>{[0, 1, 2, 3].map(key => <div key={key} className="h-80 rounded-xl border bg-muted/30 motion-safe:animate-pulse" />)}</div> : metrics?.length === 0 ? <div className="py-16 text-center"><h2 className="text-lg font-semibold">Build your first view</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Import a metrics export or create a query. Add a definition so everyone understands the value.</p><Button className="mt-4" onClick={() => { setEditing(null); setEditorOpen(true); }}>Create a metric</Button></div> : <>
          {metrics && !focused.length && <div className="py-10 text-center"><h2 className="text-lg font-semibold">Choose the metrics that matter to you</h2><p className="mt-2 text-sm text-muted-foreground">Your focused view is empty. Choose metrics above or switch to Show all.</p><Button variant="outline" className="mt-4" onClick={() => setChoosingMetrics(true)}>Customize focused view</Button></div>}
          {!!focused.length && !visible.length && <p className="py-10 text-center text-sm text-muted-foreground">No metrics match these filters in this view. <button className="underline" onClick={() => { setSearch(""); setCategory("All categories"); }}>Clear filters</button></p>}
          {!!visible.length && <p role="status" className="text-xs text-muted-foreground">Showing {visible.length} of {metrics?.length} metrics{visibility.mode === "focused" ? " · Focused view" : ""}</p>}
          <div className="grid items-start gap-5 lg:grid-cols-2 2xl:grid-cols-3">{visible.map(metric => <div key={metric.id} className="min-w-0"><MetricCard metric={metric} globalWindow={globalWindow} refreshKey={refreshKey} dataAsOf={health?.dataAsOf} onEdit={() => openEdit(metric)} onDelete={() => setDeleteTarget(metric)} /></div>)}</div>
        </>}

      </section>
    </div>
    {editorOpen && <MetricEditorModal key={editing?.id || "new"} open initial={editing || undefined} onClose={() => setEditorOpen(false)} onSaved={() => { void load(); setRefreshKey(value => value + 1); }} />}
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the saved definition and its run history. Source database records stay unchanged.</AlertDialogDescription></AlertDialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={event => { event.preventDefault(); void remove(); }}>{deleting ? "Deleting…" : "Delete metric"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div></TooltipProvider>;
}
