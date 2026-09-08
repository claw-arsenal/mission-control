// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Delta, StatStrip } from "./stat-strip";
import type { DashboardPulse } from "@/lib/db/dashboard-pulse";
import type { OverviewPoint } from "@/lib/db/server-data";

afterEach(cleanup);

const series: OverviewPoint[] = Array.from({ length: 20 }, (_, i) => ({
  date: `2026-08-${String(i + 1).padStart(2, "0")}`,
  created: i % 3,
  completed: i % 2,
  events: 0,
}));

const healthy: DashboardPulse = {
  tickets: { open: 12, overdue: 0, dueToday: 2, completed7d: 9, completedPrev7d: 6, created7d: 4, createdPrev7d: 4 },
  agenda: { upcoming24h: 3, active: 1, failed7d: 0 },
  services: { total: 3, running: 3, error: 0, stopped: 0 },
  attention: [],
  loadedAt: 0,
};

describe("Delta", () => {
  it("colours a rise green only when up is good", () => {
    render(<Delta current={9} previous={6} upIsGood period="last week" />);
    const el = screen.getByText("+50%").closest("[data-tone]")!;
    expect(el.getAttribute("data-tone")).toBe("success");
    expect(el.getAttribute("data-direction")).toBe("up");
  });

  it("stays neutral when direction has no value judgement", () => {
    render(<Delta current={2} previous={4} upIsGood={null} period="last week" />);
    expect(screen.getByText("-50%").closest("[data-tone]")!.getAttribute("data-tone")).toBe("neutral");
  });

  it("falls back to an absolute change when the previous period was empty", () => {
    render(<Delta current={3} previous={0} upIsGood period="last week" />);
    expect(screen.getByText("+3")).toBeDefined();
  });
});

describe("StatStrip", () => {
  it("renders six linked tiles with honest context lines", () => {
    render(<StatStrip pulse={healthy} series={series} />);
    const region = screen.getByRole("region", { name: "Operational overview" });
    const tiles = within(region).getAllByRole("link");
    expect(tiles).toHaveLength(6);
    expect(within(region).getByText("Open tickets")).toBeDefined();
    expect(within(region).getByText("2 due today")).toBeDefined();
    expect(within(region).getByText("All runs succeeded")).toBeDefined();
    expect(within(region).getByText("3/3")).toBeDefined();
    expect(within(region).getByText("All running")).toBeDefined();
  });

  it("marks a failed block as unavailable instead of showing a zero", () => {
    render(<StatStrip pulse={{ ...healthy, services: null, agenda: null }} series={series} />);
    const unavailable = document.querySelectorAll("[data-slot=stat-tile][data-unavailable]");
    expect(unavailable).toHaveLength(3);
    expect(screen.getAllByText("Unavailable right now")).toHaveLength(3);
    expect(screen.queryByText("0/0")).toBeNull();
  });

  it("surfaces failures with a danger tone", () => {
    render(
      <StatStrip
        pulse={{ ...healthy, agenda: { upcoming24h: 0, active: 0, failed7d: 2 }, services: { total: 3, running: 2, error: 1, stopped: 0 } }}
        series={series}
      />,
    );
    expect(screen.getByText("Open Agenda to retry")).toBeDefined();
    expect(screen.getByText("1 reporting errors")).toBeDefined();
    expect(screen.getByText("2/3").className).toContain("text-danger-fg");
  });
});
