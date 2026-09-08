"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Assignee, type BoardState, type Label, type Ticket } from "@/types/tasks";
import type { CardDensity } from "@/hooks/use-tasks";
import { useLocalStorageValue } from "@/hooks/use-local-storage-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyFooter, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ColumnsIcon, KeyboardIcon, PlusIcon } from "lucide-react";
import { KanbanColumn } from "./kanban-column";
import { TicketCard } from "../shared/ticket-card";
import { KANBAN_SHORTCUTS, useKanbanShortcuts } from "./use-kanban-shortcuts";

type Props = {
  /** Identifies the board so per-board preferences (collapsed lists) can be remembered. */
  boardId?: string;
  ticketDraggingDisabled?: boolean;
  board: BoardState;
  assigneeById: Record<string, Assignee>;
  labelById?: Record<string, Label>;
  visibleTicketIdsByColumn: Record<string, string[]>;
  density?: CardDensity;
  onAddTask: (statusId: string) => void;
  onAddList?: () => void;
  /** Title-only creation from a list's inline composer. Resolves true once saved. */
  onQuickAddTicket?: (columnId: string, title: string) => Promise<boolean>;
  onRenameList?: (columnId: string, title: string) => Promise<boolean> | void;
  onFocusSearch?: () => void;
  canDeleteList: (columnId: string) => boolean;
  onDeleteList: (columnId: string) => void;
  onTicketClick: (ticketId: string) => void;
  onTicketCopy: (ticketId: string) => void;
  onTicketDelete: (ticketId: string) => void;
  moveColumn: (activeId: string, overId: string) => void;
  moveTicket: (
    ticketId: string,
    fromColumnId: string,
    toColumnId: string,
    toIndex: number,
    persist?: boolean,
    persistFromColumnId?: string,
  ) => void;
};

const collapsedStorageKey = (boardId: string) => `mc:kanban:collapsed:${boardId}`;

/** Remembers which lists a reader has collapsed on a given board. */
function useCollapsedColumns(boardId: string | undefined) {
  const [stored, store] = useLocalStorageValue(boardId ? collapsedStorageKey(boardId) : null);

  const collapsed = useMemo(() => {
    try {
      const ids: unknown = stored ? JSON.parse(stored) : [];
      return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [stored]);

  const toggle = useCallback((columnId: string) => {
    const next = new Set(collapsed);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    store(JSON.stringify([...next]));
  }, [collapsed, store]);

  return { collapsed, toggle };
}

/**
 * Tracks whether a horizontal scroller has more content to either side.
 *
 * Observes the scroller and its content, so lists appearing, collapsing or
 * paging in update the edges without the caller listing dependencies.
 */
function useScrollEdges(scroller: HTMLElement | null) {
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    if (!scroller) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = scroller;
      const left = scrollLeft > 2;
      const right = scrollLeft + clientWidth < scrollWidth - 2;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(scroller);
    for (const child of scroller.children) resize?.observe(child);
    const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mutation?.observe(scroller, { childList: true });
    return () => {
      scroller.removeEventListener("scroll", update);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [scroller]);

  return edges;
}

export function KanbanView({
  boardId,
  board,
  assigneeById,
  visibleTicketIdsByColumn,
  labelById,
  density = "comfortable",
  onAddTask,
  onAddList,
  onQuickAddTicket,
  onRenameList,
  onFocusSearch,
  canDeleteList,
  onDeleteList,
  onTicketClick,
  onTicketCopy,
  onTicketDelete,
  moveColumn,
  moveTicket,
  ticketDraggingDisabled = false,
}: Props) {
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [dragStartTicketColumnId, setDragStartTicketColumnId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ ticketId: string; columnId: string } | null>(null);
  const [composerColumnId, setComposerColumnId] = useState<string | null>(null);
  const [composerBoardId, setComposerBoardId] = useState(boardId);
  // Switching boards closes any open composer so it never carries over.
  if (composerBoardId !== boardId) {
    setComposerBoardId(boardId);
    setComposerColumnId(null);
  }
  const [helpOpen, setHelpOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { collapsed, toggle: toggleCollapsed } = useCollapsedColumns(boardId);
  const edges = useScrollEdges(scroller);

  // A hover is a preview, not a board mutation. Only a completed drop is saved.
  const previewIds = useMemo(() => {
    if (!preview) return visibleTicketIdsByColumn;
    const ids = Object.fromEntries(Object.entries(visibleTicketIdsByColumn)
      .map(([columnId, tickets]) => [columnId, tickets.filter((id) => id !== preview.ticketId)]));
    ids[preview.columnId] = [...(ids[preview.columnId] ?? []), preview.ticketId];
    return ids;
  }, [preview, visibleTicketIdsByColumn]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const openComposer = useCallback((columnId: string) => {
    if (collapsed.has(columnId)) toggleCollapsed(columnId);
    setComposerColumnId(columnId);
  }, [collapsed, toggleCollapsed]);

  const firstOpenColumnId = board.columnOrder.find((id) => !collapsed.has(id)) ?? board.columnOrder[0];
  const shortcutHandlers = useMemo(() => ({
    onNewTicket: firstOpenColumnId ? () => openComposer(firstOpenColumnId) : undefined,
    onFocusSearch,
    onToggleHelp: () => setHelpOpen((open) => !open),
  }), [firstOpenColumnId, openComposer, onFocusSearch]);
  useKanbanShortcuts(shortcutHandlers);

  const getColumnIdFromOver = (overId: string, overData: Record<string, unknown> | undefined): string | null => {
    if (overData?.type === "ticket") {
      if (preview?.ticketId === overId) return preview.columnId;
      return overData.columnId as string;
    }

    if (overData?.type === "column" || board.columns[overId]) {
      return overId;
    }

    const sortableContainerId = overData?.sortable && typeof overData.sortable === "object"
      ? (overData.sortable as { containerId?: unknown }).containerId
      : undefined;

    if (typeof sortableContainerId === "string" && board.columns[sortableContainerId]) {
      return sortableContainerId;
    }

    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setPreview(null);
    const { active } = event;
    const data = active.data.current;
    if (data?.type === "ticket") {
      setActiveTicket(board.tickets[active.id as string] ?? null);
      setDragStartTicketColumnId(data.columnId as string);
    } else if (data?.type === "column") {
      setActiveColumnId(active.id as string);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current as Record<string, unknown> | undefined;

    if (activeData?.type !== "ticket") return;

    const ticketId = active.id as string;
    const toColumnId = getColumnIdFromOver(over.id as string, overData);
    if (!toColumnId || toColumnId === (preview?.columnId ?? dragStartTicketColumnId)) return;
    setPreview({ ticketId, columnId: toColumnId });
  };

  const resetDrag = () => {
    setActiveTicket(null);
    setActiveColumnId(null);
    setDragStartTicketColumnId(null);
    setPreview(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      resetDrag();
      return;
    }

    const activeData = active.data.current;
    const overData = over.data.current as Record<string, unknown> | undefined;

    if (activeData?.type === "column") {
      const overId = over.id as string;
      const overColumnId = getColumnIdFromOver(overId, overData);

      if (overColumnId && active.id !== overColumnId) {
        moveColumn(active.id as string, overColumnId);
      }
    }

    if (activeData?.type === "ticket") {
      const toColumnId = getColumnIdFromOver(over.id as string, overData);
      const sourceColumnId = dragStartTicketColumnId ?? activeData.columnId as string;

      if (toColumnId && overData?.type === "ticket" && active.id !== over.id) {
        const ids = board.ticketIdsByColumn[toColumnId] ?? [];
        const toIndex = ids.indexOf(over.id as string);
        if (toIndex >= 0) {
          moveTicket(
            active.id as string,
            sourceColumnId,
            toColumnId,
            toIndex,
            true,
          );
        }
      } else if (toColumnId) {
        const ids = board.ticketIdsByColumn[toColumnId] ?? [];
        const currentIndex = ids.indexOf(active.id as string);
        const toIndex = currentIndex >= 0 ? currentIndex : ids.length;
        moveTicket(
          active.id as string,
          sourceColumnId,
          toColumnId,
          toIndex,
          true,
        );
      }
    }

    resetDrag();
  };

  const hasColumns = board.columnOrder.length > 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const targets = args.active.data.current?.type === "column"
          ? args.droppableContainers.filter(container => container.data.current?.type === "column")
          : args.droppableContainers;
        const scopedArgs = { ...args, droppableContainers: targets };
        if (!args.pointerCoordinates) return closestCorners(scopedArgs);
        const hits = pointerWithin(scopedArgs);
        const ticketHits = hits.filter(hit => hit.data?.droppableContainer.data.current?.type === "ticket");
        return ticketHits.length ? ticketHits : hits;
      }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDrag}
    >
      <SortableContext items={board.columnOrder} strategy={horizontalListSortingStrategy}>
        <div className="flex h-full min-h-0 flex-col">
          {!hasColumns ? (
            <Empty className="m-1 flex-1 border-line bg-surface-2/60">
              <EmptyHeader>
                <ColumnsIcon className="mx-auto mb-2 size-8 text-muted-foreground/50" />
                <EmptyTitle>This board has no lists yet</EmptyTitle>
                <EmptyDescription>Lists hold tickets as they move through your workflow. Start with something like “To do”, “Doing” and “Done”.</EmptyDescription>
              </EmptyHeader>
              {onAddList && (
                <EmptyFooter>
                  <Button size="sm" onClick={onAddList}>
                    <PlusIcon />
                    Add list
                  </Button>
                </EmptyFooter>
              )}
            </Empty>
          ) : (
            <div className="relative min-h-0 flex-1">
              {/* Edge fades hint at lists beyond the viewport without hiding anything */}
              <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-background to-transparent transition-opacity duration-(--dur-base)", edges.left ? "opacity-100" : "opacity-0")} />
              <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent transition-opacity duration-(--dur-base)", edges.right ? "opacity-100" : "opacity-0")} />
              <div
                ref={setScroller}
                className="mc-scrollbar flex h-full min-h-0 items-stretch gap-3 overflow-x-auto overflow-y-hidden px-1 pt-1 pb-3"
              >
                {board.columnOrder.map((colId) => {
                  const column = board.columns[colId];
                  if (!column) return null;
                  const visibleIds = previewIds[colId] ?? [];
                  const tickets = visibleIds.map((id) => board.tickets[id]).filter(Boolean)
                    .map((ticket) => ticket.id === preview?.ticketId ? { ...ticket, statusId: colId } : ticket);

                  return (
                    <KanbanColumn
                      key={colId}
                      column={column}
                      tickets={tickets}
                      allTicketIds={visibleIds}
                      assigneeById={assigneeById}
                      labelById={labelById}
                      density={density}
                      isActive={activeColumnId === colId}
                      ticketDraggingDisabled={ticketDraggingDisabled}
                      pinnedTicketId={preview?.columnId === colId ? preview.ticketId : null}
                      resetKey={boardId}
                      collapsed={collapsed.has(colId)}
                      onToggleCollapse={() => toggleCollapsed(colId)}
                      composerOpen={composerColumnId === colId}
                      onComposerOpenChange={(open) => {
                        if (open) openComposer(colId);
                        else setComposerColumnId((current) => (current === colId ? null : current));
                      }}
                      onQuickAdd={(title) => onQuickAddTicket ? onQuickAddTicket(colId, title) : Promise.resolve(false)}
                      onOpenFullEditor={() => {
                        setComposerColumnId(null);
                        onAddTask(colId);
                      }}
                      onRename={(title) => onRenameList?.(colId, title)}
                      canDeleteList={canDeleteList(colId)}
                      onDeleteList={() => void onDeleteList(colId)}
                      onTicketClick={onTicketClick}
                      onTicketCopy={onTicketCopy}
                      onTicketDelete={onTicketDelete}
                    />
                  );
                })}

                {onAddList && (
                  <button
                    type="button"
                    onClick={onAddList}
                    className="flex h-12 w-[280px] shrink-0 items-center justify-center gap-2 self-start rounded-2xl border border-dashed border-line-strong bg-surface-2/60 text-sm text-muted-foreground transition-colors duration-(--dur-base) hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <PlusIcon className="size-4" />
                    Add list
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 px-1 pt-1 text-2xs text-muted-foreground">
            <p>
              {ticketDraggingDisabled
                ? "Choose Manual order in View settings to drag tickets. You can change a ticket’s list in its details."
                : "Drag cards between lists, or press n to add a ticket."}
            </p>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Keyboard shortcuts"
            >
              <KeyboardIcon className="size-3.5" />
              <kbd className="rounded border border-line bg-surface-1 px-1 font-sans text-2xs">?</kbd>
            </button>
          </div>
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {activeTicket ? (
          <div aria-hidden="true" inert className={cn("w-[264px] rounded-xl shadow-elev-3", !reduceMotion && "rotate-1 scale-[1.02]")}>
            <TicketCard ticket={activeTicket} assigneeById={assigneeById} labelById={labelById} dense={density === "compact"} onClick={() => {}} />
          </div>
        ) : activeColumnId ? (
          <div aria-hidden="true" inert className={cn("w-[280px] rounded-2xl shadow-elev-3 opacity-95", !reduceMotion && "rotate-1")}>
            <Card className="gap-0 overflow-hidden rounded-2xl py-0">
              <CardContent className="border-b border-line bg-surface-2 px-3 py-2.5">
                <span className="text-sm font-semibold">
                  {board.columns[activeColumnId]?.title}
                </span>
              </CardContent>
              <CardContent className="flex flex-col gap-2 bg-surface-2/60 p-2">
                {(visibleTicketIdsByColumn[activeColumnId] ?? [])
                  .slice(0, 3)
                  .map((id) => board.tickets[id])
                  .filter(Boolean)
                  .map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      assigneeById={assigneeById}
                      labelById={labelById}
                      dense
                      onClick={() => {}}
                    />
                  ))}
                {(visibleTicketIdsByColumn[activeColumnId] ?? []).length === 0 && (
                  <div className="flex h-16 items-center justify-center rounded-xl border border-dashed border-line-strong text-xs text-muted-foreground">
                    Nothing here yet
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </DragOverlay>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Shortcuts work while nothing on the board has focus.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {KANBAN_SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="contents">
                <dt>
                  <kbd className="inline-flex min-w-6 justify-center rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-sans text-xs text-foreground">
                    {shortcut.keys}
                  </kbd>
                </dt>
                <dd className="text-muted-foreground">{shortcut.description}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}
