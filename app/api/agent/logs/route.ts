import { NextResponse } from "next/server";
import { classifyAgentLogMemorySource } from "@/lib/agent-log-utils";
import type { AgentLogEventType } from "@/types/agents";
import { getServerSupabaseClient } from "@/lib/supabase/server";

type DeletePayload = {
  agentId?: string;
  logId?: string;
};

type AgentLogRow = {
  id: string;
  agent_id: string;
  occurred_at: string;
  level: string;
  type: string;
  run_id: string | null;
  message: string | null;
  event_id: string | null;
  event_type: string | null;
  direction: string | null;
  channel_type: string | null;
  session_key: string | null;
  source_message_id: string | null;
  correlation_id: string | null;
  status: string | null;
  retry_count: number | null;
  message_preview: string | null;
  is_json: boolean | null;
  contains_pii: boolean | null;
  memory_source: string | null;
  memory_key: string | null;
  collection: string | null;
  query_text: string | null;
  result_count: number | null;
  raw_payload: unknown | null;
  runtime_agent_id: string | null;
};

async function getWorkspaceId() {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }
  if (!user) {
    return {
      supabase,
      workspaceId: "",
      userId: "",
    };
  }

  const { data: configuredRows, error: configuredError } = await supabase
    .from("user_workspace_settings")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("setup_completed", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (configuredError) {
    throw new Error(configuredError.message);
  }

  const configuredWorkspaceId = configuredRows?.[0]?.workspace_id as string | undefined;
  if (configuredWorkspaceId) {
    return {
      supabase,
      workspaceId: configuredWorkspaceId,
      userId: user.id,
    };
  }

  const { data: membershipRows, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .order("workspace_id", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  return {
    supabase,
    workspaceId: (membershipRows?.[0]?.workspace_id as string | undefined) ?? "",
    userId: user.id,
  };
}

function canonicalRuntimeAgentId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("runtime:") ? text.slice("runtime:".length) : text;
}

function toEventType(value: string | null): AgentLogEventType {
  const text = String(value || "").trim();
  if (!text) return "system.warning";
  return text as AgentLogEventType;
}

function toClientLog(row: AgentLogRow) {
  return {
    id: row.id,
    agentId: row.runtime_agent_id || row.agent_id,
    occurredAt: row.occurred_at,
    level: (row.level || "info") as "info" | "warning" | "error" | "debug",
    type: (row.type || "system") as "workflow" | "tool" | "memory" | "system",
    runId: row.run_id || "",
    message: row.message || "",
    eventId: row.event_id || undefined,
    eventType: row.event_type || undefined,
    direction: row.direction || undefined,
    channelType: row.channel_type || undefined,
    sessionKey: row.session_key || undefined,
    sourceMessageId: row.source_message_id || undefined,
    correlationId: row.correlation_id || undefined,
    status: row.status || undefined,
    retryCount: row.retry_count ?? undefined,
    messagePreview: row.message_preview || undefined,
    isJson: Boolean(row.is_json),
    jsonState: undefined,
    containsPii: Boolean(row.contains_pii),
    memorySource:
      row.memory_source ||
      classifyAgentLogMemorySource(toEventType(row.event_type), String(row.message || "")) ||
      undefined,
    memoryKey: row.memory_key || undefined,
    collection: row.collection || undefined,
    queryText: row.query_text || undefined,
    resultCount: row.result_count,
    rawPayload: row.raw_payload,
  };
}

export async function GET(request: Request) {
  try {
    const { supabase, workspaceId, userId } = await getWorkspaceId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") || "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const runtimeAgentId = canonicalRuntimeAgentId(url.searchParams.get("runtimeAgentId"));

    let query = supabase
      .from("agent_logs")
      .select("id,agent_id,occurred_at,level,type,run_id,message,event_id,event_type,direction,channel_type,session_key,source_message_id,correlation_id,status,retry_count,message_preview,is_json,contains_pii,memory_source,memory_key,collection,query_text,result_count,raw_payload,runtime_agent_id")
      .eq("workspace_id", workspaceId)
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (runtimeAgentId) {
      query = query.or(
        `runtime_agent_id.eq.${runtimeAgentId},session_key.ilike.agent:${runtimeAgentId}:%`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      logs: ((data ?? []) as AgentLogRow[]).map(toClientLog),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch logs." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, workspaceId, userId } = await getWorkspaceId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const payload = ((await request.json().catch(() => ({}))) ?? {}) as DeletePayload;
    const agentId = String(payload.agentId || "").trim();
    const logId = String(payload.logId || "").trim();

    let query = supabase.from("agent_logs").delete().eq("workspace_id", workspaceId);
    if (logId) {
      query = query.eq("id", logId);
    } else if (agentId) {
      const runtimeAgentId = canonicalRuntimeAgentId(agentId);
      query = query.or(
        `agent_id.eq.${agentId},runtime_agent_id.eq.${runtimeAgentId},session_key.ilike.agent:${runtimeAgentId}:%`,
      );
    }

    const { error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to clear logs.",
      },
      { status: 500 },
    );
  }
}
