// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { MetricChart } from "./metric-chart";

vi.mock("@/components/ui/chart", async () => {
  const { cloneElement } = await import("react");
  const { Tooltip } = await import("recharts");
  return {
    ChartContainer: ({ children }: { children: ReactElement }) => <div>{cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 600, height: 300 })}</div>,
    ChartTooltip: Tooltip,
  };
});
afterEach(cleanup);

describe("Metric chart clarity", () => {
  it("keeps series labels paired with their chart colors, including SQL aliases with punctuation", () => {
    const { container } = render(<MetricChart type="line" xColumn="Month" yColumns={["Players.total", "Retention [%]"]} rows={[{ Month: "2026-07", "Players.total": 100, "Retention [%]": 20 }, { Month: "2026-08", "Players.total": 80, "Retention [%]": 30 }]} />);
    const labels = within(screen.getByRole("list", { name: "Chart series" })).getAllByRole("listitem");
    const lines = container.querySelectorAll(".recharts-line-curve");
    expect(lines).toHaveLength(2);
    labels.forEach((label, index) => expect(label.querySelector("span")!.style.background).toBe(lines[index].getAttribute("stroke")));
  });

  it("keeps share labels paired with slices when zero and missing categories are omitted", () => {
    const { container } = render(<MetricChart type="donut" xColumn="Platform" yColumns={["Players"]} rows={[{ Platform: "Missing", Players: null }, { Platform: "Empty", Players: 0 }, { Platform: "Desktop", Players: 80 }, { Platform: "Mobile", Players: 20 }]} />);
    const slices = container.querySelectorAll(".recharts-pie-sector path");
    const labels = within(screen.getByRole("list", { name: "Category shares" })).getAllByRole("listitem");
    expect(slices).toHaveLength(2);
    expect(labels[2].querySelector("span")!.style.background).toBe(slices[0].getAttribute("fill"));
    expect(labels[3].querySelector("span")!.style.background).toBe(slices[1].getAttribute("fill"));
  });

  it("starts long category charts with six entries and reveals the rest on demand", () => {
    const { container } = render(<MetricChart type="bar" xColumn="Device" yColumns={["Players"]} rows={Array.from({ length: 15 }, (_, i) => ({ Device: `Device ${i + 1}`, Players: 100 - i }))} />);
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all 15 categories" }));
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(15);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer categories" }));
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(6);
  });
});
