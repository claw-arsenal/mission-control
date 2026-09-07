import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MetricsClient } from "@/components/metrics/metrics-client";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import definitions from "@/docs/metrics/metrics-export-2026-09-07-improved.json";
import "@/app/globals.css";
let offline = false;
const metrics = definitions.map((m, index) => ({ id: `metric-${index}`, name: m.title, description: m.description, sql_text: m.query, chart_type: m.chart, x_column: m.xColumn, y_columns: m.yColumns, default_window: m.timerange, category: m.category, notes: m.notes, value_format: m.valueFormat, trend_direction: m.trendDirection, kpi_aggregation: m.kpiAggregation, updated_at: "2026-09-07", updated_by_name: "Fixture" }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
window.fetch = async (input, init) => {
  const url = String(input);
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 250); init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true }); });
  if (offline) return json({ ok: false, error: "Fixture: the database connection is unavailable." }, 503);
  if (url.endsWith("/health")) return json({ ok: true, database: "altinstar (fixture)", dataAsOf: "2026-09-07 13:00:00", isReadOnlyUser: true });
  if (!init?.method) return json({ ok: true, metrics });
  const body = JSON.parse(String(init.body));
  if (body.action === "runMetric" || body.action === "previewSql") {
    const metric = metrics.find(m => m.id === body.metricId) || metrics[3];
    const index = metrics.indexOf(metric);
    const categories = index === 0 ? ["Mobile (non-iOS)", "Desktop", "iPhone", "Tablet", "iPad", "Other"] : index === 2 ? ["Türkiye", "Germany", "Netherlands", "Azerbaijan", "United States"] : index === 6 ? ["Email", "Google", "Facebook", "Apple"] : index === 9 ? ["Okey 101", "Backgammon", "Okey Düz", "Pişti", "Turkish Poker"] : ["SM-S721B", "SM-A346E", "24116RACCG", "2209116AG", "Unknown device", "SM-A536B", "SM-S918B", "Pixel 9", "SM-A525F", "SM-A156B", "SM-A566B", "CPH2609", "Pixel 8", "SM-S911B", "SM-G991B"];
    const bucketed = metric.sql_text.includes(":bucket");
    const rows = Array.from({ length: bucketed ? index === 3 || body.window === "daily" ? 7 : 9 : categories.length }, (_, i) => ({ [metric.x_column]: bucketed ? body.window === "daily" ? `2026-09-${String(i + 1).padStart(2, "0")}` : body.window === "weekly" ? `2026-W${30 + i}` : body.window === "yearly" ? String(2017 + i) : body.window === "hourly" ? `2026-09-07 ${String(i + 1).padStart(2, "0")}:00` : `2026-${String(i + 1).padStart(2, "0")}` : categories[i], ...Object.fromEntries(metric.y_columns.map((column, series) => [column, column.includes("%") ? Number((22 + series * 15 + Math.sin(i) * 5).toFixed(1)) : Math.round((bucketed ? index === 5 ? 3000 - i * 200 : 1000 + i * 250 + Math.sin(i) * 200 : 15000 / (i + 1)) / (series + 1))])), ...(index === 3 ? { "Eligible new players": 1500 + i * 50 } : {}) }));
    return json({ ok: true, rows, rowCount: rows.length, durationMs: 840, truncated: false, columns: Object.keys(rows[0]).map((name, i) => ({ name, type: i ? "decimal" : "varchar" })) });
  }
  if (body.action === "importMetrics") return json({ ok: true, created: 0, updated: body.replaceExisting ? 12 : 0, skipped: body.replaceExisting ? 0 : 12 });
  return json({ ok: true });
};
function Preview() {
  const [dark, setDark] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className={dark ? "dark" : ""}><div className="flex h-screen flex-col overflow-hidden bg-background text-foreground" style={{ fontFamily: "Arial, sans-serif", "--header-height": "4rem" } as React.CSSProperties}>
    <nav aria-label="Fixture controls" className="flex shrink-0 flex-wrap items-center gap-3 border-b p-2 text-sm"><span>Local sample data</span><button className="rounded border px-3 py-1" onClick={() => { setDark(!dark); document.documentElement.classList.toggle("dark", !dark); }}>Toggle theme</button><button className="rounded border px-3 py-1" onClick={() => { offline = !failed; setFailed(!failed); }}>{failed ? "Restore connection" : "Simulate connection failure"}</button></nav>
    <TooltipProvider><SidebarProvider className="min-h-0 flex-1"><SidebarInset className="min-h-0 overflow-hidden"><MetricsClient /></SidebarInset></SidebarProvider></TooltipProvider><Toaster />
  </div></div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
