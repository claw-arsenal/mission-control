"use client";

import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type Assignee, type Column, type Label, type Ticket, toneColor } from "@/types/tasks";
import type { CardDensity } from "@/hooks/use-tasks";
import { ChevronsLeftRightIcon, ChevronsRightLeftIcon, MoreHorizontalIcon, PencilLineIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { TicketCard } from "../shared/ticket-card";
import { QuickAddComposer } from "./quick-add-composer";
import { useProgressiveList } from "./use-progressive-list";

type Props = {
  column: Column;
  /** Tickets to show, already filtered and ordered. */
  tickets: Ticket[];
  allTicketIds: string[];
  assigneeById: Record<string, Assignee>;
  labelById?: Record<string, Label>;
  density: CardDensity;
  isActive?: boolean;
  ticketDraggingDisabled?: boolean;
  /** A ticket that must stay rendered regardless of paging (the one being dragged in). */
  pinnedTicketId?: string | null;
  /** Changing this returns the list to its first page. */
  resetKey?: unknown;
  collapsed: boolean;
  onToggleCollapse: () => void;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
  onQuickAdd: (title: string) => Promise<boolean>;
  onOpenFullEditor: () => void;
  onRename: (title: string) => Promise<boolean> | void;
  canDeleteList: boolean;
  onDeleteList: () => void;
  onTicketClick: (ticketId: string) => void;
  onTicketCopy: (ticketId: string) => void;
  onTicketDelete: (ticketId: string) => void;
};

export function KanbanColumn({
  column,
  tickets,
  allTicketIds,
  assigneeById,
  labelById,
  density,
  isActive,
  ticketDraggingDisabled,
  pinnedTicketId,
  resetKey,
  collapsed,
  onToggleCollapse,
  composerOpen,
  onComposerOpenChange,
  onQuickAdd,
  onOpenFullEditor,
  onRename,
  canDeleteList,
  onDeleteList,
  onTicketClick,
  onTicketCopy,
  onTicketDelete,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isOver,
    isDragging: isColumnDragging,
  } = useSortable({ id: column.id, data: { type: "column" } });

  const [renaming, setRenaming] = useState(false);
  const { visibleCount, hasMore, hiddenCount, attachSentinel, revealMore } = useProgressiveList(tickets.length, { resetKey });
  const bodyRef = useRef<HTMLDivElement>(null);

  // A freshly opened composer sits at the foot of the list: bring it into view.
  useEffect(() => {
    if (composerOpen && !collapsed) {
      const body = bodyRef.current;
      if (body && typeof body.scrollTo === "function") body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    }
  }, [composerOpen, collapsed]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const rendered = tickets.slice(0, visibleCount);
  if (pinnedTicketId && !rendered.some((ticket) => ticket.id === pinnedTicketId)) {
    const pinned = tickets.find((ticket) => ticket.id === pinnedTicketId);
    if (pinned) rendered.push(pinned);
  }

  const dropHighlight = isOver && !isColumnDragging;

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex h-full w-11 shrink-0 flex-col items-center gap-2 rounded-2xl border border-line bg-surface-2 py-2 transition-[box-shadow,background-color] duration-(--dur-base) ease-(--ease-out)",
          isColumnDragging && "opacity-40",
          dropHighlight && "bg-primary/5 ring-2 ring-primary/40",
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Move list ${column.title}`}
          className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground touch-none hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
        >
          <span className={cn("size-2 rounded-full", toneColor[column.tone])} />
        </button>
        <span className="rounded-full bg-background px-1.5 py-0.5 text-2xs font-medium tabular-nums text-muted-foreground ring-1 ring-line">
          {tickets.length}
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={`Expand list ${column.title}`}
          title="Expand list"
          className="flex min-h-0 flex-1 items-start justify-center rounded-md px-1 py-2 hover:bg-surface-hover"
        >
          <span className="max-h-full truncate text-xs font-semibold text-foreground [writing-mode:vertical-rl] rotate-180">
            {column.title}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex max-h-full w-[280px] shrink-0 flex-col rounded-2xl border border-line bg-surface-2 transition-[box-shadow,background-color,opacity] duration-(--dur-base) ease-(--ease-out)",
        isActive && "ring-2 ring-primary/20",
        isColumnDragging && "opacity-40",
        dropHighlight && "bg-primary/5 ring-2 ring-primary/40",
      )}
    >
      {/* Header: the title doubles as the list's drag handle */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1.5">
        <span className={cn("ml-1 size-2 shrink-0 rounded-full", toneColor[column.tone])} aria-hidden />
        {renaming ? (
          <InlineTitleEditor
            initialValue={column.title}
            onCommit={async (value) => {
              setRenaming(false);
              if (value !== column.title) await onRename(value);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Move list ${column.title}`}
            title="Drag to reorder · double-click to rename"
            onDoubleClick={() => setRenaming(true)}
            className="min-w-0 flex-1 cursor-grab truncate rounded px-1 py-0.5 text-left text-sm font-semibold text-foreground touch-none focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
          >
            {column.title}
          </button>
        )}
        <span
          className="rounded-full bg-background px-1.5 py-0.5 text-2xs font-medium tabular-nums text-muted-foreground ring-1 ring-line"
          aria-label={`${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
        >
          {tickets.length}
        </span>
        <div className="flex items-center" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={`Collapse list ${column.title}`}
            title="Collapse list"
            onClick={onToggleCollapse}
          >
            <ChevronsRightLeftIcon />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Actions for ${column.title}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onComposerOpenChange(true)}>
                <PlusIcon className="size-3.5 text-muted-foreground" />
                Add ticket
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilLineIcon className="size-3.5 text-muted-foreground" />
                Rename list
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleCollapse}>
                <ChevronsLeftRightIcon className="size-3.5 text-muted-foreground" />
                Collapse list
              </DropdownMenuItem>
              {canDeleteList ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onDeleteList}>
                    <Trash2Icon className="size-3.5" />
                    Delete list
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Body: its own scroll viewport so long lists page in as the reader scrolls */}
      <div ref={bodyRef} className="mc-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        <SortableContext items={allTicketIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {tickets.length === 0 && !composerOpen ? (
              <div
                className={cn(
                  "flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong px-3 text-center transition-colors duration-(--dur-base)",
                  dropHighlight && "border-primary/60 bg-primary/5",
                )}
              >
                <p className="text-xs font-medium text-foreground/80">{dropHighlight ? "Release to move here" : "Nothing here yet"}</p>
                {!dropHighlight && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => onComposerOpenChange(true)}
                  >
                    Add the first ticket
                  </button>
                )}
              </div>
            ) : (
              rendered.map((ticket) => (
                <SortableTicket
                  key={ticket.id}
                  ticket={ticket}
                  assigneeById={assigneeById}
                  labelById={labelById}
                  dense={density === "compact"}
                  onClick={() => onTicketClick(ticket.id)}
                  onCopy={() => onTicketCopy(ticket.id)}
                  onDelete={() => onTicketDelete(ticket.id)}
                  disabled={ticketDraggingDisabled}
                />
              ))
            )}

            {hasMore && (
              <div ref={attachSentinel} className="flex flex-col gap-2 pt-1" aria-live="polite">
                <Skeleton className="h-16 rounded-xl bg-surface-1/70" />
                <div className="flex items-center justify-between px-1 text-2xs text-muted-foreground">
                  <span>{visibleCount} of {tickets.length} shown</span>
                  <button type="button" className="font-medium hover:text-foreground" onClick={revealMore}>
                    Show {Math.min(hiddenCount, 25)} more
                  </button>
                </div>
              </div>
            )}

            {composerOpen && (
              <QuickAddComposer
                listTitle={column.title}
                onSubmit={onQuickAdd}
                onClose={() => onComposerOpenChange(false)}
                onOpenFullEditor={onOpenFullEditor}
              />
            )}
          </div>
        </SortableContext>
      </div>

      {/* Footer */}
      {!composerOpen && (
        <div className="px-2 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start px-2 text-xs text-muted-foreground hover:text-foreground"
            aria-label={`Add ticket to ${column.title}`}
            onClick={() => onComposerOpenChange(true)}
          >
            <PlusIcon className="size-3.5" />
            Add ticket
          </Button>
        </div>
      )}
    </div>
  );
}

function InlineTitleEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const settledRef = useRef(false);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const trimmed = value.trim();
    if (!trimmed) onCancel();
    else void onCommit(trimmed);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <Input
      autoFocus
      aria-label="List name"
      value={value}
      maxLength={80}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        else if (event.key === "Escape") { event.preventDefault(); cancel(); }
      }}
      className="h-7 min-w-0 flex-1 px-1.5 text-sm font-semibold"
    />
  );
}

function SortableTicket({
  ticket,
  assigneeById,
  labelById,
  dense,
  onClick,
  onCopy,
  onDelete,
  disabled,
}: {
  ticket: Ticket;
  assigneeById: Record<string, Assignee>;
  labelById?: Record<string, Label>;
  dense: boolean;
  onClick: () => void;
  onCopy: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id, disabled, data: { type: "ticket", columnId: ticket.statusId } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-0")}>
      <TicketCard
        ticket={ticket}
        assigneeById={assigneeById}
        labelById={labelById}
        dense={dense}
        onClick={onClick}
        onCopy={onCopy}
        onDelete={onDelete}
        isDragging={isDragging}
        dragHandleProps={disabled ? undefined : { ...attributes, ...listeners, ref: setActivatorNodeRef }}
      />
    </div>
  );
}
