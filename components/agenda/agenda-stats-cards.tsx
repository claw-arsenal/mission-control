"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { IconTrendingUp } from "@tabler/icons-react";
import { ContainerLoader } from "@/components/ui/container-loader";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { statusHex } from "@/lib/status-colors";

type AgendaStats = {
  totalEvents: number;
  notRanYetCount: number;
  runningCount: number;
  failedCount: number;
};

async function fetchStats(): Promise<AgendaStats> {
  const res = await fetch("/api/agenda/stats", { cache: "reload" });
  if (!res.ok) throw new Error(`The agenda stats request failed (${res.status}).`);
  const json = await res.json();
  return {
    totalEvents: json.totalEvents ?? 0,
    notRanYetCount: json.notRanYetCount ?? 0,
    runningCount: json.runningCount ?? 0,
    failedCount: json.failedCount ?? 0,
  };
}

export function AgendaStatsCards() {
  const [stats, setStats] = useState<AgendaStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const reduceMotion = useReducedMotion();

  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchStats();
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        // Never hide the row: an operator needs to know the numbers are missing.
        if (!cancelled) setError(err instanceof Error ? err.message : "Agenda stats could not be loaded.");
      }
    };

    void load();

    const handler = () => void load();
    document.addEventListener("agenda-refresh", handler);
    document.addEventListener("agenda-stats-refresh", handler);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      document.removeEventListener("agenda-refresh", handler);
      document.removeEventListener("agenda-stats-refresh", handler);
    };
  }, []);

  const retry = async () => {
    setRetrying(true);
    try {
      setStats(await fetchStats());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agenda stats could not be loaded.");
    } finally {
      setRetrying(false);
    }
  };

  if (error) {
    return (
      <div className="page-x">
        <Alert variant="destructive">
          <AlertTitle>Agenda stats unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertActions>
            <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
              {retrying ? <Spinner className="size-3" /> : null}
              Try again
            </Button>
          </AlertActions>
        </Alert>
      </div>
    );
  }

  return (
    <div className="relative min-h-[170px]">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: stats || reduceMotion ? 1 : 0.35 }}
        transition={{ duration: reduceMotion ? 0 : 0.16 }}
        className="*:data-[slot=card]:from-primary/12 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 md:grid-cols-4"
      >
      <Card data-slot="card" className="min-h-[150px]">
        <CardHeader>
          <CardDescription>Total Events</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats ? (
              <motion.span initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.18 }}>{stats.totalEvents}</motion.span>
            ) : "—"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Events
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Active agenda events</div>
          <div className="text-muted-foreground">Drafts excluded</div>
        </CardFooter>
      </Card>

      <Card data-slot="card" className="min-h-[150px]">
        <CardHeader>
          <CardDescription>Not Ran Yet</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats ? (
              <motion.span initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.18 }}>{stats.notRanYetCount}</motion.span>
            ) : "—"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Pending
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Queued + scheduled occurrences</div>
          <div className="text-muted-foreground">Active events only</div>
        </CardFooter>
      </Card>

      <Card
        data-slot="card"
        className="min-h-[150px]"
        style={stats && (stats.runningCount ?? 0) > 0 ? { borderColor: `${statusHex("running")}55` } : undefined}
      >
        <CardHeader>
          <CardDescription>Running</CardDescription>
          <CardTitle
            className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl"
            style={stats && (stats.runningCount ?? 0) > 0 ? { color: statusHex("running") } : undefined}
          >
            {stats ? (
              <motion.span initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.18 }}>{stats.runningCount ?? 0}</motion.span>
            ) : "—"}
          </CardTitle>
          <CardAction>
            <Badge
              variant="outline"
              style={stats && (stats.runningCount ?? 0) > 0 ? { borderColor: `${statusHex("running")}66`, backgroundColor: `${statusHex("running")}1A`, color: statusHex("running") } : undefined}
            >
              {stats && (stats.runningCount ?? 0) > 0 ? "● Live" : "Idle"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Currently executing</div>
          <div className="text-muted-foreground">Active agent runs</div>
        </CardFooter>
      </Card>

      <Card
        data-slot="card"
        className="min-h-[150px]"
        style={stats && stats.failedCount > 0 ? { borderColor: `${statusHex("failed")}55` } : undefined}
      >
        <CardHeader>
          <CardDescription>Failed Count</CardDescription>
          <CardTitle
            className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl"
            style={stats && stats.failedCount > 0 ? { color: statusHex("failed") } : undefined}
          >
            {stats ? (
              <motion.span initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.18 }}>{stats.failedCount}</motion.span>
            ) : "—"}
          </CardTitle>
          <CardAction>
            <Badge
              variant="outline"
              style={stats && stats.failedCount > 0 ? { borderColor: `${statusHex("failed")}66`, backgroundColor: `${statusHex("failed")}1A`, color: statusHex("failed") } : undefined}
            >
              <IconTrendingUp />
              {stats && stats.failedCount > 0 ? "Attention" : "Clean"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Failed + needs retry</div>
          <div className="text-muted-foreground">Across all occurrences</div>
        </CardFooter>
      </Card>
      </motion.div>

      {!stats ? <ContainerLoader label="Loading stats…" /> : null}
    </div>
  );
}
