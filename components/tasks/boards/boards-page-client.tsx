"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CalendarView } from "@/components/tasks/calendar/calendar-view";
import { GridView } from "@/components/tasks/grid/grid-view";
import { KanbanView } from "@/components/tasks/kanban/kanban-view";
import { ListView } from "@/components/tasks/list/list-view";
import { CreateBoardModal } from "@/components/tasks/modals/create-board-modal";
import { CreateListModal } from "@/components/tasks/modals/create-list-modal";
import { DiscardModal } from "@/components/tasks/modals/discard-modal";
import { ManageAssigneesModal } from "@/components/tasks/modals/manage-assignees-modal";
import { ManageLabelsModal } from "@/components/tasks/modals/manage-labels-modal";
import { TicketDetailsModal } from "@/components/tasks/modals/ticket-details-modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyFooter, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTasks } from "@/hooks/use-tasks";
import { cn } from "@/lib/utils";
import {
  type Assignee,
  type Label,
  type BoardHydration,
  type TicketDetailsForm,
  type SortMode,
  type ViewMode,
} from "@/types/tasks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronLeftIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  LayoutGridIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { BoardActivityFeed, type LiveLog } from "@/components/tasks/boards/board-activity-feed";
import { WorkspaceToolbar } from "@/components/tasks/boards/workspace-toolbar";

// UTC date formatting to avoid hydration mismatches
const pad = (n: number) => String(n).padStart(2, "0");
const formatDateUTC = (value: string | number | null | undefined): string => {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  return `${month}/${day}/${year}`;
};

const formatDateTimeUTC = (value: string | number | null | undefined): string => {
  if (!value) return "No tasks yet";
  const d = typeof value === "string" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  return `${month}/${day}/${year}, ${hours}:${minutes} UTC`;
};

const SORT_OPTIONS: Array<{ key: SortMode; label: string }> = [
  { key: "manual", label: "Manual order" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "dueDate", label: "Due date" },
  { key: "title", label: "Title" },
];

const VIEW_OPTIONS: Array<{ key: ViewMode; label: string }> = [
  { key: "kanban", label: "Kanban" },
  { key: "list", label: "List" },
  { key: "grid", label: "Grid" },
  { key: "calendar", label: "Calendar" },
];

type Props = {
  initialBoardId: string | null;
  initialBoards: BoardHydration[];
  initialAssignees: Assignee[];
  sidebarUser: {
    name: string;
    email: string;
    avatar: string;
  } | null;
};

type RawBoardAssignee = { id: string; board_id: string; name: string; color: string; initials: string | null; email: string | null };
type RawBoardLabel = { id: string; board_id: string; name: string; color: string };

function groupLabelsByBoard(rows: RawBoardLabel[]): Record<string, Label[]> {
  const out: Record<string, Label[]> = {};
  for (const row of rows) {
    if (!out[row.board_id]) out[row.board_id] = [];
    out[row.board_id].push({ id: row.id, boardId: row.board_id, name: row.name, color: row.color });
  }
  return out;
}

function deriveInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

function groupAssigneesByBoard(rows: RawBoardAssignee[]): Record<string, Assignee[]> {
  const out: Record<string, Assignee[]> = {};
  for (const row of rows) {
    if (!out[row.board_id]) out[row.board_id] = [];
    out[row.board_id].push({
      id: row.id,
      name: row.name,
      initials: row.initials || deriveInitials(row.name),
      color: row.color,
      email: row.email,
    });
  }
  return out;
}

async function postTasks<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string } & T> {
  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return json as { ok: boolean; error?: string } & T;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" } as { ok: boolean; error?: string } & T;
  }
}

export function BoardsPageClient({ initialBoardId, initialBoards, initialAssignees: _ignored, sidebarUser }: Props) {
  void _ignored;
  const [assigneesByBoardId, setAssigneesByBoardId] = useState<Record<string, Assignee[]>>({});
  const [labelsByBoardId, setLabelsByBoardId] = useState<Record<string, Label[]>>({});
  const [manageAssigneesOpen, setManageAssigneesOpen] = useState(false);
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false);

  const reloadAssignees = async () => {
    try {
      const res = await fetch("/api/tasks", { cache: "reload" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) {
        if (Array.isArray(json.boardAssignees)) {
          setAssigneesByBoardId(groupAssigneesByBoard(json.boardAssignees as RawBoardAssignee[]));
        }
        if (Array.isArray(json.boardLabels)) {
          setLabelsByBoardId(groupLabelsByBoard(json.boardLabels as RawBoardLabel[]));
        }
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { void reloadAssignees(); }, []);

  const tasks = useTasks({ initialBoardId, initialBoards, assigneesByBoardId, labelsByBoardId });
  const router = useRouter();
  const searchParams = useSearchParams();
  const [boardSearch, setBoardSearch] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(Boolean(initialBoardId));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [boardActivity, setBoardActivity] = useState<LiveLog[]>([]);
  const [boardActivityLoading, setBoardActivityLoading] = useState(false);
  const [boardActivityError, setBoardActivityError] = useState<string | null>(null);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);
  // Bumped by the feed's retry action to re-run the load and reconnect.
  const [activityReloadKey, setActivityReloadKey] = useState(0);

  // Confirmation modal state
  const [deleteBoardId, setDeleteBoardId] = useState<string | null>(null);
  const [deleteBoardName, setDeleteBoardName] = useState("");
  const [copyBoardId, setCopyBoardId] = useState<string | null>(null);
  const [copyBoardName, setCopyBoardName] = useState("");
  const [copyAndOpen, setCopyAndOpen] = useState(false);

  const boardParam = searchParams.get("board");

  const handleCreateAssignee = async (name: string, color: string, email: string) => {
    if (!tasks.activeBoardId) return { ok: false, error: "No active board." };
    const res = await postTasks({ action: "createBoardAssignee", boardId: tasks.activeBoardId, name, color, email });
    if (res.ok) await reloadAssignees();
    return { ok: res.ok, error: res.error };
  };

  const handleUpdateAssignee = async (assigneeId: string, name: string, color: string, email: string) => {
    const res = await postTasks({ action: "updateBoardAssignee", assigneeId, name, color, email });
    if (res.ok) await reloadAssignees();
    return { ok: res.ok, error: res.error };
  };

  const handleDeleteAssignee = async (assigneeId: string) => {
    const res = await postTasks({ action: "deleteBoardAssignee", assigneeId });
    if (res.ok) await reloadAssignees();
    return { ok: res.ok, error: res.error };
  };

  const handleCreateLabel = async (name: string, color: string) => {
    if (!tasks.activeBoardId) return { ok: false, error: "No active board." };
    const res = await postTasks({ action: "createBoardLabel", boardId: tasks.activeBoardId, name, color });
    if (res.ok) await reloadAssignees();
    return { ok: res.ok, error: res.error };
  };

  const handleUpdateLabel = async (labelId: string, name: string, color: string) => {
    const res = await postTasks({ action: "updateBoardLabel", labelId, name, color });
    if (res.ok) await reloadAssignees();
    return { ok: res.ok, error: res.error };
  };

  const handleDeleteLabel = async (labelId: string) => {
    const res = await postTasks({ action: "deleteBoardLabel", labelId });
    if (res.ok) await reloadAssignees();
    return { ok: res.ok, error: res.error };
  };

  const reloadBoardsRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    reloadBoardsRef.current = tasks.reloadBoards;
  }, [tasks]);

  const visibleBoards = useMemo(() => {
    const query = boardSearch.trim().toLowerCase();
    if (!query) return tasks.boardSummaries;
    return tasks.boardSummaries.filter((board) => {
      if (board.name.toLowerCase().includes(query)) return true;
      return board.description.toLowerCase().includes(query);
    });
  }, [boardSearch, tasks.boardSummaries]);

  const createTicketForm = useMemo<TicketDetailsForm>(() => {
    const fallbackStatusId = tasks.board.columnOrder[0] ?? "";
    const statusId = tasks.board.columns[tasks.createForm.statusId]
      ? tasks.createForm.statusId
      : fallbackStatusId;

    return {
      id: "create-ticket",
      title: tasks.createForm.title,
      description: tasks.createForm.description,
      statusId,
      priority: tasks.createForm.priority,
      dueDate: tasks.createForm.dueDate,
      tagsText: tasks.createForm.tagsText,
      assigneeIds: tasks.createForm.assigneeIds,
      labelIds: tasks.createForm.labelIds ?? [],
      scheduledFor: tasks.createForm.scheduledFor,
      checklistDone: 0,
      checklistTotal: 0,
      comments: 0,
      attachments: 0,
    };
  }, [tasks.board.columnOrder, tasks.board.columns, tasks.createForm]);

  const openBoardWorkspace = (boardId: string) => {
    tasks.setActiveBoardId(boardId);
    setWorkspaceOpen(true);
    const next = new URLSearchParams(window.location.search);
    next.set("board", boardId);
    const query = next.toString();
    router.replace(query ? `/boards?${query}` : "/boards");
  };

  const closeBoardWorkspace = () => {
    setWorkspaceOpen(false);
    tasks.clearSearch();
    const next = new URLSearchParams(window.location.search);
    next.delete("board");
    const query = next.toString();
    router.replace(query ? `/boards?${query}` : "/boards");
  };

  // ── Delete board: show confirmation first ──────────────────────────────────
  const requestDeleteBoard = (boardId: string) => {
    const board = tasks.boardSummaries.find((b) => b.id === boardId);
    setDeleteBoardName(board?.name ?? "this board");
    setDeleteBoardId(boardId);
  };

  const confirmDeleteBoard = async () => {
    if (!deleteBoardId) return;
    const boardId = deleteBoardId;
    setDeleteBoardId(null);

    const deleted = await tasks.handleDeleteBoard(boardId);
    if (!deleted) return;

    if (boardParam === boardId) {
      setWorkspaceOpen(false);
      const next = new URLSearchParams(window.location.search);
      next.delete("board");
      const query = next.toString();
      router.replace(query ? `/boards?${query}` : "/boards");
    }
  };

  // ── Copy board: show confirmation first ───────────────────────────────────
  const requestCopyBoard = (boardId: string, openAfter = false) => {
    const board = tasks.boardSummaries.find((b) => b.id === boardId);
    setCopyBoardName(board?.name ?? "this board");
    setCopyBoardId(boardId);
    setCopyAndOpen(openAfter);
  };

  const confirmCopyBoard = async () => {
    if (!copyBoardId) return;
    const boardId = copyBoardId;
    const shouldOpen = copyAndOpen;
    setCopyBoardId(null);

    const copiedBoardId = await tasks.handleCopyBoard(boardId);
    if (!copiedBoardId || !shouldOpen) return;
    openBoardWorkspace(copiedBoardId);
  };

  useEffect(() => {
    if (!boardParam) {
      setWorkspaceOpen(false);
      return;
    }

    const targetBoard = tasks.boards.find((board) => board.id === boardParam);
    if (!targetBoard) {
      setWorkspaceOpen(false);
      return;
    }

    tasks.setActiveBoardId(boardParam);
    setWorkspaceOpen(true);
  }, [boardParam, tasks]);

  // One-shot: if the page mounted with ?board=X&ticket=Y, open that ticket.
  // We don't push ?ticket= to the URL on regular clicks (that was reverted in 3.4.x);
  // this is only for shareable links someone explicitly pasted.
  const ticketDeepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (ticketDeepLinkHandledRef.current) return;
    const ticketParam = searchParams.get("ticket");
    if (!ticketParam || !boardParam) return;
    if (!tasks.boards.find((b) => b.id === boardParam)) return;
    ticketDeepLinkHandledRef.current = true;
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("mc:open-ticket", { detail: { ticketId: ticketParam, boardId: boardParam } }),
      );
      // Strip ?ticket= from the URL so refreshes don't re-open and to keep the URL clean.
      const next = new URLSearchParams(window.location.search);
      next.delete("ticket");
      const query = next.toString();
      router.replace(query ? `/boards?${query}` : "/boards");
    }, 300);
  }, [boardParam, searchParams, tasks.boards, router]);

  // Listen for mc:open-ticket events from the sidebar Live Activity
  // (no ?ticket= URL param — avoids re-opening modal on refresh)
  useEffect(() => {
    const handler = (e: Event) => {
      const { ticketId, boardId } = (e as CustomEvent<{ ticketId: string; boardId: string }>).detail;
      if (!ticketId || !boardId) return;
      // Ensure the right board is open first
      if (tasks.board.tickets[ticketId]) {
        tasks.openDetailsModal(ticketId);
      } else {
        // Board may not be loaded yet — open it then wait for next render
        tasks.setActiveBoardId(boardId);
        setWorkspaceOpen(true);
        // Slight delay to let board state settle before opening modal
        setTimeout(() => {
          tasks.openDetailsModal(ticketId);
        }, 200);
      }
    };
    window.addEventListener("mc:open-ticket", handler);
    return () => window.removeEventListener("mc:open-ticket", handler);
  }, [tasks]);

  useEffect(() => {
    if (!workspaceOpen || !tasks.activeBoardId) {
      setBoardActivity([]);
      return;
    }

    let cancelled = false;
    let eventSource: EventSource | null = null;

    const loadInitial = async () => {
      setBoardActivityLoading(true);
      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "listBoardActivity", boardId: tasks.activeBoardId, limit: 20 }),
        });
        if (!response.ok) throw new Error(`The server returned ${response.status}.`);
        const data = await response.json();
        if (!cancelled) {
          setBoardActivity(Array.isArray(data.rows) ? data.rows : []);
          setBoardActivityError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setBoardActivityError(error instanceof Error ? error.message : "Board activity could not be loaded.");
        }
      } finally {
        if (!cancelled) setBoardActivityLoading(false);
      }
    };

    void loadInitial();

    const connect = () => {
      setBoardActivityLoading(true);
      eventSource = new EventSource("/api/events");

      eventSource.addEventListener("ticket_activity", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          const row = data.row;
          if (row?.board_id === tasks.activeBoardId) {
            setBoardActivity((prev) => [row, ...prev].slice(0, 20));
            reloadBoardsRef.current?.();
          }
        } catch {
          // ignore malformed events
        }
      });

      eventSource.addEventListener("error", () => {
        // The browser retries on its own; only a closed stream is worth reporting.
        if (!cancelled && eventSource?.readyState === EventSource.CLOSED) {
          setBoardActivityLoading(false);
          setBoardActivityError("Live updates disconnected.");
        }
      });

      eventSource.onopen = () => {
        if (cancelled) return;
        setBoardActivityLoading(false);
        setBoardActivityError(null);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [tasks.activeBoardId, workspaceOpen, activityReloadKey]); // `tasks` is deliberately not a dependency

  const activityStatusLabel = boardActivityError
    ? "Offline"
    : boardActivityLoading
      ? "Connecting…"
      : "Live feed";
  const activityDotClass = boardActivityError
    ? "bg-danger"
    : boardActivityLoading
      ? "bg-warning motion-safe:animate-pulse"
      : "bg-success";

  const activityFeed = (
    <BoardActivityFeed
      activity={boardActivity}
      loading={boardActivityLoading}
      error={boardActivityError}
      onRetry={() => setActivityReloadKey((key) => key + 1)}
      onTicketClick={(ticketId) => {
        setActivitySheetOpen(false);
        tasks.openDetailsModal(ticketId);
      }}
    />
  );

  return (
    <SidebarProvider
      style={
        {
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" initialUser={sidebarUser} />
      <SidebarInset>
        <PageHeader
          page={workspaceOpen ? tasks.activeBoardName || "Board" : "Boards"}
          crumbs={workspaceOpen ? [{ label: "Boards", href: "/boards" }] : []}
          leading={
            workspaceOpen ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={closeBoardWorkspace}
                aria-label="Back to all boards"
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronLeftIcon />
              </Button>
            ) : undefined
          }
          actions={
            workspaceOpen ? (
              <>
                <div className="hidden items-center gap-2 md:flex">
                  <WorkspaceToolbar
                    tasks={tasks}
                    boardAssignees={assigneesByBoardId[tasks.activeBoardId] ?? []}
                    boardLabels={labelsByBoardId[tasks.activeBoardId] ?? []}
                    onManageAssignees={() => setManageAssigneesOpen(true)}
                    onManageLabels={() => setManageLabelsOpen(true)}
                    onEditBoard={() => tasks.openEditBoardModal(tasks.activeBoardId)}
                    onCopyBoard={() => requestCopyBoard(tasks.activeBoardId, true)}
                    onDeleteBoard={() => requestDeleteBoard(tasks.activeBoardId)}
                  />
                </div>

                {/* Below md the toolbar collapses to the primary action plus one menu */}
                <div className="flex items-center gap-1 md:hidden">
                  <Button
                    size="icon-sm"
                    onClick={() => tasks.openCreateModal(tasks.board.columnOrder[0] ?? "")}
                    aria-label="Add ticket"
                  >
                    <PlusIcon />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Board actions" id={`workspace-board-actions-${tasks.activeBoardId || "none"}`}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={tasks.openCreateListModal}>Add list</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setManageAssigneesOpen(true)}>Manage assignees</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setManageLabelsOpen(true)}>Manage labels</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => tasks.openEditBoardModal(tasks.activeBoardId)}>Edit board</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => requestCopyBoard(tasks.activeBoardId, true)}>Copy board</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => requestDeleteBoard(tasks.activeBoardId)}>
                        Delete board
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup value={tasks.sort} onValueChange={(value) => tasks.setSort(value as SortMode)}>
                        {SORT_OPTIONS.map((option) => (
                          <DropdownMenuRadioItem key={option.key} value={option.key}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup value={tasks.view} onValueChange={(value) => tasks.setView(value as ViewMode)}>
                        {VIEW_OPTIONS.map((option) => (
                          <DropdownMenuRadioItem key={option.key} value={option.key}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={tasks.openCreateBoardModal}>
                <PlusIcon />
                Add board
              </Button>
            )
          }
        />

        {/* Search sits under the header so one field serves every width */}
        <div className="page-x flex items-center gap-3 border-b border-line py-2">
          <div className="relative min-w-0 flex-1 md:max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              className="h-8 pr-3 pl-8"
              placeholder={workspaceOpen ? "Search tickets…" : "Search boards…"}
              aria-label={workspaceOpen ? "Search tickets" : "Search boards"}
              value={workspaceOpen ? tasks.searchInput : boardSearch}
              onChange={(event) => {
                if (workspaceOpen) {
                  tasks.setSearchInput(event.target.value);
                  return;
                }
                setBoardSearch(event.target.value);
              }}
            />
          </div>

          {workspaceOpen ? (
            <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {tasks.totalVisible} ticket{tasks.totalVisible !== 1 ? "s" : ""}
              </span>

              {/* The activity panel only fits beside the board on large screens;
                  below that the same status opens it in a sheet. */}
              <span className="hidden items-center gap-1.5 lg:flex" role="status">
                <span className={cn("size-1.5 rounded-full", activityDotClass)} aria-hidden />
                {activityStatusLabel}
              </span>

              <Sheet open={activitySheetOpen} onOpenChange={setActivitySheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground lg:hidden">
                    <span className={cn("size-1.5 rounded-full", activityDotClass)} aria-hidden />
                    Activity
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[min(22rem,calc(100vw-2rem))] p-0">
                  {/* The feed carries its own visible heading, so the sheet's is for assistive tech. */}
                  <SheetHeader className="sr-only">
                    <SheetTitle>Board activity</SheetTitle>
                    <SheetDescription>{activityStatusLabel}</SheetDescription>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-hidden p-3">{activityFeed}</div>
                </SheetContent>
              </Sheet>
            </div>
          ) : (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {boardSearch.trim()
                ? `${visibleBoards.length} result${visibleBoards.length !== 1 ? "s" : ""}`
                : `${tasks.boards.length} board${tasks.boards.length !== 1 ? "s" : ""}`}
            </span>
          )}
        </div>

        {!workspaceOpen ? (
          <div className="page-x flex flex-1 flex-col overflow-auto py-(--page-y)">
            {visibleBoards.length === 0 ? (
              <Empty className="border-line bg-surface-2/60">
                <EmptyHeader>
                  <LayoutGridIcon className="mx-auto mb-2 size-8 text-muted-foreground/50" aria-hidden />
                  <EmptyTitle>{boardSearch.trim() ? "No boards match that search" : "No boards yet"}</EmptyTitle>
                  <EmptyDescription>
                    {boardSearch.trim()
                      ? "Try a different term, or clear the search to see every board."
                      : "A board holds your lists and tickets. Create one to start tracking work."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyFooter>
                  {boardSearch.trim() ? (
                    <Button variant="outline" size="sm" onClick={() => setBoardSearch("")}>
                      Clear search
                    </Button>
                  ) : (
                    <Button size="sm" onClick={tasks.openCreateBoardModal}>
                      <PlusIcon />
                      Add board
                    </Button>
                  )}
                </EmptyFooter>
              </Empty>
            ) : (
              <div className="surface-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Board</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-20">Tickets</TableHead>
                      <TableHead className="w-20">Lists</TableHead>
                      <TableHead className="hidden lg:table-cell">Created</TableHead>
                      <TableHead className="hidden lg:table-cell">Updated</TableHead>
                      <TableHead className="hidden xl:table-cell">Last ticket</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleBoards.map((board) => (
                      <TableRow
                        key={board.id}
                        className={cn(
                          "cursor-pointer",
                          board.id === tasks.activeBoardId && "bg-surface-2",
                        )}
                        onClick={() => openBoardWorkspace(board.id)}
                      >
                        <TableCell className="font-medium">
                          <button type="button" className="max-w-full truncate rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={(event) => { event.stopPropagation(); openBoardWorkspace(board.id); }}>{board.name}</button>
                        </TableCell>
                        <TableCell className="max-w-[360px]">
                          <p className="truncate text-sm text-muted-foreground">
                            {board.description || "No description yet."}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{board.totalTickets}</TableCell>
                        <TableCell className="text-sm tabular-nums">{board.listCount}</TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {formatDateUTC(board.createdAt)}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {formatDateUTC(board.updatedAt)}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                          {formatDateTimeUTC(board.lastTicketAt)}
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="cursor-pointer"
                                  aria-label={`Actions for ${board.name}`}
                                  id={`board-actions-${board.id}`}
                                >
                                  <MoreHorizontalIcon className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openBoardWorkspace(board.id)}>
                                  Open board
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => tasks.openEditBoardModal(board.id)}>
                                  Edit board
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => requestCopyBoard(board.id)}>
                                  Copy board
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => requestDeleteBoard(board.id)}
                                >
                                  Delete board
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="page-x grid min-h-0 flex-1 gap-4 overflow-hidden py-(--page-y) lg:grid-cols-[1fr_340px]">
              <div
                className={cn(
                  // min-w-0 keeps the board inside its grid track; without it the
                  // horizontally scrolling lists widen the track under the activity panel.
                  "flex min-h-0 min-w-0 flex-col",
                  tasks.view === "kanban" ? "overflow-hidden" : "overflow-auto",
                )}
              >
                <div
                  className={cn(
                    "min-h-0 flex-1",
                    tasks.view === "kanban" ? "overflow-hidden" : "overflow-auto",
                  )}
                >
                  {tasks.view === "kanban" && (
                    <KanbanView
                      boardId={tasks.activeBoardId}
                      board={tasks.board}
                      assigneeById={tasks.assigneeById}
                      labelById={tasks.labelById}
                      visibleTicketIdsByColumn={tasks.visibleTicketIdsByColumn}
                      density={tasks.cardDensity}
                      onAddTask={tasks.openCreateModal}
                      onAddList={tasks.openCreateListModal}
                      onQuickAddTicket={tasks.quickCreateTicket}
                      onRenameList={tasks.renameList}
                      onFocusSearch={() => searchInputRef.current?.focus()}
                      canDeleteList={tasks.canDeleteList}
                      onDeleteList={tasks.handleDeleteList}
                      onTicketClick={tasks.openDetailsModal}
                      onTicketCopy={tasks.handleCopyTicket}
                      onTicketDelete={tasks.handleDeleteTicket}
                      moveColumn={tasks.moveColumn}
                      moveTicket={tasks.moveTicket}
                      ticketDraggingDisabled={tasks.sort !== "manual"}
                    />
                  )}
                  {tasks.view === "list" && (
                    <ListView
                      tickets={tasks.sortedFilteredTickets}
                      board={tasks.board}
                      assigneeById={tasks.assigneeById}
                      onTicketClick={tasks.openDetailsModal}
                      onTicketCopy={tasks.handleCopyTicket}
                      onTicketDelete={tasks.handleDeleteTicket}
                      searchQuery={tasks.searchQuery}
                      onClearSearch={tasks.clearSearch}
                    />
                  )}
                  {tasks.view === "grid" && (
                    <GridView
                      tickets={tasks.sortedFilteredTickets}
                      assigneeById={tasks.assigneeById}
                      searchQuery={tasks.searchQuery}
                      onTicketClick={tasks.openDetailsModal}
                      onTicketCopy={tasks.handleCopyTicket}
                      onTicketDelete={tasks.handleDeleteTicket}
                      onClearSearch={tasks.clearSearch}
                    />
                  )}
                  {tasks.view === "calendar" && (
                    <CalendarView
                      tickets={tasks.sortedFilteredTickets}
                      assigneeById={tasks.assigneeById}
                      labelById={tasks.labelById}
                      onTicketClick={tasks.openDetailsModal}
                    />
                  )}
                </div>
              </div>

              <aside className="surface-card hidden min-h-0 overflow-hidden p-3 lg:flex lg:flex-col">
                {activityFeed}
              </aside>
            </div>
          </div>
        )}
      </SidebarInset>

      <TicketDetailsModal
        mode="create"
        open={tasks.modal === "create"}
        form={createTicketForm}
        board={tasks.board}
        assignees={assigneesByBoardId[tasks.activeBoardId] ?? []}
        labels={labelsByBoardId[tasks.activeBoardId] ?? []}
        boardId={tasks.activeBoardId}
        attachments={[]}
        attachmentsLoading={false}
        attachmentsUploading={false}
        subtasks={[]}
        subtasksLoading={false}
        onAddSubtask={() => {}}
        onToggleSubtask={() => {}}
        onDeleteSubtask={() => {}}
        onRenameChecklist={() => {}}
        onDeleteChecklist={() => {}}
        comments={[]}
        commentsLoading={false}
        commentDraft=""
        onCommentDraftChange={() => {}}
        onAddComment={() => {}}
        onDeleteComment={() => {}}
        activity={[]}
        activityLoading={false}
        onChange={(patch) =>
          tasks.setCreateForm((prev) => ({
            ...prev,
            title: patch.title ?? prev.title,
            description: patch.description ?? prev.description,
            statusId: patch.statusId ?? prev.statusId,
            priority: patch.priority ?? prev.priority,
            dueDate: patch.dueDate ?? prev.dueDate,
            scheduledFor: patch.scheduledFor ?? prev.scheduledFor,
            tagsText: patch.tagsText ?? prev.tagsText,
            assigneeIds: patch.assigneeIds ?? prev.assigneeIds,
            labelIds: patch.labelIds ?? prev.labelIds,
          }))
        }
        onUploadAttachments={() => {}}
        onDeleteAttachment={() => {}}
        onSave={(files, draftSubtasks) => void tasks.handleCreateTicket(files ?? [], draftSubtasks ?? [])}
        onCopy={() => {}}
        onDelete={() => {}}
        onClose={tasks.closeCreateModal}
      />

      <CreateBoardModal
        open={tasks.createBoardOpen}
        mode="create"
        title={tasks.createBoardTitle}
        description={tasks.createBoardDescription}
        error={tasks.createBoardError}
        onTitleChange={tasks.setCreateBoardTitle}
        onDescriptionChange={tasks.setCreateBoardDescription}
        onSubmit={tasks.handleCreateBoard}
        onClose={tasks.closeCreateBoardModal}
      />

      <CreateBoardModal
        open={tasks.editBoardOpen}
        mode="edit"
        title={tasks.editBoardTitle}
        description={tasks.editBoardDescription}
        error={tasks.editBoardError}
        onTitleChange={tasks.setEditBoardTitle}
        onDescriptionChange={tasks.setEditBoardDescription}
        onSubmit={tasks.handleUpdateBoard}
        onClose={tasks.closeEditBoardModal}
      />

      <CreateListModal
        open={tasks.createListOpen}
        title={tasks.createListTitle}
        error={tasks.createListError}
        onTitleChange={tasks.setCreateListTitle}
        onSubmit={tasks.handleCreateList}
        onClose={tasks.closeCreateListModal}
      />

      <ManageAssigneesModal
        open={manageAssigneesOpen}
        boardName={tasks.activeBoardName || "this board"}
        assignees={assigneesByBoardId[tasks.activeBoardId] ?? []}
        onCreate={handleCreateAssignee}
        onUpdate={handleUpdateAssignee}
        onDelete={handleDeleteAssignee}
        onClose={() => setManageAssigneesOpen(false)}
      />

      <ManageLabelsModal
        open={manageLabelsOpen}
        boardName={tasks.activeBoardName || "this board"}
        labels={labelsByBoardId[tasks.activeBoardId] ?? []}
        onCreate={handleCreateLabel}
        onUpdate={handleUpdateLabel}
        onDelete={handleDeleteLabel}
        onClose={() => setManageLabelsOpen(false)}
      />

      {tasks.detailsForm &&
        (() => {
          const detailsForm = tasks.detailsForm;
          return (
            <TicketDetailsModal
              open={tasks.modal === "details"}
              form={detailsForm}
              board={tasks.board}
              assignees={assigneesByBoardId[tasks.activeBoardId] ?? []}
              labels={labelsByBoardId[tasks.activeBoardId] ?? []}
              boardId={tasks.activeBoardId}
              attachments={tasks.detailsAttachments}
              attachmentsLoading={tasks.detailsAttachmentsLoading}
              attachmentsUploading={tasks.detailsAttachmentsUploading}
              subtasks={tasks.detailsSubtasks}
              subtasksLoading={tasks.detailsSubtasksLoading}
              onAddSubtask={(title, checklistName) => void tasks.addDetailsSubtask(checklistName, title)}
              onToggleSubtask={(subtaskId, completed) =>
                void tasks.toggleDetailsSubtask(subtaskId, completed)
              }
              onDeleteSubtask={(subtaskId) => void tasks.deleteDetailsSubtask(subtaskId)}
              onRenameChecklist={(oldName, newName) => void tasks.renameDetailsChecklist(oldName, newName)}
              onDeleteChecklist={(name) => void tasks.deleteDetailsChecklist(name)}
              comments={tasks.detailsComments}
              commentsLoading={tasks.detailsCommentsLoading}
              commentDraft={tasks.commentDraft}
              onCommentDraftChange={tasks.setCommentDraft}
              onAddComment={() => void tasks.addDetailsComment()}
              onDeleteComment={(commentId) => void tasks.deleteDetailsComment(commentId)}
              activity={tasks.detailsActivity}
              activityLoading={tasks.detailsActivityLoading}
              onChange={(patch) =>
                tasks.setDetailsForm((prev) => (prev ? { ...prev, ...patch } : prev))
              }
              onUploadAttachments={(files) => void tasks.uploadDetailsAttachments(files)}
              onDeleteAttachment={(attachmentId) => void tasks.deleteDetailsAttachment(attachmentId)}
              onSave={() => tasks.handleSaveDetails()}
              onCopy={() => void tasks.handleCopyTicket(detailsForm.id)}
              onDelete={() => void tasks.handleDeleteTicket(detailsForm.id)}
              onClose={tasks.closeDetailsModal}
            />
          );
        })()}

      <DiscardModal
        open={tasks.modal === "discard"}
        onKeepEditing={tasks.keepEditing}
        onDiscard={tasks.discardChanges}
      />

      {/* Delete board confirmation */}
      <AlertDialog open={!!deleteBoardId} onOpenChange={(open) => { if (!open) setDeleteBoardId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2Icon className="size-5 text-destructive" />
              Delete board
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold text-foreground">{deleteBoardName}</span>? All tickets, lists, and activity in this board will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDeleteBoard()}
            >
              Delete board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Copy board confirmation */}
      <AlertDialog open={!!copyBoardId} onOpenChange={(open) => { if (!open) setCopyBoardId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CopyIcon className="size-5 text-primary" />
              Copy board
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will create a duplicate of <span className="font-semibold text-foreground">{copyBoardName}</span> including all lists and tickets. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmCopyBoard()}>
              Copy board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </SidebarProvider>
  );
}

