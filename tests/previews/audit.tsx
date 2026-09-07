import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CustomMonthAgenda, type ViewMode } from "@/components/agenda/custom-month-agenda";
import { KanbanView } from "@/components/tasks/kanban/kanban-view";
import { AgendaEventModal, type AgendaEventFormData } from "@/components/agenda/agenda-event-modal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import type { BoardState, Ticket } from "@/types/tasks";
import "@/app/globals.css";

window.fetch = async () => Response.json({ ok: true, models: [], events: [], agents: [], processes: [], chats: [] });
const baseTicket: Ticket = { id: "task", title: "Prepare the next release", description: "Review rollout checks and share the deployment plan with the team.", statusId: "todo", priority: "high", tags: [], labelIds: [], assigneeIds: [], dueDate: "2026-09-08", scheduledFor: null, checklistDone: 2, checklistTotal: 5, comments: 1, attachments: 0, createdAt: Date.now() };
const initialBoard: BoardState = {
  columns: { todo: { id: "todo", title: "To do", tone: "neutral", isDefault: false }, doing: { id: "doing", title: "In progress", tone: "info", isDefault: false }, done: { id: "done", title: "Done", tone: "success", isDefault: false } },
  columnOrder: ["todo", "doing", "done"],
  tickets: { task: baseTicket, review: { ...baseTicket, id: "review", title: "Review multilingual customer feedback and accessibility notes", statusId: "doing", priority: "medium" } },
  ticketIdsByColumn: { todo: ["task"], doing: ["review"], done: [] },
};
const event = { id: "briefing", title: "Morning operations briefing", start: "2026-09-07T10:00:00Z", end: "2026-09-07T10:30:00Z", allDay: false, extendedProps: { timezone: "UTC", status: "scheduled", recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE" } };

function Preview() {
  const [page, setPage] = useState("agenda");
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [date, setDate] = useState(new Date(2026, 8, 7));
  const [board, setBoard] = useState(initialBoard);
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState<Partial<AgendaEventFormData>>();
  const moveTicket = (id: string, from: string, to: string, index: number) => {
    setBoard(current => {
      const lists = Object.fromEntries(Object.entries(current.ticketIdsByColumn).map(([key, ids]) => [key, ids.filter(ticket => ticket !== id)]));
      lists[to].splice(index, 0, id);
      return { ...current, tickets: { ...current.tickets, [id]: { ...current.tickets[id], statusId: to } }, ticketIdsByColumn: lists };
    });
    setNotice(`Moved ${id} from ${from} to ${to}`);
  };
  return <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "Arial, sans-serif" }}>
    <nav className="flex flex-wrap items-center gap-3 border-b p-3 text-sm" aria-label="Fixture controls">
      <span>Local sample data</span><button onClick={() => setPage("agenda")}>Agenda</button><button onClick={() => setPage("kanban")}>Kanban</button>
      <a href="/tests/previews/metrics.html">Metrics</a>
      <button onClick={() => document.documentElement.classList.toggle("dark")}>Toggle theme</button>
      <button onClick={() => { setDraft({ title: "Weekly report", request: "Prepare the operations report", taskType: "repeatable", frequency: "weekly", recurrence: "weekly", weekdays: ["2", "4"], timezone: "UTC", startDate: "2026-09-07", startTime: "10:00" }); setEditor(true); }}>Edit recurring event</button>
    </nav>
    <TooltipProvider><div className="p-4"><h1 className="mb-4 text-xl font-semibold">{page === "agenda" ? "Agenda" : "Kanban"}</h1>
      {notice && <p role="status" className="mb-3 rounded border p-2 text-sm">{notice}</p>}
      {page === "agenda" ? <div className="h-[650px]"><CustomMonthAgenda events={[event]} loading={false} currentDate={date} viewMode={viewMode} onDateChange={setDate} onViewModeChange={setViewMode} onEventClick={() => setNotice("Opened Morning operations briefing")} onDayClick={day => setNotice(`Selected ${day.toDateString()}`)} /></div> : <div className="h-[650px]"><KanbanView board={board} visibleTicketIdsByColumn={board.ticketIdsByColumn} assigneeById={{}} canDeleteList={() => false} onAddTask={() => setNotice("Create task")} onDeleteList={() => {}} onTicketClick={id => setNotice(`Opened ${id}`)} onTicketCopy={() => {}} onTicketDelete={() => {}} moveColumn={() => {}} moveTicket={moveTicket} /></div>}
    </div><AgendaEventModal open={editor} initialData={draft} onClose={() => setEditor(false)} onSave={async () => { await new Promise(resolve => setTimeout(resolve, 400)); throw new Error("Fixture: save unavailable. Your draft is kept."); }} /></TooltipProvider><Toaster />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
