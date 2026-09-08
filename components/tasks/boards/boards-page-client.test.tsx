// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardHydration, BoardState } from "@/types/tasks";
import { BoardsPageClient } from "./boards-page-client";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn() }),
  usePathname: () => "/boards",
  useSearchParams: () => nav.params,
}));
vi.mock("@/components/layout/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/lib/db", () => ({ getDataAdapter: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function boardState(): BoardState {
  return {
    columns: {
      todo: { id: "todo", title: "To do", tone: "info", isDefault: true },
      done: { id: "done", title: "Done", tone: "success", isDefault: true },
    },
    columnOrder: ["todo", "done"],
    tickets: {
      t1: {
        id: "t1", title: "Prepare the next release", description: "", statusId: "todo", priority: "high",
        dueDate: null, scheduledFor: null, tags: [], labelIds: [], assigneeIds: [],
        checklistDone: 0, checklistTotal: 0, comments: 0, attachments: 0, createdAt: 1,
      },
    },
    ticketIdsByColumn: { todo: ["t1"], done: [] },
  };
}

const boards: BoardHydration[] = [
  { id: "ops", name: "Platform operations", description: "Runtime work.", data: boardState() },
  { id: "growth", name: "Growth experiments", description: "Listing tests.", data: { columns: {}, columnOrder: [], tickets: {}, ticketIdsByColumn: {} } },
];

function renderPage() {
  return render(
    <BoardsPageClient initialBoardId={null} initialBoards={boards} initialAssignees={[]} sidebarUser={null} />,
  );
}

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.replace.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rows: [], boardAssignees: [], boardLabels: [] }) }));
  vi.stubGlobal("EventSource", class { close() {} addEventListener() {} removeEventListener() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Boards page shell", () => {
  it("lists every board with a way to add another", async () => {
    await act(async () => { renderPage(); });
    expect(screen.getByRole("button", { name: "Platform operations" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Growth experiments" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add board/ })).toBeTruthy();
    expect(screen.getByText("2 boards")).toBeTruthy();
  });

  it("filters the list from the search field and reports the result count", async () => {
    await act(async () => { renderPage(); });
    const search = screen.getByRole("textbox", { name: "Search boards" });
    await act(async () => { fireEvent.change(search, { target: { value: "growth" } }); });

    expect(screen.queryByRole("button", { name: "Platform operations" })).toBeNull();
    expect(screen.getByRole("button", { name: "Growth experiments" })).toBeTruthy();
    expect(screen.getByText("1 result")).toBeTruthy();
  });

  it("offers a way back when the search matches nothing", async () => {
    await act(async () => { renderPage(); });
    const search = screen.getByRole("textbox", { name: "Search boards" });
    await act(async () => { fireEvent.change(search, { target: { value: "nothing matches this" } }); });

    expect(screen.getByText("No boards match that search")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clear search" })); });
    expect(screen.getByRole("button", { name: "Platform operations" })).toBeTruthy();
  });

  it("opens a board into the workspace, with a trail back to the list", async () => {
    nav.params = new URLSearchParams("board=ops");
    await act(async () => { renderPage(); });

    expect(screen.getByText("Platform operations")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Boards" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to all boards" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search tickets" })).toBeTruthy();
    expect(screen.getByText("1 ticket")).toBeTruthy();
  });

  it("reaches board activity through a sheet where the panel does not fit", async () => {
    nav.params = new URLSearchParams("board=ops");
    await act(async () => { renderPage(); });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Activity" })); });
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Board activity")).toBeTruthy();
  });
});
