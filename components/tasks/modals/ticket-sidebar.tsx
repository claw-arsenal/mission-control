"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TICKET_PRIORITY_OPTIONS } from "@/types/tasks";
import type {
  Assignee,
  Label as BoardLabelType,
  BoardState,
  TicketDetailsForm,
} from "@/types/tasks";
import { ChevronDownIcon } from "lucide-react";

/** Priority reads as severity, so it uses the status vocabulary: low is quiet, urgent is danger. */
const PRIORITY_DOT: Record<string, string> = {
  low: "bg-muted-foreground/60",
  medium: "bg-info",
  high: "bg-warning",
  urgent: "bg-danger",
};

type Props = {
  form: TicketDetailsForm;
  board: BoardState;
  labels: BoardLabelType[];
  assignees: Assignee[];
  onChange: (patch: Partial<TicketDetailsForm>) => void;
};

export function TicketSidebar({ form, board, labels, assignees, onChange }: Props) {
  const selectedAssignees = assignees.filter((a) => form.assigneeIds.includes(a.id));

  return (
    <div
      className={cn(
        "flex w-full shrink-0 flex-col gap-4 border-t border-line bg-surface-2 px-3 py-4",
        "md:w-[210px] md:overflow-y-auto md:border-t-0 md:border-l",
      )}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-list" className="eyebrow">List</Label>
        <Select value={form.statusId} onValueChange={(v) => onChange({ statusId: v })}>
          <SelectTrigger id="ticket-list" className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {board.columnOrder.map((colId) => (
              <SelectItem key={colId} value={colId}>{board.columns[colId]?.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-priority" className="eyebrow">Priority</Label>
        <Select
          value={form.priority}
          onValueChange={(v) => onChange({ priority: v as TicketDetailsForm["priority"] })}
        >
          <SelectTrigger id="ticket-priority" className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TICKET_PRIORITY_OPTIONS.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[o.key] ?? PRIORITY_DOT.low)}
                    aria-hidden
                  />
                  {o.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-due-date" className="eyebrow">Due date</Label>
        <Input
          id="ticket-due-date"
          type="date"
          value={(form.dueDate || form.scheduledFor || "").slice(0, 10)}
          onChange={(e) => onChange({ dueDate: e.target.value, scheduledFor: e.target.value })}
          className="h-8 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-tags" className="eyebrow">Tags</Label>
        <Input
          id="ticket-tags"
          value={form.tagsText}
          onChange={(e) => onChange({ tagsText: e.target.value })}
          placeholder="tag1, tag2…"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">Labels</span>
        {labels.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No labels on this board. Open <span className="font-medium text-foreground">Board ▸ Manage labels</span> to add some.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => {
              const selected = form.labelIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? form.labelIds.filter((id) => id !== l.id)
                      : [...form.labelIds, l.id];
                    onChange({ labelIds: next });
                  }}
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                    "transition-opacity duration-(--dur-fast) ease-(--ease-out)",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    selected ? "opacity-100 ring-2 ring-foreground/40 ring-offset-1" : "opacity-50 hover:opacity-80",
                  )}
                  /* Label colour is per-entity data, so it stays an inline style. */
                  style={{ backgroundColor: l.color, color: "#fff" }}
                  aria-pressed={selected}
                  title={selected ? `Remove ${l.name}` : `Add ${l.name}`}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">Assignees</span>
        {assignees.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No assignees on this board. Open <span className="font-medium text-foreground">Board ▸ Manage assignees</span> to add some.
          </p>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-auto w-full justify-start px-2.5 py-1.5 text-left text-xs font-normal"
                aria-label="Assign people"
              >
                {selectedAssignees.length === 0 ? (
                  <span className="text-muted-foreground">Assign people…</span>
                ) : (
                  <span className="flex flex-1 flex-wrap items-center gap-1.5">
                    {selectedAssignees.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1">
                        {/* Assignee colour is per-entity data, so it stays an inline style. */}
                        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: a.color }} />
                        <span className="max-w-[120px] truncate">{a.name}</span>
                      </span>
                    ))}
                  </span>
                )}
                <ChevronDownIcon className="ml-auto size-3 text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[260px]">
              {assignees.map((a) => {
                const checked = form.assigneeIds.includes(a.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={a.id}
                    checked={checked}
                    onCheckedChange={() => {
                      const next = checked
                        ? form.assigneeIds.filter((id) => id !== a.id)
                        : [...form.assigneeIds, a.id];
                      onChange({ assigneeIds: next });
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: a.color }} />
                      <span className="truncate">{a.name}</span>
                      {a.email && <span className="ml-auto truncate text-2xs text-muted-foreground">{a.email}</span>}
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
