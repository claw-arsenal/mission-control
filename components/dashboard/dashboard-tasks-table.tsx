import Link from "next/link"
import { IconArrowRight, IconArrowUpRight } from "@tabler/icons-react"

import type { DashboardTask } from "@/lib/db/server-data"
import { formatDue } from "@/types/tasks"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type { DashboardTask }

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-danger",
  high: "bg-warning",
  medium: "bg-info",
  low: "bg-muted-foreground/50",
}

const STATUS_DOT: Record<string, string> = {
  blue: "bg-info",
  info: "bg-info",
  amber: "bg-warning",
  warning: "bg-warning",
  emerald: "bg-success",
  success: "bg-success",
  green: "bg-success",
  red: "bg-danger",
  violet: "bg-primary",
  purple: "bg-primary",
}

type DueState = "overdue" | "today" | "later" | "none"

function dueState(dueDate: string | null, today: Date): DueState {
  if (!dueDate) return "none"
  const start = new Date(today)
  start.setHours(0, 0, 0, 0)
  const due = new Date(`${dueDate}T00:00:00`)
  if (Number.isNaN(due.getTime())) return "none"
  if (due < start) return "overdue"
  if (due.getTime() === start.getTime()) return "today"
  return "later"
}

const DUE_CLASS: Record<DueState, string> = {
  overdue: "text-danger-fg font-medium",
  today: "text-warning-fg font-medium",
  later: "text-foreground",
  none: "text-muted-foreground",
}

function dueLabel(task: DashboardTask, state: DueState): string {
  if (state === "none") return "No due date"
  if (state === "today") return "Today"
  return formatDue(task.dueDate)
}

type Props = {
  tasks: DashboardTask[]
  /** Injected for deterministic rendering in tests. */
  today?: Date
}

/**
 * The signed-in user's open tickets, soonest due first. The title is a real
 * link stretched over the row, so the row is clickable and keyboard reachable.
 */
export function DashboardTasksTable({ tasks, today = new Date() }: Props) {
  return (
    <Card className="@container/tasks gap-0 py-0">
      <CardHeader className="gap-1 border-b border-line py-5">
        <CardTitle className="col-span-2 flex items-center gap-2 text-md @lg/card-header:col-span-1">
          Your tasks
          {tasks.length > 0 ? (
            <span className="text-sm font-normal tabular-nums text-muted-foreground">{tasks.length}</span>
          ) : null}
        </CardTitle>
        <CardDescription className="col-span-2 @lg/card-header:col-span-1">Open tickets assigned to you, soonest due first</CardDescription>
        <CardAction className="col-span-2 row-start-3 justify-self-start @lg/card-header:col-span-1 @lg/card-header:col-start-2 @lg/card-header:row-span-2 @lg/card-header:row-start-1 @lg/card-header:justify-self-end">
          <Button variant="outline" size="sm" asChild>
            <Link href="/boards" prefetch={false}>
              View boards
              <IconArrowRight aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
          <p className="max-w-[40ch] text-xs text-muted-foreground">
            Tickets assigned to you appear here as soon as they&apos;re created. Pick something up from a board to get started.
          </p>
          <Button variant="ghost" size="sm" asChild className="mt-1">
            <Link href="/boards" prefetch={false}>
              Open boards
              <IconArrowUpRight aria-hidden />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Title</TableHead>
                <TableHead className="hidden @2xl/tasks:table-cell">Board</TableHead>
                <TableHead className="hidden @2xl/tasks:table-cell">Status</TableHead>
                <TableHead className="hidden @3xl/tasks:table-cell">Priority</TableHead>
                <TableHead className="pr-5 text-right">Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const state = dueState(task.dueDate, today)
                return (
                  <TableRow
                    key={task.id}
                    data-due={state}
                    className="group/row relative transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover has-[a:focus-visible]:bg-surface-hover"
                  >
                    <TableCell className="max-w-[min(360px,62vw)] pl-5 font-medium">
                      <Link
                        href={`/boards?board=${task.boardId}&ticket=${task.id}`}
                        prefetch={false}
                        className="block truncate outline-none after:absolute after:inset-0 after:content-['']"
                      >
                        {task.title}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground @2xl/tasks:table-cell">{task.boardName}</TableCell>
                    <TableCell className="hidden @2xl/tasks:table-cell">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className={cn("size-1.5 rounded-full", STATUS_DOT[task.colorKey?.toLowerCase()] ?? "bg-muted-foreground/50")}
                          aria-hidden
                        />
                        {task.status}
                      </span>
                    </TableCell>
                    <TableCell className="hidden @3xl/tasks:table-cell">
                      <span className="inline-flex items-center gap-1.5 text-xs capitalize">
                        <span className={cn("size-1.5 rounded-full", PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.low)} aria-hidden />
                        {task.priority}
                      </span>
                    </TableCell>
                    <TableCell className={cn("pr-5 text-right text-xs whitespace-nowrap tabular-nums", DUE_CLASS[state])}>
                      {dueLabel(task, state)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
