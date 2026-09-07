// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardHydration, Ticket } from "@/types/tasks";
import { useTasks } from "./use-tasks";

const adapter = vi.hoisted(() => ({ moveTicket: vi.fn(), reorderTickets: vi.fn(), createTicketActivity: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDataAdapter: () => adapter }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function setup() {
  const ticket = (id: string, title: string, dueDate: string): Ticket => ({
    id, title, dueDate, statusId: "todo", description: "", priority: "medium", tags: [], labelIds: [], assigneeIds: [],
    scheduledFor: null, checklistDone: 0, checklistTotal: 0, comments: 0, attachments: 0, createdAt: 0,
  });
  const initialBoards: BoardHydration[] = [{
    id: "board", name: "Board", description: "", data: {
      columnOrder: ["todo", "done"],
      columns: { todo: { id: "todo", title: "To do", tone: "neutral", isDefault: false }, done: { id: "done", title: "Done", tone: "success", isDefault: false } },
      tickets: { zebra: ticket("zebra", "Zebra", "2026-09-07T00:00:00.000Z"), alpha: ticket("alpha", "Alpha", "2026-09-08") },
      ticketIdsByColumn: { todo: ["zebra", "alpha"], done: [] },
    },
  }];
  return renderHook(() => useTasks({ initialBoards, initialBoardId: "board", assigneesByBoardId: {}, labelsByBoardId: {} }));
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 7, 23, 59, 30)); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Board filtering and ordering", () => {
  it("honors title sorting in Kanban while retaining manual order", () => {
    const { result } = setup();
    expect(result.current.sort).toBe("manual");
    act(() => result.current.setSort("title"));
    expect(result.current.visibleTicketIdsByColumn.todo).toEqual(["alpha", "zebra"]);
    expect(result.current.board.ticketIdsByColumn.todo).toEqual(["zebra", "alpha"]);
  });

  it("matches date-only filters against server timestamps", () => {
    const { result } = setup();
    act(() => result.current.setDueFilter("today"));
    expect([...result.current.filteredTicketIds]).toEqual(["zebra"]);
  });

  it("updates Today when an open board crosses midnight", () => {
    const { result } = setup();
    act(() => result.current.setDueFilter("today"));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect([...result.current.filteredTicketIds]).toEqual(["alpha"]);
  });
});

describe("Board mutation recovery", () => {
  it("does not erase another ticket move when an earlier move fails", async () => {
    let rejectFirst!: (error: Error) => void;
    adapter.moveTicket.mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject; })).mockResolvedValueOnce(undefined);
    adapter.createTicketActivity.mockResolvedValue({ id: "activity", occurredAt: "2026-09-07T00:00:00Z" });
    const { result } = setup();
    act(() => result.current.moveTicket("zebra", "todo", "done", 0));
    await act(async () => { result.current.moveTicket("alpha", "todo", "done", 1); });
    await act(async () => { rejectFirst(new Error("Move failed")); });
    expect(result.current.board.tickets.zebra.statusId).toBe("todo");
    expect(result.current.board.tickets.alpha.statusId).toBe("done");
    expect(result.current.board.ticketIdsByColumn.done).toEqual(["alpha"]);
  });
});
