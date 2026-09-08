"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ContainerLoader } from "@/components/ui/container-loader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconFileText } from "@tabler/icons-react";

type ServiceInfo = {
  name: string;
  status: string;
  pid: number | null;
  pidAlive: boolean;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
};

function ServiceStatusBadge({ status, pidAlive }: { status: string; pidAlive: boolean }): React.ReactElement {
  const effectiveStatus = pidAlive ? status : (status === "running" ? "stopped" : status);
  const map: Record<string, { label: string; className: string }> = {
    running: { label: "Running", className: "bg-success-soft text-success-fg border-success/20" },
    stopped: { label: "Stopped", className: "bg-surface-2 text-muted-foreground border-line" },
    error: { label: "Error", className: "bg-red-500/10 text-red-600 border-red-500/20" },
    unknown: { label: "Unknown", className: "bg-warning-soft text-warning-fg border-yellow-500/20" },
  };
  const cfg = map[effectiveStatus] ?? map.unknown;
  return (
    <Badge variant="outline" className={`gap-1.5 ${cfg.className}`}>
      {effectiveStatus === "running" && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
      )}
      {effectiveStatus === "error" && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
      )}
      {effectiveStatus === "stopped" && (
        <span className="inline-flex size-2 rounded-full bg-muted-foreground/60" />
      )}
      {cfg.label}
    </Badge>
  );
}

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return ts;
  }
}

export function ServiceManager(): React.ReactElement {
  const mountedRef = useRef(false);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<Set<string>>(new Set());
  const [logDialog, setLogDialog] = useState<{ open: boolean; service: string; logs: string }>({
    open: false, service: "", logs: "",
  });

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services", { cache: "reload" });
      if (!res.ok) throw new Error(`The services request failed (${res.status}).`);
      const json = await res.json();
      if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "The service list could not be read.");
      setServices(json.services ?? []);
      setError(null);
    } catch (err) {
      // Without this the list sits on "Loading services" forever.
      setError(err instanceof Error ? err.message : "The service list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    void fetchServices();

    const es = new EventSource("/api/notifications/stream");
    es.addEventListener("connected", () => { void fetchServices(); });
    es.addEventListener("activity", () => { void fetchServices(); });

    return () => {
      try { es.close(); } catch {}
      mountedRef.current = false;
    };
  }, [fetchServices]);

  const doAction = useCallback(async (service: string, action: "start" | "stop" | "restart") => {
    setActing((prev) => new Set(prev).add(service));
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, service }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`${action} ${service}: OK`);
        // Refresh after brief delay
        setTimeout(fetchServices, 2000);
      } else {
        toast.error(json.error ?? `${action} failed`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setActing((prev) => { const next = new Set(prev); next.delete(service); return next; });
    }
  }, [fetchServices]);

  const viewLogs = useCallback(async (service: string) => {
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logs", service, lines: 100 }),
      });
      const json = await res.json();
      if (json.ok) {
        setLogDialog({ open: true, service, logs: json.logs ?? "(empty)" });
      } else {
        toast.error("Failed to fetch logs");
      }
    } catch {
      toast.error("Network error");
    }
  }, []);

  if (loading) {
    return (
      <div className="relative min-h-[280px]">
        <ContainerLoader label="Loading services…" />
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {services.map((svc, idx) => (
          <motion.div
            key={svc.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.18) }}
          >
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold">{svc.name}</CardTitle>
                <ServiceStatusBadge status={svc.status} pidAlive={svc.pidAlive} />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground mb-3">
                {svc.pid && <div>PID: {svc.pid} {svc.pidAlive ? "✓" : "✗"}</div>}
                <div>Heartbeat: {formatTime(svc.lastHeartbeatAt)}</div>
                {svc.lastError && (
                  <div className="text-danger-fg truncate" title={svc.lastError}>
                    Error: {svc.lastError.slice(0, 80)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-7 text-xs cursor-pointer"
                  disabled={acting.has(svc.name)}
                  onClick={() => doAction(svc.name, "start")}
                >
                  <IconPlayerPlay className="size-3" />
                  Start
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-7 text-xs cursor-pointer"
                  disabled={acting.has(svc.name)}
                  onClick={() => doAction(svc.name, "stop")}
                >
                  <IconPlayerStop className="size-3" />
                  Stop
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-7 text-xs cursor-pointer"
                  disabled={acting.has(svc.name)}
                  onClick={() => doAction(svc.name, "restart")}
                >
                  <IconRefresh className="size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 h-7 text-xs cursor-pointer ml-auto"
                  onClick={() => viewLogs(svc.name)}
                >
                  <IconFileText className="size-3" />
                  Logs
                </Button>
              </div>
            </CardContent>
          </Card>
          </motion.div>
        ))}

        {services.length === 0 && !loading && (
          <div className="col-span-full">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Services could not be loaded</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
                <AlertActions>
                  <Button size="sm" variant="outline" onClick={() => void fetchServices()}>Try again</Button>
                </AlertActions>
              </Alert>
            ) : (
              <Empty className="border-line bg-surface-2/60">
                <EmptyHeader>
                  <EmptyTitle>No services registered</EmptyTitle>
                  <EmptyDescription>Background services appear here once the runtime reports them.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        )}
      </div>

      <Dialog open={logDialog.open} onOpenChange={(open) => setLogDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Logs: {logDialog.service}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all p-4 bg-muted/30 rounded-lg">
              {logDialog.logs}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
