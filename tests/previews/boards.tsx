import { createRoot } from "react-dom/client";
import { BoardsPageClient } from "@/components/tasks/boards/boards-page-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import type { BoardHydration, BoardState, Ticket } from "@/types/tasks";
import "@/app/globals.css";

// Every network call the page makes resolves to an empty-but-valid payload.
window.fetch = (async (input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.includes("/api/tasks")) {
    return Response.json({ ok: true, boardAssignees: [], boardLabels: [], rows: [], settings: {} });
  }
  return Response.json({ ok: true, rows: [], modules: [] });
}) as typeof fetch;
class QuietEventSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
window.EventSource = QuietEventSource as unknown as typeof EventSource;

const titles = [
  "Prepare the next release", "Review multilingual customer feedback and accessibility notes", "Fix drag preview flicker on Safari",
  "Design empty state for boards", "Audit keyboard navigation across modals", "Migrate ticket links to the documents module",
  "Write onboarding copy", "Investigate slow board hydration for 2k tickets", "Refresh changelog for 4.1", "Tune due-date filters across midnight",
];
const priorities: Ticket["priority"][] = ["low", "medium", "high", "urgent"];
const dayKey = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const makeTicket = (i: number, statusId: string): Ticket => ({
  id: `t${i}`,
  title: titles[i % titles.length] + (i >= titles.length ? ` (${i})` : ""),
  description: i % 3 === 0 ? "Review rollout checks and share the deployment plan with the team before Thursday." : "",
  statusId,
  priority: priorities[i % priorities.length],
  tags: i % 4 === 0 ? ["ops"] : [],
  labelIds: [],
  assigneeIds: [],
  dueDate: i % 6 === 0 ? dayKey(-2) : i % 6 === 1 ? dayKey(0) : i % 6 === 2 ? dayKey(5) : null,
  scheduledFor: null,
  checklistDone: i % 5 === 0 ? 3 : 0,
  checklistTotal: i % 5 === 0 ? 3 : 0,
  comments: i % 3,
  attachments: i % 4 === 0 ? 1 : 0,
  createdAt: Date.now() - i * 1000,
});

function buildBoard(): BoardState {
  const board: BoardState = {
    columns: {
      backlog: { id: "backlog", title: "Backlog", tone: "neutral", isDefault: true },
      todo: { id: "todo", title: "To do", tone: "info", isDefault: false },
      doing: { id: "doing", title: "In progress", tone: "warning", isDefault: false },
      review: { id: "review", title: "Review", tone: "info", isDefault: false },
      done: { id: "done", title: "Done", tone: "success", isDefault: true },
    },
    columnOrder: ["backlog", "todo", "doing", "review", "done"],
    tickets: {},
    ticketIdsByColumn: { backlog: [], todo: [], doing: [], review: [], done: [] },
  };
  const counts: Record<string, number> = { backlog: 41, todo: 7, doing: 3, review: 0, done: 12 };
  let i = 0;
  for (const [columnId, count] of Object.entries(counts)) {
    for (let k = 0; k < count; k += 1, i += 1) {
      const ticket = makeTicket(i, columnId);
      board.tickets[ticket.id] = ticket;
      board.ticketIdsByColumn[columnId].push(ticket.id);
    }
  }
  return board;
}

const boards: BoardHydration[] = [
  { id: "ops", name: "Platform operations", description: "Day to day runtime work and incident follow-ups.", createdAt: Date.now() - 8.64e7 * 60, updatedAt: Date.now() - 8.64e7, data: buildBoard() },
  { id: "growth", name: "Growth experiments", description: "Store listing tests and onboarding copy.", createdAt: Date.now() - 8.64e7 * 120, updatedAt: Date.now() - 8.64e7 * 3, data: { columns: { ideas: { id: "ideas", title: "Ideas", tone: "neutral", isDefault: true } }, columnOrder: ["ideas"], tickets: {}, ticketIdsByColumn: { ideas: [] } } },
  { id: "mobile", name: "Mobile applications", description: "", createdAt: Date.now() - 8.64e7 * 20, updatedAt: Date.now() - 8.64e7 * 2, data: { columns: { todo: { id: "todo", title: "To do", tone: "info", isDefault: true } }, columnOrder: ["todo"], tickets: {}, ticketIdsByColumn: { todo: [] } } },
];

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <BoardsPageClient
      initialBoardId={new URLSearchParams(window.location.search).get("board")}
      initialBoards={boards}
      initialAssignees={[]}
      sidebarUser={{ name: "Sam Rivera", email: "sam@example.com", avatar: "" }}
    />
    <Toaster position="bottom-right" />
  </TooltipProvider>,
);
