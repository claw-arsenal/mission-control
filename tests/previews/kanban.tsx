import { createRoot } from "react-dom/client";
import { useState } from "react";
import { KanbanView } from "@/components/tasks/kanban/kanban-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import type { Assignee, BoardState, Label, Ticket } from "@/types/tasks";
import type { CardDensity } from "@/hooks/use-tasks";
import "@/app/globals.css";

window.fetch = async () => Response.json({ ok: true });

const assignees: Assignee[] = [
  { id: "a1", name: "Maya Diaz", initials: "MD", color: "#5B7CF6" },
  { id: "a2", name: "Isaac Kim", initials: "IK", color: "#55A07A" },
  { id: "a3", name: "Luna Park", initials: "LP", color: "#F0A64F" },
  { id: "a4", name: "Zane Cole", initials: "ZC", color: "#EA6C73" },
];
const labels: Label[] = [
  { id: "l1", boardId: "b", name: "Frontend", color: "#7c3aed" },
  { id: "l2", boardId: "b", name: "Bug", color: "#dc2626" },
  { id: "l3", boardId: "b", name: "Research", color: "#0891b2" },
];
const assigneeById = Object.fromEntries(assignees.map((a) => [a.id, a]));
const labelById = Object.fromEntries(labels.map((l) => [l.id, l]));

const titles = [
  "Prepare the next release", "Review multilingual customer feedback and accessibility notes", "Fix drag preview flicker on Safari",
  "Design empty state for boards", "Audit keyboard navigation across modals", "Migrate ticket links to the documents module",
  "Write onboarding copy", "Investigate slow board hydration for 2k tickets", "Refresh changelog for 4.1", "Tune due-date filters across midnight",
];
const priorities: Ticket["priority"][] = ["low", "medium", "high", "urgent"];
const today = new Date();
const dayKey = (offset: number) => {
  const d = new Date(today); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const makeTicket = (i: number, statusId: string): Ticket => ({
  id: `t${i}`,
  title: titles[i % titles.length] + (i >= titles.length ? ` (${i})` : ""),
  description: i % 3 === 0 ? "Review rollout checks and share the deployment plan with the team before Thursday." : "",
  statusId,
  priority: priorities[i % priorities.length],
  tags: i % 4 === 0 ? ["ops"] : [],
  labelIds: i % 2 === 0 ? [labels[i % labels.length].id] : i % 5 === 0 ? ["l1", "l2"] : [],
  assigneeIds: assignees.slice(0, i % 4).map((a) => a.id),
  dueDate: i % 6 === 0 ? dayKey(-2) : i % 6 === 1 ? dayKey(0) : i % 6 === 2 ? dayKey(5) : null,
  scheduledFor: null,
  checklistDone: i % 5 === 0 ? 3 : i % 7 === 0 ? 2 : 0,
  checklistTotal: i % 5 === 0 ? 3 : i % 7 === 0 ? 5 : 0,
  comments: i % 3,
  attachments: i % 4 === 0 ? 1 : 0,
  documentsCount: i % 8 === 0 ? 2 : 0,
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
  const counts: Record<string, number> = { backlog: 64, todo: 7, doing: 3, review: 0, done: 12 };
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

function Preview() {
  const [board, setBoard] = useState(buildBoard);
  const [density, setDensity] = useState<CardDensity>("comfortable");
  const [notice, setNotice] = useState("");
  const [failNext, setFailNext] = useState(false);

  const moveTicket = (id: string, from: string, to: string, index: number) => {
    setBoard((current) => {
      const lists = Object.fromEntries(Object.entries(current.ticketIdsByColumn).map(([key, ids]) => [key, ids.filter((t) => t !== id)]));
      lists[to].splice(index, 0, id);
      return { ...current, tickets: { ...current.tickets, [id]: { ...current.tickets[id], statusId: to } }, ticketIdsByColumn: lists };
    });
    setNotice(`Moved ${id} from ${from} to ${to}`);
  };
  const moveColumn = (activeId: string, overId: string) => {
    setBoard((current) => {
      const order = [...current.columnOrder];
      const from = order.indexOf(activeId); const to = order.indexOf(overId);
      order.splice(from, 1); order.splice(to, 0, activeId);
      return { ...current, columnOrder: order };
    });
  };
  const quickAdd = async (columnId: string, title: string) => {
    await new Promise((r) => setTimeout(r, 350));
    if (failNext) { setFailNext(false); setNotice("Fixture: save failed, draft kept"); return false; }
    const id = `new-${Date.now()}`;
    setBoard((current) => ({
      ...current,
      tickets: { ...current.tickets, [id]: { ...makeTicket(0, columnId), id, title, description: "", labelIds: [], assigneeIds: [], dueDate: null, checklistTotal: 0, checklistDone: 0, comments: 0, attachments: 0, documentsCount: 0, priority: "low", tags: [] } },
      ticketIdsByColumn: { ...current.ticketIdsByColumn, [columnId]: [...current.ticketIdsByColumn[columnId], id] },
    }));
    setNotice(`Added "${title}" to ${board.columns[columnId].title}`);
    return true;
  };
  const rename = async (columnId: string, title: string) => {
    setBoard((current) => ({ ...current, columns: { ...current.columns, [columnId]: { ...current.columns[columnId], title } } }));
    setNotice(`Renamed list to ${title}`);
    return true;
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <nav className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm" aria-label="Fixture controls">
        <span className="font-medium">Kanban fixture</span>
        <span className="text-muted-foreground">{Object.keys(board.tickets).length} tickets · local sample data</span>
        <button className="rounded border px-2 py-0.5" onClick={() => document.documentElement.classList.toggle("dark")}>Toggle theme</button>
        <button className="rounded border px-2 py-0.5" onClick={() => setDensity((d) => (d === "compact" ? "comfortable" : "compact"))}>Density: {density}</button>
        <button className="rounded border px-2 py-0.5" onClick={() => setFailNext(true)}>Fail next quick add</button>
        <input className="ml-auto h-8 rounded border px-2" aria-label="Search tickets" placeholder="Search (press /)" id="fixture-search" />
        {notice && <span role="status" className="text-xs text-muted-foreground">{notice}</span>}
      </nav>
      <TooltipProvider>
        <div className="min-h-0 flex-1 p-4">
          <KanbanView
            boardId="fixture-board"
            board={board}
            density={density}
            visibleTicketIdsByColumn={board.ticketIdsByColumn}
            assigneeById={assigneeById}
            labelById={labelById}
            canDeleteList={(id) => board.ticketIdsByColumn[id].length === 0 && !board.columns[id].isDefault}
            onAddTask={(id) => setNotice(`Open full editor for ${id}`)}
            onAddList={() => setNotice("Add list")}
            onQuickAddTicket={quickAdd}
            onRenameList={rename}
            onFocusSearch={() => document.getElementById("fixture-search")?.focus()}
            onDeleteList={(id) => setNotice(`Delete list ${id}`)}
            onTicketClick={(id) => setNotice(`Opened ${id}`)}
            onTicketCopy={() => {}}
            onTicketDelete={() => {}}
            moveColumn={moveColumn}
            moveTicket={moveTicket}
          />
        </div>
      </TooltipProvider>
      <Toaster />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
