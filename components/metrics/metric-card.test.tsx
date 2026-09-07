// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MetricCard } from "./metric-card";
import type { MetricDef } from "@/lib/metrics/definition";

vi.mock("@/hooks/use-metric-query", () => ({ useMetricQuery: () => ({ result: { rows: [{ month: "2026-07", players: 100 }, { month: "2026-08", players: 80 }, { month: "2026-09", players: 20 }], rowCount: 3, durationMs: 10, loadedAt: "2026-09-07T10:00:00Z" }, loading: false, error: null, refresh: vi.fn() }) }));
vi.mock("./metric-chart", () => ({ MetricChart: () => <div>Chart fixture</div> }));
const metric: MetricDef = { id: "players", name: "Active players", description: "A long explanation that belongs in the details.", sql_text: "SELECT :bucket WHERE date > :since", chart_type: "line", x_column: "month", y_columns: ["players"], default_window: "monthly", updated_by_name: null, updated_at: "2026-09-07" };
afterEach(cleanup);

describe("Metric card clarity", () => {
  it.each([
    ["neutral", "Down", "neutral"], ["higher", "Worsened", "negative"], ["lower", "Improved", "positive"],
  ] as const)("explains a decline for %s without implying the wrong outcome", (direction, label, tone) => {
    render(<TooltipProvider><MetricCard metric={{ ...metric, trend_direction: direction }} globalWindow="saved" dataAsOf="2026-09-07" onEdit={vi.fn()} onDelete={vi.fn()} /></TooltipProvider>);
    const change = screen.getByText(label).closest("[data-tone]")!;
    expect(change.getAttribute("data-tone")).toBe(tone);
    if (tone === "neutral") expect(change.className).not.toContain("bg-muted");
  });

  it("reveals secondary controls on demand and labels the inherited range correctly", () => {
    render(<TooltipProvider><MetricCard metric={metric} globalWindow="saved" dataAsOf="2026-09-07" onEdit={vi.fn()} onDelete={vi.fn()} /></TooltipProvider>);
    expect(screen.queryByRole("combobox", { name: "Time range for Active players" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details for Active players" }));
    const range = screen.getByRole("combobox", { name: "Time range for Active players" });
    fireEvent.change(range, { target: { value: "daily" } });
    expect(screen.getByRole("option", { name: "Saved default: Last 12 months" })).toBeDefined();
    expect(screen.getByText(metric.description!)).toBeDefined();
  });
});
