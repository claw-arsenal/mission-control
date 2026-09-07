// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KanbanView } from "./kanban-view";
import type { BoardState } from "@/types/tasks";

afterEach(cleanup);

it("lets Escape reach the drag sensor from the ticket's keyboard handle", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const board: BoardState = {
    columns: { todo: { id: "todo", title: "To do", tone: "neutral", isDefault: false } },
    columnOrder: ["todo"], ticketIdsByColumn: { todo: ["task"] },
    tickets: { task: { id: "task", title: "Prepare release", statusId: "todo", priority: "medium", description: "", tags: [], labelIds: [], assigneeIds: [], dueDate: null, scheduledFor: null, checklistDone: 0, checklistTotal: 0, comments: 0, attachments: 0, createdAt: 0 } },
  };
  const moveTicket = vi.fn();
  render(<KanbanView board={board} assigneeById={{}} visibleTicketIdsByColumn={board.ticketIdsByColumn}
    canDeleteList={() => false} onAddTask={vi.fn()} onDeleteList={vi.fn()} onTicketClick={vi.fn()} onTicketCopy={vi.fn()} onTicketDelete={vi.fn()} moveColumn={vi.fn()} moveTicket={moveTicket} />);
  const handle = screen.getByRole("button", { name: "Move Prepare release" });
  await act(async () => { fireEvent.keyDown(handle, { key: " ", code: "Space" }); });
  expect(handle.getAttribute("aria-pressed")).toBe("true");
  // dnd-kit installs its document listener on the next macrotask.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  fireEvent.keyDown(handle, { key: "Escape", code: "Escape" });
  expect(handle.getAttribute("aria-pressed")).not.toBe("true");
  expect(moveTicket).not.toHaveBeenCalled();
});
