// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsClient } from "./metrics-client";
import type { MetricDef } from "@/lib/metrics/definition";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/modules/modules-provider", () => ({ useModules: () => ({ ready: true, isEnabled: () => true }) }));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));
vi.mock("./metric-editor-modal", () => ({ MetricEditorModal: () => null }));
vi.mock("./metric-card", () => ({
  METRIC_WINDOWS: ["daily"],
  MetricCard: ({ metric }: { metric: MetricDef }) => <article aria-label={metric.name}>{metric.name} chart</article>,
}));

const metrics = Array.from({ length: 8 }, (_, index) => ({
  id: `metric-${index}`, name: `Metric ${index + 1}`, category: index < 4 ? "Activity" : "Acquisition",
  description: "Player activity", notes: "", sql_text: "SELECT 1", chart_type: "kpi", x_column: "", y_columns: ["count"],
  default_window: "monthly", updated_by_name: null, updated_at: "2026-09-07",
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/health")
    ? { ok: true, database: "Fixture" } : { ok: true, metrics })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Metrics focused view", () => {
  it("mounts only six cards initially and offers all metrics on demand", async () => {
    await act(async () => { render(<MetricsClient />); });
    expect(screen.getAllByRole("article")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getAllByRole("article")).toHaveLength(8);
  });
});
