"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { GridView } from "@/components/tasks/grid/grid-view";
import { KanbanView } from "@/components/tasks/kanban/kanban-view";
import { ListView } from "@/components/tasks/list/list-view";
import { CreateBoardModal } from "@/components/tasks/modals/create-board-modal";
import { CreateListModal } from "@/components/tasks/modals/create-list-modal";
import { DiscardModal } from "@/components/tasks/modals/discard-modal";
import { TicketDetailsModal } from "@/components/tasks/modals/ticket-details-modal";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTasks } from "@/hooks/use-tasks";
import { cn } from "@/lib/utils";
import {
  SORT_OPTIONS,
  type Assignee,
  VIEW_OPTIONS,
  type BoardHydration,
  type TicketDetailsForm,
  type SortMode,
  type ViewMode,
} from "@/types/tasks";
import {
  ChevronLeftIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

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

export function BoardsPageClient({ initialBoardId, initialBoards, initialAssignees, sidebarUser }: Props) {
  const tasks = useTasks({ initialBoardId, initialBoards, initialAssignees });
  const router = useRouter();
  const searchParams = useSearchParams();
  const [boardSearch, setBoardSearch] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(Boolean(initialBoardId));
  const [openedTicketFromQuery, setOpenedTicketFromQuery] = useState<string | null>(null);
  const boardParam = searchParams.get("board");
  const ticketParam = searchParams.get("ticket");

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
      scheduledFor: tasks.createForm.scheduledFor,
      assignedAgentId: tasks.createForm.assignedAgentId,
      autoApprove: tasks.createForm.autoApprove,
      executionState: "pending",
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

  const handleDeleteBoard = async (boardId: string) => {
    const deleted = await tasks.handleDeleteBoard(boardId);
    if (!deleted) {
      return;
    }

    if (boardParam === boardId) {
      setWorkspaceOpen(false);
      const next = new URLSearchParams(window.location.search);
      next.delete("board");
      const query = next.toString();
      router.replace(query ? `/boards?${query}` : "/boards");
    }
  };

  const handleCopyBoard = async (boardId: string, openCopiedBoard = false) => {
    const copiedBoardId = await tasks.handleCopyBoard(boardId);
    if (!copiedBoardId || !openCopiedBoard) {
      return;
    }
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

  useEffect(() => {
    if (!workspaceOpen || !ticketParam) {
      if (openedTicketFromQuery !== null) {
        setOpenedTicketFromQuery(null);
      }
      return;
    }

    if (openedTicketFromQuery === ticketParam) {
      return;
    }

    if (!tasks.board.tickets[ticketParam]) {
      return;
    }

    tasks.openDetailsModal(ticketParam);
    setOpenedTicketFromQuery(ticketParam);
  }, [openedTicketFromQuery, tasks, ticketParam, workspaceOpen]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" initialUser={sidebarUser} />
      <SidebarInset>
        <header className="flex h-auto shrink-0 border-b transition-[width,height] ease-linear md:h-(--header-height) md:group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex w-full flex-col gap-2 px-3 py-2 sm:px-4 lg:px-6 md:flex-row md:items-center md:gap-2 md:py-0">
            <div className="flex items-center gap-1">
              <SidebarTrigger className="-ml-1" />
              {workspaceOpen && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={closeBoardWorkspace}
                  aria-label="Back to all boards"
                  title="All boards"
                  className="size-7 rounded-full border border-border/60 bg-background/70 text-muted-foreground shadow-xs transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:bg-accent hover:text-foreground hover:shadow-sm"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
              )}
              <Separator orientation="vertical" className="mx-2 hidden h-4 md:flex" />
              <span className="max-w-[220px] truncate text-sm font-medium">
                {workspaceOpen ? tasks.activeBoardName || "Boards" : "Boards"}
              </span>
            </div>

            <div className="flex w-full items-center gap-2 md:flex-1 md:justify-center md:px-4">
              <div className="relative min-w-0 flex-1 md:max-w-sm">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-9 pr-3 text-sm"
                  placeholder={workspaceOpen ? "Search tickets..." : "Search boards..."}
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
                <div className="flex items-center gap-1 md:hidden">
                  <Button
                    size="icon-sm"
                    onClick={() => tasks.openCreateModal(tasks.board.columnOrder[0] ?? "")}
                    aria-label="Create ticket"
                  >
                    <PlusIcon className="h-4 w-4" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Board actions">
                        <MoreHorizontalIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={tasks.openCreateListModal}>
                        Add list
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={tasks.openCreateBoardModal}>
                        Add board
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => tasks.openEditBoardModal(tasks.activeBoardId)}>
                        Edit board
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleCopyBoard(tasks.activeBoardId, true)}>
                        Copy board
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void handleDeleteBoard(tasks.activeBoardId)}
                      >
                        Delete board
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup
                        value={tasks.sort}
                        onValueChange={(value) => tasks.setSort(value as SortMode)}
                      >
                        {SORT_OPTIONS.map((option) => (
                          <DropdownMenuRadioItem key={option.key} value={option.key}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup
                        value={tasks.view}
                        onValueChange={(value) => tasks.setView(value as ViewMode)}
                      >
                        {VIEW_OPTIONS.map((option) => (
                          <DropdownMenuRadioItem key={option.key} value={option.key}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={tasks.openCreateBoardModal} className="md:hidden">
                  <PlusIcon className="h-4 w-4" />
                  Add board
                </Button>
              )}
            </div>

            <div className="hidden items-center gap-2 md:flex">
              {workspaceOpen ? (
                <>
                  <Button variant="outline" size="sm" onClick={tasks.openCreateBoardModal}>
                    <PlusIcon className="h-4 w-4" />
                    Add board
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">Board</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => tasks.openEditBoardModal(tasks.activeBoardId)}>
                        Edit board
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleCopyBoard(tasks.activeBoardId, true)}>
                        Copy board
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void handleDeleteBoard(tasks.activeBoardId)}
                      >
                        Delete board
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    size="sm"
                    className="ml-12"
                    onClick={() => tasks.openCreateModal(tasks.board.columnOrder[0] ?? "")}
                  >
                    <PlusIcon className="h-4 w-4" />
                    Create ticket
                  </Button>

                  <Button variant="outline" size="sm" onClick={tasks.openCreateListModal}>
                    <PlusIcon className="h-4 w-4" />
                    Add list
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                        <SlidersHorizontalIcon className="h-3.5 w-3.5" />
                        Filter
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuRadioGroup
                        value={tasks.sort}
                        onValueChange={(value) => tasks.setSort(value as SortMode)}
                      >
                        {SORT_OPTIONS.map((option) => (
                          <DropdownMenuRadioItem key={option.key} value={option.key}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground">
                        View
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuRadioGroup
                        value={tasks.view}
                        onValueChange={(value) => tasks.setView(value as ViewMode)}
                      >
                        {VIEW_OPTIONS.map((option) => (
                          <DropdownMenuRadioItem key={option.key} value={option.key}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={tasks.openCreateBoardModal}>
                  <PlusIcon className="h-4 w-4" />
                  Add board
                </Button>
              )}
            </div>
          </div>
        </header>

        {!workspaceOpen ? (
          <div className="flex flex-1 flex-col overflow-auto px-4 py-5 sm:px-5 lg:px-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">All boards</h2>
                <span className="text-xs text-muted-foreground">
                  {tasks.boards.length} board{tasks.boards.length !== 1 ? "s" : ""}
                </span>
              </div>
              {!!boardSearch.trim() && (
                <span className="text-xs text-muted-foreground">
                  {visibleBoards.length} result{visibleBoards.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {visibleBoards.length === 0 ? (
              <Empty className="min-h-56">
                <EmptyHeader>
                  <EmptyTitle>No boards found</EmptyTitle>
                  <EmptyDescription>No boards found for this search.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="overflow-hidden rounded-lg border">
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
                          "cursor-pointer transition-colors hover:bg-muted/40",
                          board.id === tasks.activeBoardId && "bg-muted/20",
                        )}
                        onClick={() => openBoardWorkspace(board.id)}
                      >
                        <TableCell className="font-medium">
                          <span className="truncate">{board.name}</span>
                        </TableCell>
                        <TableCell className="max-w-[360px]">
                          <p className="truncate text-sm text-muted-foreground">
                            {board.description || "No description yet."}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{board.totalTickets}</TableCell>
                        <TableCell className="text-sm tabular-nums">{board.listCount}</TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {board.createdAt ? new Date(board.createdAt).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {board.updatedAt ? new Date(board.updatedAt).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                          {board.lastTicketAt ? new Date(board.lastTicketAt).toLocaleString() : "No tasks yet"}
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
                                <DropdownMenuItem onClick={() => void handleCopyBoard(board.id)}>
                                  Copy board
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => void handleDeleteBoard(board.id)}
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2 sm:px-4 lg:px-6">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{tasks.activeBoardName}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tasks.totalVisible} ticket{tasks.totalVisible !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(() => {
                  const allTickets = Object.values(tasks.board.tickets);
                  const queued = allTickets.filter((ticket) => ticket.executionState === "queued").length;
                  const running = allTickets.filter(
                    (ticket) => ticket.executionState === "running" || ticket.executionState === "picked_up",
                  ).length;
                  const failed = allTickets.filter((ticket) => ticket.executionState === "failed").length;
                  const blocked = allTickets.filter(
                    (ticket) => (ticket.executionState === "pending" || ticket.executionState === "queued") && !ticket.assignedAgentId,
                  ).length;

                  return (
                    <>
                      <Badge variant="outline" className="text-[10px]">Queued: {queued}</Badge>
                      <Badge variant="outline" className="text-[10px]">Running: {running}</Badge>
                      <Badge variant="outline" className="text-[10px]">Failed: {failed}</Badge>
                      <Badge variant="outline" className="text-[10px]">Blocked: {blocked}</Badge>
                    </>
                  );
                })()}
              </div>
            </div>

            <div
              className={cn(
                "min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-4 lg:px-6",
                tasks.view === "kanban" && "overflow-x-auto",
              )}
            >
              {tasks.view === "kanban" && (
                <KanbanView
                  board={tasks.board}
                  assigneeById={tasks.assigneeById}
                  visibleTicketIdsByColumn={tasks.visibleTicketIdsByColumn}
                  onAddTask={tasks.openCreateModal}
                  canDeleteList={tasks.canDeleteList}
                  onDeleteList={tasks.handleDeleteList}
                  onTicketClick={tasks.openDetailsModal}
                  onTicketCopy={tasks.handleCopyTicket}
                  onTicketDelete={tasks.handleDeleteTicket}
                  moveColumn={tasks.moveColumn}
                  moveTicket={tasks.moveTicket}
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
            </div>
          </div>
        )}
      </SidebarInset>

      <TicketDetailsModal
        mode="create"
        open={tasks.modal === "create"}
        form={createTicketForm}
        board={tasks.board}
        assignees={tasks.assignees}
        attachments={[]}
        attachmentsLoading={false}
        attachmentsUploading={false}
        subtasks={[]}
        subtasksLoading={false}
        subtaskDraft=""
        onSubtaskDraftChange={() => {}}
        onAddSubtask={() => {}}
        onToggleSubtask={() => {}}
        onDeleteSubtask={() => {}}
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
            assignedAgentId: patch.assignedAgentId ?? prev.assignedAgentId,
            autoApprove: patch.autoApprove ?? prev.autoApprove,
          }))
        }
        onUploadAttachments={() => {}}
        onDeleteAttachment={() => {}}
        onSave={(files) => void tasks.handleCreateTicket(files ?? [])}
        onRetryNow={() => {}}
        onCancelExecution={() => {}}
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

      {tasks.detailsForm &&
        (() => {
          const detailsForm = tasks.detailsForm;
          return (
            <TicketDetailsModal
              open={tasks.modal === "details"}
              form={detailsForm}
              board={tasks.board}
              assignees={tasks.assignees}
              attachments={tasks.detailsAttachments}
              attachmentsLoading={tasks.detailsAttachmentsLoading}
              attachmentsUploading={tasks.detailsAttachmentsUploading}
              subtasks={tasks.detailsSubtasks}
              subtasksLoading={tasks.detailsSubtasksLoading}
              subtaskDraft={tasks.subtaskDraft}
              onSubtaskDraftChange={tasks.setSubtaskDraft}
              onAddSubtask={() => void tasks.addDetailsSubtask()}
              onToggleSubtask={(subtaskId, completed) =>
                void tasks.toggleDetailsSubtask(subtaskId, completed)
              }
              onDeleteSubtask={(subtaskId) => void tasks.deleteDetailsSubtask(subtaskId)}
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
              onSave={tasks.handleSaveDetails}
              onRetryNow={() => void tasks.executeDetailsControlAction("retry")}
              onCancelExecution={() => void tasks.executeDetailsControlAction("cancel")}
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
    </SidebarProvider>
  );
}
