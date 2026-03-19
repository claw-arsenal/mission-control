"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

const LIVE_EVENTS_CHANNEL = "agent-logs-live";

type LiveState = "connecting" | "connected" | "reconnecting" | "offline";

export function LogsLiveRefresh() {
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    const channel = supabase.channel(LIVE_EVENTS_CHANNEL);

    channel
      .on("broadcast", { event: "agent_log_insert" }, () => {
        setState("connected");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setState("connected");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState("offline");
        } else {
          setState("reconnecting");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const badgeVariant = state === "connected" ? "default" : "secondary";
  const label =
    state === "connected"
      ? "Live: Connected"
      : state === "reconnecting"
        ? "Live: Reconnecting"
        : state === "offline"
          ? "Live: Offline"
          : "Live: Connecting";

  return <Badge variant={badgeVariant}>{label}</Badge>;
}
