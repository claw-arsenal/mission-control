"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon, CheckCheckIcon, InfoIcon } from "lucide-react";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type NotificationRow = {
  id: string;
  kind: string;
  actor_name: string | null;
  actor_email: string | null;
  board_id: string | null;
  ticket_id: string | null;
  comment_id: string | null;
  preview: string;
  read_at: string | null;
  created_at: string;
  ticket_title?: string | null;
  board_name?: string | null;
};

type AssignedTicket = {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  board_id: string;
  board_name: string;
  column_title: string;
  updated_at: string;
};

type Diagnostics = {
  sessionEmail: string;
  hasMatchingAssignee: boolean;
  assigneeCountTotal: number;
};

type AuthState = "loading" | "unauthenticated" | "ready";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Priority reads as severity, matching the board cards. */
function priorityDotClass(p: string): string {
  switch (p) {
    case "urgent": return "bg-danger";
    case "high": return "bg-warning";
    case "medium": return "bg-info";
    default: return "bg-muted-foreground/60";
  }
}

export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"mentions" | "assigned">("mentions");
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [assigned, setAssigned] = useState<AssignedTicket[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [unread, setUnread] = useState(0);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications/inbox", { cache: "reload" });
      if (res.status === 401) {
        setAuthState("unauthenticated");
        return;
      }
      if (!res.ok) throw new Error(`The inbox request failed (${res.status}).`);
      const json = await res.json();
      if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "The inbox could not be read.");
      setAuthState("ready");
      setItems(json.notifications || []);
      setAssigned(json.assignedTickets || []);
      setDiagnostics(json.diagnostics || null);
      setUnread(Number(json.unread || 0));
      setError(null);
    } catch (err) {
      // A failed inbox must not read as "all caught up".
      setError(err instanceof Error ? err.message : "The inbox could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reload when the popover opens, so assigned tickets stay fresh.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Live updates for mentions via the shared SSE channel.
  useEffect(() => {
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;
    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const row = data.row as NotificationRow | undefined;
        if (!row) return;
        setItems((prev) => [row, ...prev.filter((x) => x.id !== row.id)].slice(0, 30));
        if (!row.read_at) setUnread((u) => u + 1);
      } catch {
        // ignore
      }
    };
    es.addEventListener("notification", handler as EventListener);
    return () => {
      es.removeEventListener("notification", handler as EventListener);
      es.close();
    };
  }, []);

  const markRead = useCallback(async (notificationId: string) => {
    await fetch("/api/notifications/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "markRead", notificationId }),
    });
    setItems((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await fetch("/api/notifications/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "markAllRead" }),
    });
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setUnread(0);
  }, []);

  const openTicket = useCallback(
    async (boardId: string | null, ticketId: string | null, notificationId?: string) => {
      if (notificationId) {
        const n = items.find((x) => x.id === notificationId);
        if (n && !n.read_at) await markRead(notificationId);
      }
      setOpen(false);
      if (!boardId) return;
      router.push(`/boards?board=${boardId}`);
      if (ticketId) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("mc:open-ticket", { detail: { ticketId, boardId } }),
          );
        }, 300);
      }
    },
    [items, markRead, router],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <BellIcon />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-2xs leading-none tabular-nums"
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        {authState === "unauthenticated" ? (
          <Empty className="border-0 bg-transparent">
            <EmptyHeader>
              <EmptyTitle>Sign in to see your inbox</EmptyTitle>
              <EmptyDescription>Mentions and the tickets assigned to you appear here once you are signed in.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Tabs value={tab} onValueChange={(value) => setTab(value as "mentions" | "assigned")}>
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <span className="eyebrow">Inbox</span>
              {tab === "mentions" && unread > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={markingAll}
                  onClick={() => {
                    setMarkingAll(true);
                    void markAllRead().finally(() => setMarkingAll(false));
                  }}
                >
                  {markingAll ? <Spinner className="size-3" /> : <CheckCheckIcon className="size-3" />}
                  Mark all read
                </Button>
              )}
            </div>

            <TabsList className="w-full rounded-none border-b border-line bg-transparent p-0">
              <TabsTrigger value="mentions" className="flex-1 gap-1.5 rounded-none border-0 data-[state=active]:bg-surface-hover">
                Mentions
                {unread > 0 && (
                  <Badge variant="destructive" className="h-4 px-1.5 text-2xs tabular-nums">{unread}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="assigned" className="flex-1 gap-1.5 rounded-none border-0 data-[state=active]:bg-surface-hover">
                My tickets
                <Badge variant="secondary" className="h-4 px-1.5 text-2xs tabular-nums">{assigned.length}</Badge>
              </TabsTrigger>
            </TabsList>

            {error ? (
              <div className="p-3">
                <Alert variant="destructive">
                  <AlertTitle>Inbox unavailable</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                  <AlertActions>
                    <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
                      {loading ? <Spinner className="size-3" /> : null}
                      Try again
                    </Button>
                  </AlertActions>
                </Alert>
              </div>
            ) : (
              <div className="mc-scrollbar max-h-[26rem] overflow-y-auto overscroll-contain">
                <TabsContent value="mentions" className="m-0">
                  <MentionsTab items={items} loading={loading} diagnostics={diagnostics} onOpen={openTicket} />
                </TabsContent>
                <TabsContent value="assigned" className="m-0">
                  <AssignedTab items={assigned} loading={loading} diagnostics={diagnostics} onOpen={openTicket} />
                </TabsContent>
              </div>
            )}
          </Tabs>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MentionsTab({
  items,
  loading,
  diagnostics,
  onOpen,
}: {
  items: NotificationRow[];
  loading: boolean;
  diagnostics: Diagnostics | null;
  onOpen: (boardId: string | null, ticketId: string | null, notificationId?: string) => void;
}) {
  if (loading && items.length === 0) return <RowSkeletons />;
  if (items.length === 0) {
    return <EmptyMentions diagnostics={diagnostics} />;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => {
        const unreadRow = !n.read_at;
        return (
          <li key={n.id}>
            <button
              onClick={() => onOpen(n.board_id, n.ticket_id, n.id)}
              className={cn(
                "block w-full px-3 py-2.5 text-left transition-colors duration-(--dur-fast) outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                unreadRow && "bg-info-soft",
              )}
            >
              <div className="flex items-start gap-2">
                {unreadRow && (
                  <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-info" aria-label="Unread" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <span className="font-semibold text-foreground">{n.actor_name || "Someone"}</span>{" "}
                    <span className="text-muted-foreground">mentioned you</span>
                    {n.ticket_title && (
                      <>
                        {" "}
                        <span className="text-muted-foreground">in</span>{" "}
                        <span className="font-medium text-foreground">{n.ticket_title}</span>
                      </>
                    )}
                  </p>
                  {n.preview && (
                    <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{n.preview}</p>
                  )}
                  <div className="mt-1 flex items-center gap-1 text-2xs text-muted-foreground">
                    {n.board_name && <span className="truncate">{n.board_name}</span>}
                    {n.board_name && <span>·</span>}
                    <span className="tabular-nums">{relativeTime(n.created_at)}</span>
                  </div>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AssignedTab({
  items,
  loading,
  diagnostics,
  onOpen,
}: {
  items: AssignedTicket[];
  loading: boolean;
  diagnostics: Diagnostics | null;
  onOpen: (boardId: string | null, ticketId: string | null) => void;
}) {
  if (loading && items.length === 0) return <RowSkeletons />;
  if (items.length === 0) {
    return <EmptyAssigned diagnostics={diagnostics} />;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((t) => (
        <li key={t.id}>
          <button
            onClick={() => onOpen(t.board_id, t.id)}
            className="block w-full px-3 py-2.5 text-left transition-colors duration-(--dur-fast) outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
          >
            <div className="flex items-start gap-2">
              <span className={cn("mt-1.5 inline-block size-1.5 shrink-0 rounded-full", priorityDotClass(t.priority))} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{t.title}</p>
                <div className="mt-1 flex items-center gap-1 text-2xs text-muted-foreground">
                  <span className="truncate">{t.board_name}</span>
                  <span>·</span>
                  <span className="truncate">{t.column_title}</span>
                  {t.due_date && (
                    <>
                      <span>·</span>
                      <span className="tabular-nums">due {t.due_date}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RowSkeletons() {
  return (
    <ul className="divide-y divide-line" aria-busy="true" aria-label="Loading inbox">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-start gap-2 px-3 py-2.5">
          <Skeleton className="mt-1 size-1.5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Explains why an inbox is empty when the account is not wired up as an assignee. */
function NotReachableNotice({ title, email, children }: { title: string; email: string; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <Alert variant="warning">
        <InfoIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <p>
            No board assignee has the email{" "}
            <span className="rounded bg-surface-2 px-1 font-mono text-2xs">{email}</span>. {children}
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function EmptyMentions({ diagnostics }: { diagnostics: Diagnostics | null }) {
  if (diagnostics && !diagnostics.hasMatchingAssignee) {
    return (
      <NotReachableNotice title="Mentions will not reach you yet" email={diagnostics.sessionEmail}>
        Open a board, choose Board then Manage assignees, and add yourself with your email so others can mention you.
      </NotReachableNotice>
    );
  }
  return (
    <Empty className="border-0 bg-transparent">
      <EmptyHeader>
        <EmptyTitle>You are all caught up</EmptyTitle>
        <EmptyDescription>Comments that mention you show up here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function EmptyAssigned({ diagnostics }: { diagnostics: Diagnostics | null }) {
  if (diagnostics && !diagnostics.hasMatchingAssignee) {
    return (
      <NotReachableNotice title="Nothing assigned to you yet" email={diagnostics.sessionEmail}>
        Add yourself as an assignee on a board first.
      </NotReachableNotice>
    );
  }
  return (
    <Empty className="border-0 bg-transparent">
      <EmptyHeader>
        <EmptyTitle>Nothing assigned to you</EmptyTitle>
        <EmptyDescription>Tickets where you are an assignee show up here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
