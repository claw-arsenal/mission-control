// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardHydration, Ticket } from "@/types/tasks";
import { useTasks } from "./use-tasks";

const adapter = vi.hoisted(() => ({ moveTicket: vi.fn(), reorderTickets: vi.fn(), createTicketActivity: vi.fn(), createTicket: vi.fn(), updateColumn: vi.fn(), uploadTicketAttachment: vi.fn(), createTicketSubtask: vi.fn() }));
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

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 7, 23, 59, 30)); vi.clearAllMocks(); window.localStorage.clear(); });
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

describe("Quick ticket creation", () => {
  const createdRecord = {
    id: "created-1", boardId: "board", columnId: "todo", title: "Write docs", description: "", priority: "low",
    dueDate: null, scheduledFor: null, tags: [], labelIds: [], assigneeIds: [], checklistDone: 0, checklistTotal: 0,
    commentsCount: 0, attachmentsCount: 0, position: 2, createdAt: "2026-09-07T10:00:00Z",
  };

  it("appends the ticket to the end of the list and swaps in the saved record", async () => {
    let resolveCreate!: (record: typeof createdRecord) => void;
    adapter.createTicket.mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve; }));
    adapter.createTicketActivity.mockResolvedValue({ id: "activity", occurredAt: "2026-09-07T00:00:00Z" });
    const { result } = setup();
    let outcome: Promise<boolean>;
    act(() => { outcome = result.current.quickCreateTicket("todo", "  Write docs  "); });
    const optimistic = result.current.board.ticketIdsByColumn.todo;
    expect(optimistic).toHaveLength(3);
    expect(optimistic.slice(0, 2)).toEqual(["zebra", "alpha"]);
    expect(result.current.board.tickets[optimistic[2]].title).toBe("Write docs");
    expect(adapter.createTicket).toHaveBeenCalledWith("board", expect.objectContaining({ columnId: "todo", title: "Write docs", beforeTicketId: null }));
    await act(async () => { resolveCreate(createdRecord); });
    expect(await outcome!).toBe(true);
    expect(result.current.board.ticketIdsByColumn.todo).toEqual(["zebra", "alpha", "created-1"]);
    expect(result.current.board.tickets["created-1"].statusId).toBe("todo");
  });

  it("removes the optimistic ticket when saving fails", async () => {
    adapter.createTicket.mockRejectedValueOnce(new Error("Offline"));
    const { result } = setup();
    let outcome = true;
    await act(async () => { outcome = await result.current.quickCreateTicket("todo", "Write docs"); });
    expect(outcome).toBe(false);
    expect(result.current.board.ticketIdsByColumn.todo).toEqual(["zebra", "alpha"]);
  });

  it("rejects blank titles without touching the board", async () => {
    const { result } = setup();
    let outcome = true;
    await act(async () => { outcome = await result.current.quickCreateTicket("todo", "   "); });
    expect(outcome).toBe(false);
    expect(adapter.createTicket).not.toHaveBeenCalled();
  });
});

describe("List renaming", () => {
  it("renames optimistically and keeps the new title once saved", async () => {
    adapter.updateColumn.mockResolvedValueOnce({ id: "todo", title: "Doing" });
    const { result } = setup();
    await act(async () => { await result.current.renameList("todo", " Doing "); });
    expect(result.current.board.columns.todo.title).toBe("Doing");
    expect(adapter.updateColumn).toHaveBeenCalledWith("todo", { title: "Doing" });
  });

  it("restores the previous title when saving fails", async () => {
    adapter.updateColumn.mockRejectedValueOnce(new Error("Offline"));
    const { result } = setup();
    await act(async () => { await result.current.renameList("todo", "Doing"); });
    expect(result.current.board.columns.todo.title).toBe("To do");
  });

  it("ignores unchanged or blank titles", async () => {
    const { result } = setup();
    await act(async () => { await result.current.renameList("todo", "To do"); });
    await act(async () => { await result.current.renameList("todo", ""); });
    expect(adapter.updateColumn).not.toHaveBeenCalled();
  });
});

describe("Card density", () => {
  it("defaults to comfortable and remembers the chosen density", () => {
    const { result } = setup();
    expect(result.current.cardDensity).toBe("comfortable");
    act(() => result.current.setCardDensity("compact"));
    expect(result.current.cardDensity).toBe("compact");
    expect(window.localStorage.getItem("mc:kanban:density")).toBe("compact");
  });

  it("restores a remembered density after mount", () => {
    window.localStorage.setItem("mc:kanban:density", "compact");
    const { result } = setup();
    expect(result.current.cardDensity).toBe("compact");
  });
});

describe("Full ticket creation", () => {
  it("does not undo another ticket's move when creating fails", async () => {
    let rejectCreate!: (error: Error) => void;
    adapter.createTicket.mockReturnValueOnce(new Promise((_, reject) => { rejectCreate = reject; }));
    adapter.moveTicket.mockResolvedValue(undefined);
    adapter.createTicketActivity.mockResolvedValue({ id: "activity", occurredAt: "2026-09-07T00:00:00Z" });

    const { result } = setup();
    act(() => result.current.openCreateModal("todo"));
    act(() => result.current.setCreateForm((prev) => ({ ...prev, title: "Draft the roadmap" })));

    let creating!: Promise<void>;
    act(() => { creating = result.current.handleCreateTicket(); });
    const optimisticId = result.current.board.ticketIdsByColumn.todo[0];
    expect(result.current.board.tickets[optimisticId].title).toBe("Draft the roadmap");

    // A move lands while the create request is still in flight.
    await act(async () => { result.current.moveTicket("zebra", "todo", "done", 0); });

    await act(async () => { rejectCreate(new Error("Offline")); await creating; });

    expect(result.current.board.tickets[optimisticId]).toBeUndefined();
    expect(result.current.board.tickets.zebra.statusId).toBe("done");
    expect(result.current.board.ticketIdsByColumn.done).toEqual(["zebra"]);
    expect(result.current.board.ticketIdsByColumn.todo).toEqual(["alpha"]);
  });
});
