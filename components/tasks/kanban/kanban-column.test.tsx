// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Column, Ticket } from "@/types/tasks";
import { KanbanColumn } from "./kanban-column";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const column: Column = { id: "todo", title: "To do", tone: "info", isDefault: false };
const makeTicket = (index: number): Ticket => ({
  id: `t${index}`, title: `Ticket ${index}`, statusId: "todo", priority: "medium", description: "", tags: [], labelIds: [],
  assigneeIds: [], dueDate: null, scheduledFor: null, checklistDone: 0, checklistTotal: 0, comments: 0, attachments: 0, createdAt: index,
});

function renderColumn(overrides: Partial<ComponentProps<typeof KanbanColumn>> = {}) {
  const tickets = overrides.tickets ?? [makeTicket(1), makeTicket(2)];
  const props: ComponentProps<typeof KanbanColumn> = {
    column, tickets, allTicketIds: tickets.map((t) => t.id), assigneeById: {}, density: "comfortable",
    collapsed: false, onToggleCollapse: vi.fn(), composerOpen: false, onComposerOpenChange: vi.fn(),
    onQuickAdd: vi.fn().mockResolvedValue(true), onOpenFullEditor: vi.fn(), onRename: vi.fn().mockResolvedValue(true),
    canDeleteList: true, onDeleteList: vi.fn(), onTicketClick: vi.fn(), onTicketCopy: vi.fn(), onTicketDelete: vi.fn(),
    ...overrides,
  };
  const view = render(<DndContext><KanbanColumn {...props} /></DndContext>);
  return { ...view, props };
}

describe("KanbanColumn progressive reveal", () => {
  it("renders the first page and offers the rest on demand", () => {
    const tickets = Array.from({ length: 30 }, (_, i) => makeTicket(i + 1));
    renderColumn({ tickets, allTicketIds: tickets.map((t) => t.id) });
    expect(screen.getAllByRole("article")).toHaveLength(25);
    expect(screen.getByText("25 of 30 shown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getAllByRole("article")).toHaveLength(30);
    expect(screen.queryByText(/shown$/)).toBeNull();
  });

  it("always renders a pinned ticket even beyond the first page", () => {
    const tickets = Array.from({ length: 30 }, (_, i) => makeTicket(i + 1));
    renderColumn({ tickets, allTicketIds: tickets.map((t) => t.id), pinnedTicketId: "t30" });
    expect(screen.getByText("Ticket 30")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(26);
  });
});

describe("KanbanColumn quick add", () => {
  it("opens the composer from the footer", () => {
    const { props } = renderColumn();
    fireEvent.click(screen.getByRole("button", { name: "Add ticket to To do" }));
    expect(props.onComposerOpenChange).toHaveBeenCalledWith(true);
  });

  it("submits on Enter, keeps composing, and closes on Escape", async () => {
    const { props } = renderColumn({ composerOpen: true });
    const field = screen.getByRole("textbox", { name: "New ticket title" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "Ship it" } });
    await act(async () => { fireEvent.keyDown(field, { key: "Enter" }); });
    expect(props.onQuickAdd).toHaveBeenCalledWith("Ship it");
    expect((field as HTMLTextAreaElement).value).toBe("");
    expect(props.onComposerOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(props.onComposerOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the draft when saving fails and ignores blank submissions", async () => {
    const onQuickAdd = vi.fn().mockResolvedValue(false);
    renderColumn({ composerOpen: true, onQuickAdd });
    const field = screen.getByRole("textbox", { name: "New ticket title" });
    await act(async () => { fireEvent.keyDown(field, { key: "Enter" }); });
    expect(onQuickAdd).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Keep me" } });
    await act(async () => { fireEvent.keyDown(field, { key: "Enter" }); });
    expect((field as HTMLTextAreaElement).value).toBe("Keep me");
  });
});

describe("KanbanColumn inline rename", () => {
  it("renames from the title and commits on Enter", async () => {
    const { props } = renderColumn();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Move list To do" }));
    const input = await screen.findByRole("textbox", { name: "List name" });
    expect((input as HTMLInputElement).value).toBe("To do");
    fireEvent.change(input, { target: { value: "Doing" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(props.onRename).toHaveBeenCalledWith("Doing");
  });

  it("cancels a rename on Escape", async () => {
    const { props } = renderColumn();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Move list To do" }));
    const input = await screen.findByRole("textbox", { name: "List name" });
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "List name" })).toBeNull();
  });
});

describe("KanbanColumn collapse", () => {
  it("shows a slim rail with the count and expands on request", () => {
    const { props, container } = renderColumn({ collapsed: true });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    const rail = within(container).getByRole("button", { name: "Expand list To do" });
    expect(within(container).getByText("2")).toBeTruthy();
    fireEvent.click(rail);
    expect(props.onToggleCollapse).toHaveBeenCalled();
  });
});
