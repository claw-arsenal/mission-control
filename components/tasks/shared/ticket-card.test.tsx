// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Assignee, Label, Ticket } from "@/types/tasks";
import { TicketCard, dueUrgency } from "./ticket-card";

afterEach(cleanup);

const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "t1",
  title: "Prepare the next release",
  description: "Review rollout checks and share the deployment plan with the team.",
  statusId: "todo",
  priority: "medium",
  dueDate: null,
  scheduledFor: null,
  tags: [],
  labelIds: [],
  assigneeIds: [],
  checklistDone: 0,
  checklistTotal: 0,
  comments: 0,
  attachments: 0,
  createdAt: 0,
  ...overrides,
});

describe("dueUrgency", () => {
  const today = "2026-09-08";

  it("separates past due, due today, and later", () => {
    expect(dueUrgency("2026-09-07", today)).toBe("overdue");
    expect(dueUrgency("2026-09-08", today)).toBe("today");
    expect(dueUrgency("2026-09-09", today)).toBe("later");
  });

  it("has no opinion without a due date", () => {
    expect(dueUrgency(null, today)).toBeNull();
  });

  it("compares the date part of a server timestamp", () => {
    expect(dueUrgency("2026-09-08T23:30:00.000Z", today)).toBe("today");
  });
});

describe("TicketCard", () => {
  it("names the card for assistive technology and opens on click", () => {
    const onClick = vi.fn();
    render(<TicketCard ticket={ticket()} assigneeById={{}} onClick={onClick} />);
    const card = screen.getByRole("article", { name: "Prepare the next release" });
    expect(card).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prepare the next release" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("marks a past due date as danger and today as warning", () => {
    const today = new Date();
    const key = (offset: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const { container, rerender } = render(<TicketCard ticket={ticket({ dueDate: key(-1) })} assigneeById={{}} onClick={vi.fn()} />);
    expect(container.querySelector(".text-danger-fg")).toBeTruthy();

    rerender(<TicketCard ticket={ticket({ dueDate: key(0) })} assigneeById={{}} onClick={vi.fn()} />);
    expect(container.querySelector(".text-warning-fg")).toBeTruthy();
  });

  it("hides the description and extra chips when dense", () => {
    const labels: Record<string, Label> = {
      l1: { id: "l1", boardId: "b", name: "Frontend", color: "#7c3aed" },
      l2: { id: "l2", boardId: "b", name: "Bug", color: "#dc2626" },
      l3: { id: "l3", boardId: "b", name: "Research", color: "#0891b2" },
    };
    const dense = ticket({ labelIds: ["l1", "l2", "l3"], tags: ["ops"] });

    const { rerender } = render(<TicketCard ticket={dense} assigneeById={{}} labelById={labels} onClick={vi.fn()} />);
    expect(screen.getByText(/Review rollout checks/)).toBeTruthy();
    expect(screen.getByText("ops")).toBeTruthy();
    expect(screen.getByText("Research")).toBeTruthy();

    rerender(<TicketCard ticket={dense} assigneeById={{}} labelById={labels} dense onClick={vi.fn()} />);
    expect(screen.queryByText(/Review rollout checks/)).toBeNull();
    expect(screen.queryByText("ops")).toBeNull();
    expect(screen.queryByText("Research")).toBeNull();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("shows assignee initials up to three, then a remainder count", () => {
    const assigneeById: Record<string, Assignee> = {
      a1: { id: "a1", name: "Maya Diaz", initials: "MD", color: "#5B7CF6" },
      a2: { id: "a2", name: "Isaac Kim", initials: "IK", color: "#55A07A" },
      a3: { id: "a3", name: "Luna Park", initials: "LP", color: "#F0A64F" },
      a4: { id: "a4", name: "Zane Cole", initials: "ZC", color: "#EA6C73" },
    };
    render(<TicketCard ticket={ticket({ assigneeIds: ["a1", "a2", "a3", "a4"] })} assigneeById={assigneeById} onClick={vi.fn()} />);
    expect(screen.getByText("MD")).toBeTruthy();
    expect(screen.getByText("LP")).toBeTruthy();
    expect(screen.queryByText("ZC")).toBeNull();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("offers a drag handle only when dragging is allowed", () => {
    const { rerender } = render(<TicketCard ticket={ticket()} assigneeById={{}} onClick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Move Prepare the next release" })).toBeNull();

    rerender(<TicketCard ticket={ticket()} assigneeById={{}} onClick={vi.fn()} dragHandleProps={{}} />);
    expect(screen.getByRole("button", { name: "Move Prepare the next release" })).toBeTruthy();
  });
});
