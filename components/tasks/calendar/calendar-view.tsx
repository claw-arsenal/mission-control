"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Assignee, Label, Ticket } from "@/types/tasks";
import { cn } from "@/lib/utils";

type Props = {
  tickets: Ticket[];
  assigneeById: Record<string, Assignee>;
  labelById?: Record<string, Label>;
  onTicketClick: (ticketId: string) => void;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

/** Priority reads as severity, so it uses the status vocabulary: low is quiet, urgent is danger. */
const PRIORITY_DOT: Record<Ticket["priority"], string> = {
  low: "bg-muted-foreground/60",
  medium: "bg-info",
  high: "bg-warning",
  urgent: "bg-danger",
};

function priorityDotClass(p: Ticket["priority"]): string {
  return PRIORITY_DOT[p] ?? PRIORITY_DOT.low;
}

const longDate = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function CalendarView({ tickets, labelById, onTicketClick }: Props) {
  const today = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);
  const [cursor, setCursor] = useState<Date>(today);
  const gridRef = useRef<HTMLDivElement>(null);

  const { year, month } = useMemo(() => ({ year: cursor.getFullYear(), month: cursor.getMonth() }), [cursor]);

  const ticketsByDay = useMemo(() => {
    const out: Record<string, Ticket[]> = {};
    for (const t of tickets) {
      if (!t.dueDate) continue;
      if (!out[t.dueDate]) out[t.dueDate] = [];
      out[t.dueDate].push(t);
    }
    return out;
  }, [tickets]);

  // Build a 6-row grid (42 days) starting at the Monday on or before the first day of the month.
  const cells = useMemo(() => {
    const first = startOfMonth(year, month);
    const dayOfWeek = (first.getDay() + 6) % 7; // 0=Mon
    const start = new Date(year, month, 1 - dayOfWeek);
    const arr: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      arr.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return arr;
  }, [year, month]);

  const monthLabel = useMemo(
    () => new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" }),
    [year, month],
  );

  const todayKey = dateKey(today);

  // Roving tab stop: one cell in the grid is tabbable, arrow keys move between them.
  const [focusedKey, setFocusedKey] = useState<string>(todayKey);
  const cellKeys = useMemo(() => cells.map(dateKey), [cells]);
  const defaultKey = useMemo(
    () => (cellKeys.includes(todayKey) ? todayKey : dateKey(startOfMonth(year, month))),
    [cellKeys, todayKey, year, month],
  );
  const activeKey = cellKeys.includes(focusedKey) ? focusedKey : defaultKey;

  const monthTicketCount = useMemo(
    () =>
      cellKeys.reduce((acc, key, i) => (cells[i].getMonth() === month ? acc + (ticketsByDay[key]?.length ?? 0) : acc), 0),
    [cellKeys, cells, month, ticketsByDay],
  );

  const goPrev = () => setCursor(new Date(year, month - 1, 1));
  const goNext = () => setCursor(new Date(year, month + 1, 1));
  const goToday = () => { setCursor(today); setFocusedKey(todayKey); };

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
      const deltas: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      let nextIndex: number | null = null;
      if (event.key in deltas) nextIndex = index + deltas[event.key];
      else if (event.key === "Home") nextIndex = index - (index % 7);
      else if (event.key === "End") nextIndex = index - (index % 7) + 6;
      if (nextIndex === null) return;
      if (nextIndex < 0 || nextIndex >= cellKeys.length) return;
      event.preventDefault();
      const nextKey = cellKeys[nextIndex];
      setFocusedKey(nextKey);
      gridRef.current?.querySelector<HTMLElement>(`[data-day="${nextKey}"]`)?.focus();
    },
    [cellKeys],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Month header */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{monthLabel}</h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {monthTicketCount} dated {monthTicketCount === 1 ? "ticket" : "tickets"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={goPrev} aria-label="Previous month">
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button variant="outline" size="xs" onClick={goToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={goNext} aria-label="Next month">
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      {monthTicketCount === 0 && (
        <Empty className="min-h-0 rounded-none border-x-0 border-t-0 border-line px-3 py-4">
          <EmptyHeader>
            <EmptyTitle className="text-sm">Nothing due in {monthLabel}</EmptyTitle>
            <EmptyDescription className="text-xs">
              Tickets with a due date in this month appear on their day. Give a ticket a due date to
              see it here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {/* Weekday strip */}
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d) => (
          <div key={d} className="eyebrow px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${monthLabel} calendar`}
        className="grid flex-1 grid-cols-7 grid-rows-6 overflow-auto"
      >
        {cells.map((d, index) => {
          const key = dateKey(d);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayKey;
          const dayTickets = ticketsByDay[key] ?? [];
          const countLabel =
            dayTickets.length === 0
              ? "no tickets due"
              : `${dayTickets.length} ${dayTickets.length === 1 ? "ticket" : "tickets"} due`;
          return (
            <div
              key={key}
              role="gridcell"
              data-day={key}
              tabIndex={key === activeKey ? 0 : -1}
              aria-label={`${longDate(d)}, ${countLabel}`}
              aria-current={isToday ? "date" : undefined}
              onFocus={() => setFocusedKey(key)}
              onKeyDown={(event) => handleGridKeyDown(event, index)}
              className={cn(
                "flex min-h-[88px] flex-col gap-1 border-b border-r border-line p-1.5 outline-none",
                "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                !inMonth && "bg-surface-2 text-muted-foreground",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full text-2xs font-medium tabular-nums",
                    isToday && "bg-foreground text-background",
                  )}
                >
                  {d.getDate()}
                </span>
                {dayTickets.length > 3 && (
                  <span className="text-2xs tabular-nums text-muted-foreground" aria-hidden>
                    {dayTickets.length}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                {dayTickets.slice(0, 3).map((t) => {
                  const firstLabel = (t.labelIds ?? []).map((id) => labelById?.[id]).find(Boolean);
                  const swatch = firstLabel?.color;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onTicketClick(t.id)}
                      className={cn(
                        "flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-2xs",
                        "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover",
                        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      )}
                      title={t.title}
                    >
                      <span
                        className={cn("size-1.5 shrink-0 rounded-full", !swatch && priorityDotClass(t.priority))}
                        style={swatch ? { backgroundColor: swatch } : undefined}
                        aria-hidden
                      />
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}
                {dayTickets.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onTicketClick(dayTickets[3].id)}
                    className={cn(
                      "rounded px-1 text-left text-2xs text-muted-foreground",
                      "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:text-foreground",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    )}
                  >
                    +{dayTickets.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
