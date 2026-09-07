// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardState } from "@/types/tasks";
import { KanbanView } from "./kanban-view";

const dnd = vi.hoisted(() => ({ props: {} as Record<string, (event?: unknown) => unknown> }));
vi.mock("@dnd-kit/core", async (original) => ({
  ...await original<typeof import("@dnd-kit/core")>(),
  DndContext: ({ children, ...props }: { children: ReactNode }) => { dnd.props = props; return children; },
  DragOverlay: () => null,
}));
vi.mock("./kanban-column", () => ({ KanbanColumn: () => null }));

afterEach(cleanup);

function setup() {
  const board: BoardState = {
    columns: { todo: { id: "todo", title: "To do", tone: "neutral", isDefault: false }, done: { id: "done", title: "Done", tone: "success", isDefault: false } },
    columnOrder: ["todo", "done"],
    tickets: { task: { id: "task", title: "Task", statusId: "todo", priority: "medium", description: "", tags: [], labelIds: [], assigneeIds: [], dueDate: null, scheduledFor: null, checklistDone: 0, checklistTotal: 0, comments: 0, attachments: 0, createdAt: 0 } },
    ticketIdsByColumn: { todo: ["task"], done: [] },
  };
  const moveTicket = vi.fn();
  const props: ComponentProps<typeof KanbanView> = {
    board, assigneeById: {}, visibleTicketIdsByColumn: board.ticketIdsByColumn,
    onAddTask: vi.fn(), canDeleteList: () => false, onDeleteList: vi.fn(),
    onTicketClick: vi.fn(), onTicketCopy: vi.fn(), onTicketDelete: vi.fn(), moveColumn: vi.fn(), moveTicket,
  };
  render(<KanbanView {...props} />);
  const active = { id: "task", data: { current: { type: "ticket", columnId: "todo" } } };
  const over = { id: "done", data: { current: { type: "column" } } };
  act(() => dnd.props.onDragStart({ active }));
  act(() => dnd.props.onDragOver({ active, over }));
  return { active, over, moveTicket };
}

describe("Kanban drag lifecycle", () => {
  it("does not select a nearby list when the pointer is outside every target", () => {
    setup();
    const rect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    const collisions = dnd.props.collisionDetection({
      active: { id: "task", data: { current: { type: "ticket" } } },
      collisionRect: rect, pointerCoordinates: { x: 500, y: 500 },
      droppableRects: new Map([["done", rect]]),
      droppableContainers: [{ id: "done", data: { current: { type: "column" } } }],
    });
    expect(collisions).toEqual([]);
  });

  it("keeps drag previews local so Escape leaves persisted state unchanged", () => {
    const { moveTicket } = setup();
    expect(dnd.props.onDragCancel).toBeTypeOf("function");
    act(() => dnd.props.onDragCancel());
    expect(moveTicket).not.toHaveBeenCalled();
  });

  it("does not move a ticket when released outside a drop target", () => {
    const { active, moveTicket } = setup();
    act(() => dnd.props.onDragEnd({ active, over: null }));
    expect(moveTicket).not.toHaveBeenCalled();
  });

  it("commits a cross-column drop once, from its persisted source column", () => {
    const { active, over, moveTicket } = setup();
    act(() => dnd.props.onDragEnd({ active, over }));
    expect(moveTicket).toHaveBeenCalledTimes(1);
    expect(moveTicket.mock.calls[0].slice(0, 4)).toEqual(["task", "todo", "done", 0]);
  });
});
