"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangleIcon, ChevronDownIcon, ChevronUpIcon, RefreshCwIcon, TimerOffIcon, XCircleIcon } from "lucide-react";

type FailedTicket = {
  id: string;
  title: string;
  execution_state: string;
  board_name: string;
  last_error: string | null;
  updated_at: string;
};

type Props = {
  onRetry: (ticketId: string) => void;
  onOpenTicket: (ticketId: string) => void;
};

export function FailedTicketsBucket({ onRetry, onOpenTicket }: Props) {
  const mountedRef = useRef(false);
  const [tickets, setTickets] = useState<FailedTicket[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchFailed = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "listFailedTickets" }),
      });
      const json = await res.json();
      if (json.ok) {
        setTickets(json.tickets ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    void fetchFailed();
    const timer = setInterval(fetchFailed, 30_000);

    return () => {
      clearInterval(timer);
      mountedRef.current = false;
    };
  }, [fetchFailed]);

  if (tickets.length === 0) return null;

  const stateIcon = (state: string) => {
    if (state === "expired") return <TimerOffIcon className="size-3 text-gray-500" />;
    if (state === "needs_retry") return <AlertTriangleIcon className="size-3 text-amber-500" />;
    return <XCircleIcon className="size-3 text-destructive" />;
  };

  const stateBadge = (state: string) => {
    if (state === "expired") return <Badge variant="outline" className="text-[9px] border-gray-400 text-gray-500">Expired</Badge>;
    if (state === "needs_retry") return <Badge variant="outline" className="text-[9px] border-amber-500 text-amber-600 dark:text-amber-400">Needs Retry</Badge>;
    return <Badge variant="outline" className="text-[9px] border-destructive text-destructive">Failed</Badge>;
  };

  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 mb-4">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-destructive/10 transition-colors rounded-t-lg"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <AlertTriangleIcon className="size-4 text-destructive" />
          <span className="text-sm font-semibold">Failed Tickets</span>
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
            {tickets.length}
          </Badge>
        </div>
        {collapsed ? <ChevronDownIcon className="size-4 text-muted-foreground" /> : <ChevronUpIcon className="size-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-1.5">
          {tickets.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-md border bg-background/80 px-3 py-2 hover:bg-muted/30 transition-colors"
            >
              {stateIcon(t.execution_state)}
              <button
                className="flex-1 text-left min-w-0 cursor-pointer"
                onClick={() => onOpenTicket(t.id)}
              >
                <span className="text-sm font-medium truncate block">{t.title}</span>
                <span className="text-[10px] text-muted-foreground">
                  {t.board_name}
                  {t.last_error ? ` — ${t.last_error.slice(0, 80)}` : ""}
                </span>
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                {stateBadge(t.execution_state)}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-1 cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); onRetry(t.id); }}
                >
                  <RefreshCwIcon className="size-3" /> Retry
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
