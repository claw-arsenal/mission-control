// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardTasksTable, type DashboardTask } from "./dashboard-tasks-table";

afterEach(cleanup);

const TODAY = new Date("2026-09-08T09:00:00");

const task = (over: Partial<DashboardTask>): DashboardTask => ({
  id: "t1",
  title: "Rotate API keys",
  status: "In progress",
  colorKey: "amber",
  priority: "high",
  dueDate: "2026-09-10",
  done: false,
  boardId: "b1",
  boardName: "Ops",
  ...over,
});

describe("DashboardTasksTable", () => {
  it("makes every row reachable by keyboard through a real link", () => {
    render(<DashboardTasksTable tasks={[task({}), task({ id: "t2", title: "Write release notes" })]} today={TODAY} />);
    const link = screen.getByRole("link", { name: "Rotate API keys" });
    expect(link.getAttribute("href")).toBe("/boards?board=b1&ticket=t1");
    expect(screen.getByRole("link", { name: "Write release notes" })).toBeDefined();
  });

  it("labels due dates by urgency", () => {
    render(
      <DashboardTasksTable
        tasks={[
          task({ id: "a", title: "Late", dueDate: "2026-09-01" }),
          task({ id: "b", title: "Now", dueDate: "2026-09-08" }),
          task({ id: "c", title: "Soon", dueDate: "2026-09-20" }),
          task({ id: "d", title: "Whenever", dueDate: null }),
        ]}
        today={TODAY}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-due"))).toEqual(["overdue", "today", "later", "none"]);
    expect(screen.getByText("Today")).toBeDefined();
    expect(screen.getByText("No due date")).toBeDefined();
    expect(screen.getByText("Sep 1").className).toContain("text-danger-fg");
  });

  it("offers a way forward when the list is empty", () => {
    render(<DashboardTasksTable tasks={[]} today={TODAY} />);
    expect(screen.getByText("You're all caught up")).toBeDefined();
    expect(screen.getByRole("link", { name: /Open boards/ }).getAttribute("href")).toBe("/boards");
  });
});
