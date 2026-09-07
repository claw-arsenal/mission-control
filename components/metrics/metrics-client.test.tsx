// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsClient } from "./metrics-client";
import type { ReactNode } from "react";
import type { MetricCardSettings } from "./metric-card";
import type { MetricDef } from "@/lib/metrics/definition";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/modules/modules-provider", () => ({ useModules: () => ({ ready: true, isEnabled: () => true }) }));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: ({ actions }: { actions: ReactNode }) => <header>{actions}</header> }));
vi.mock("./metric-editor-modal", () => ({ MetricEditorModal: () => null }));
vi.mock("./metric-card", () => ({
  METRIC_WINDOWS: ["daily"],
  MetricCard: ({ metric, settings, onSettingsChange, dataAsOf }: { metric: MetricDef; settings?: MetricCardSettings; onSettingsChange: (settings: MetricCardSettings) => void; dataAsOf?: string }) => <article aria-label={metric.name} data-as-of={dataAsOf}>
    {metric.name} {settings?.view ?? "chart"} {settings?.override ?? "inherit"}
    <button onClick={() => onSettingsChange({ view: "table", override: "daily" })}>Inspect {metric.name}</button>
  </article>,
}));

const metrics = Array.from({ length: 8 }, (_, index) => ({
  id: `metric-${index}`, name: `Metric ${index + 1}`, category: index < 4 ? "Activity" : "Acquisition",
  description: "Player activity", notes: "", sql_text: "SELECT 1", chart_type: "kpi", x_column: "", y_columns: ["count"],
  default_window: "monthly", updated_by_name: null, updated_at: "2026-09-07",
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/health")
    ? { ok: true, database: "Fixture", dataAsOf: "2026-09-01" } : { ok: true, metrics })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Metrics focused view", () => {
  it("mounts only four cards initially and offers all metrics on demand", async () => {
    await act(async () => { render(<MetricsClient />); });
    expect(screen.getAllByRole("article")).toHaveLength(4);
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("switch", { name: "Show all metrics" }).getAttribute("aria-checked")).toBe("false");
    expect(within(header).getByRole("button", { name: "New metric" })).toBeDefined();
    fireEvent.click(screen.getByRole("switch", { name: "Show all metrics" }));
    expect(screen.getAllByRole("article")).toHaveLength(8);
    fireEvent.change(screen.getByRole("textbox", { name: "Search metrics" }), { target: { value: "Metric 8" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("remembers the chosen set and view when the page is reopened", async () => {
    let page: ReturnType<typeof render>;
    await act(async () => { page = render(<MetricsClient />); });
    fireEvent.click(screen.getByRole("button", { name: "Choose metrics" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Metric 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Metric 8" }));
    expect(screen.queryByRole("article", { name: "Metric 1" })).toBeNull();
    expect(screen.getByRole("article", { name: "Metric 8" })).toBeDefined();
    page!.unmount();
    await act(async () => { render(<MetricsClient />); });
    expect(screen.queryByRole("article", { name: "Metric 1" })).toBeNull();
    expect(screen.getByRole("article", { name: "Metric 8" })).toBeDefined();
    fireEvent.click(screen.getByRole("switch", { name: "Show all metrics" }));
    cleanup();
    await act(async () => { render(<MetricsClient />); });
    expect(screen.getAllByRole("article")).toHaveLength(8);
  });

  it("provides a recovery action for an empty selection", async () => {
    await act(async () => { render(<MetricsClient />); });
    fireEvent.click(screen.getByRole("button", { name: "Choose metrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("Choose the metrics that matter to you")).toBeDefined();
    fireEvent.click(screen.getByRole("switch", { name: "Show all metrics" }));
    expect(screen.getAllByRole("article")).toHaveLength(8);
  });
  it("hides filters until needed and keeps active filters visible with a reset", async () => {
    await act(async () => { render(<MetricsClient />); });
    expect(screen.queryByRole("combobox", { name: "Dashboard time range" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Metric category" }), { target: { value: "Acquisition" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Dashboard time range" }), { target: { value: "daily" } });
    fireEvent.click(screen.getByRole("button", { name: "Filters 2" }));
    expect(screen.queryByRole("combobox", { name: "Metric category" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear category filter: Acquisition" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Use each metric's saved range" })).toBeDefined();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Filters" })).toBeDefined();
  });

  it("keeps a card's range and table choice while search temporarily hides it", async () => {
    await act(async () => { render(<MetricsClient />); });
    fireEvent.click(screen.getByRole("button", { name: "Inspect Metric 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search metrics" }), { target: { value: "Metric 2" } });
    expect(screen.queryByRole("article", { name: "Metric 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(within(screen.getByRole("article", { name: "Metric 1" })).getByText("Metric 1 table daily")).toBeDefined();
  });

  it("offers search matches outside Focus without losing the search", async () => {
    await act(async () => { render(<MetricsClient />); });
    fireEvent.change(screen.getByRole("textbox", { name: "Search metrics" }), { target: { value: "Metric 8" } });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 matching metric outside Focus" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Metric 8" })).toBeDefined();
  });

  it("keeps the last known data cutoff when a connection refresh fails", async () => {
    await act(async () => { render(<MetricsClient />); });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "Connection unavailable" }, { status: 503 })));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh visible metrics" })); });
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByRole("article", { name: "Metric 1" }).getAttribute("data-as-of")).toBe("2026-09-01");
    expect(screen.getByText("The database connection could not be verified.")).toBeDefined();
  });

});
