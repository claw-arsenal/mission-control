"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Assignee, type Label, type Ticket, formatDue } from "@/types/tasks";
import { cn } from "@/lib/utils";
import {
  CalendarIcon,
  CheckSquareIcon,
  FileTextIcon,
  GripVerticalIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
} from "lucide-react";

type Props = {
  ticket: Ticket;
  assigneeById: Record<string, Assignee>;
  labelById?: Record<string, Label>;
  onClick: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  /** Compact cards hide the description and tighten spacing. */
  dense?: boolean;
  dragHandleProps?: React.ComponentProps<"button">;
  isDragging?: boolean;
};

/** Priority reads as severity, so it uses the status vocabulary: low is quiet, urgent is danger. */
const priorityConfig: Record<Ticket["priority"], { dot: string; label: string }> = {
  low:    { dot: "bg-muted-foreground/60", label: "text-muted-foreground" },
  medium: { dot: "bg-info",    label: "text-info-fg" },
  high:   { dot: "bg-warning", label: "text-warning-fg" },
  urgent: { dot: "bg-danger",  label: "text-danger-fg" },
};

const priorityLabel = (p: Ticket["priority"]) => p.charAt(0).toUpperCase() + p.slice(1);

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** How a due date should read against today: past due, due today, or simply scheduled. */
export const dueUrgency = (dueDate: string | null, today = localDateKey(new Date())): "overdue" | "today" | "later" | null => {
  if (!dueDate) return null;
  const key = dueDate.slice(0, 10);
  if (key < today) return "overdue";
  if (key === today) return "today";
  return "later";
};

const dueToneClass = {
  overdue: "text-danger-fg font-medium",
  today: "text-warning-fg font-medium",
  later: "",
} as const;

export function TicketCard({
  ticket,
  assigneeById,
  labelById,
  onClick,
  onCopy,
  onDelete,
  dense,
  dragHandleProps,
  isDragging,
}: Props) {
  const ticketLabels = (ticket.labelIds ?? [])
    .map((id) => labelById?.[id])
    .filter(Boolean) as Label[];
  const visibleAssignees = ticket.assigneeIds.slice(0, 3);
  const extra = ticket.assigneeIds.length - visibleAssignees.length;
  const shortDesc = ticket.description?.trim().replace(/\s+/g, " ") ?? "";
  const descPreview = shortDesc.length > 110 ? `${shortDesc.slice(0, 110)}…` : shortDesc;
  const cfg = priorityConfig[ticket.priority] ?? priorityConfig.low;
  const documentsCount = ticket.documentsCount ?? 0;
  const urgency = dueUrgency(ticket.dueDate);
  const checklistComplete = ticket.checklistTotal > 0 && ticket.checklistDone === ticket.checklistTotal;
  const hasMeta =
    ticket.dueDate ||
    ticket.checklistTotal > 0 ||
    ticket.comments > 0 ||
    ticket.attachments > 0 ||
    documentsCount > 0;

  return (
    <Card
      role="article"
      aria-label={ticket.title}
      className={cn(
        "group relative cursor-pointer select-none gap-0 rounded-xl border-line bg-card py-0 shadow-elev-1",
        "transition-[transform,box-shadow,border-color] duration-(--dur-base) ease-(--ease-out)",
        "hover:-translate-y-px hover:border-line-strong hover:shadow-elev-2",
        "focus-within:border-ring/60",
        isDragging && "opacity-40 shadow-elev-3",
      )}
      onClick={onClick}
    >
      <CardContent className={cn("flex flex-col", dense ? "gap-1.5 p-2.5" : "gap-2 p-3")}>
        {/* Row 1: priority, labels, tags, actions */}
        <div className="flex items-start justify-between gap-1.5">
          <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-1 pt-0.5">
            <span className={cn("flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide", cfg.label)}>
              <span className={cn("size-1.5 shrink-0 rounded-full", cfg.dot)} />
              {priorityLabel(ticket.priority)}
            </span>
            {ticketLabels.slice(0, dense ? 2 : 4).map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs font-medium text-foreground/80"
                title={l.name}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                {l.name}
              </span>
            ))}
            {ticketLabels.length > (dense ? 2 : 4) && (
              <span className="text-2xs text-muted-foreground/70">+{ticketLabels.length - (dense ? 2 : 4)}</span>
            )}
            {!dense && ticket.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="h-4 rounded-full px-1.5 py-0 text-2xs font-normal">
                {tag}
              </Badge>
            ))}
            {!dense && ticket.tags.length > 2 && (
              <span className="text-2xs text-muted-foreground/70">+{ticket.tags.length - 2}</span>
            )}
          </div>

          {/* Actions surface on hover or focus so the resting card stays quiet */}
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="-mr-1 -mt-1 flex shrink-0 items-center opacity-60 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {dragHandleProps && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="cursor-grab text-muted-foreground touch-none active:cursor-grabbing"
                {...dragHandleProps}
                aria-label={`Move ${ticket.title}`}
              >
                <GripVerticalIcon />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Actions for ${ticket.title}`}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onClick}>Open</DropdownMenuItem>
                {onCopy && <DropdownMenuItem onClick={onCopy}>Copy ticket</DropdownMenuItem>}
                {onDelete && (
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Title */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className={cn(
            "rounded text-left text-sm font-semibold leading-snug break-words text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            dense ? "line-clamp-2" : "line-clamp-3",
          )}
        >
          {ticket.title}
        </button>

        {/* Description preview */}
        {!dense && descPreview && (
          <p className="line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
            {descPreview}
          </p>
        )}

        {/* Footer: assignees + meta */}
        {(visibleAssignees.length > 0 || hasMeta) && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center -space-x-1.5">
              {visibleAssignees.map((id) => {
                const a = assigneeById[id];
                if (!a) return null;
                return (
                  <Avatar key={id} className="size-5 border-2 border-card" title={a.name}>
                    <AvatarFallback style={{ backgroundColor: a.color }} className="text-2xs text-white">
                      {a.initials}
                    </AvatarFallback>
                  </Avatar>
                );
              })}
              {extra > 0 && (
                <Avatar className="size-5 border-2 border-card">
                  <AvatarFallback className="bg-muted text-2xs text-muted-foreground">+{extra}</AvatarFallback>
                </Avatar>
              )}
            </div>

            <div className="flex items-center gap-2 text-2xs tabular-nums text-muted-foreground/80">
              {ticket.dueDate && urgency && (
                <span
                  className={cn("flex items-center gap-1", dueToneClass[urgency])}
                  title={urgency === "overdue" ? "Past due" : urgency === "today" ? "Due today" : "Due date"}
                >
                  <CalendarIcon className="size-3" />
                  {formatDue(ticket.dueDate)}
                </span>
              )}
              {ticket.checklistTotal > 0 && (
                <span className={cn("flex items-center gap-1", checklistComplete && "text-success-fg")} title="Checklist">
                  <CheckSquareIcon className="size-3" />
                  {ticket.checklistDone}/{ticket.checklistTotal}
                </span>
              )}
              {ticket.comments > 0 && (
                <span className="flex items-center gap-1" title="Comments">
                  <MessageSquareIcon className="size-3" />
                  {ticket.comments}
                </span>
              )}
              {ticket.attachments > 0 && (
                <span className="flex items-center gap-1" title="Attachments">
                  <PaperclipIcon className="size-3" />
                  {ticket.attachments}
                </span>
              )}
              {documentsCount > 0 && (
                <span className="flex items-center gap-1" title="Linked documents & links">
                  <FileTextIcon className="size-3" />
                  {documentsCount}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
