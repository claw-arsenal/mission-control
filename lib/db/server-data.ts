import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import type {
  Agent,
  AgentHealthActivity,
  AgentLog,
  AgentLogChannelType,
  AgentLogDirection,
  AgentLogEventType,
  AgentLogPageInfo,
  AgentLogMemorySource,
  AgentStatus,
} from "@/types/agents";
import type { Assignee, BoardHydration, BoardState, Ticket } from "@/types/tasks";
import {
  classifyAgentLogChannel,
  classifyAgentLogDirection,
  classifyAgentLogEvent,
  classifyAgentLogMemorySource,
  detectContainsPii,
  normalizeAgentLogPayload,
} from "@/lib/agent-log-utils";
import { collectRuntimeSnapshots } from "@/lib/runtime/collector";
import { mergeAgentWithRuntime } from "@/lib/runtime/merge";
import type { RuntimeSnapshotMap } from "@/lib/runtime/types";

export type DashboardActivityLog = {
  id: string;
  occurredAt: string;
  source: "Agent" | "Tasks" | "System" | "API";
  event: string;
  details: string;
  level: "info" | "success" | "warning" | "error";
  agentName?: string;
};

export type DashboardChartPoint = {
  date: string;
  created: number;
  completed: number;
  logs: number;
};

export type SidebarUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
};

const emptyBoard: BoardState = {
  columns: {},
  columnOrder: [],
  tickets: {},
  ticketIdsByColumn: {},
};

type Context = {
  workspaceId: string;
};

const ENV_WORKSPACE_ID = process.env.OPENCLAW_WORKSPACE_ID?.trim() || "";
const ENABLE_AGENT_DATA_DEBUG = process.env.OPENCLAW_AGENT_DATA_DEBUG === "true";

function debugAgentData(event: string, data: Record<string, unknown>) {
  if (!ENABLE_AGENT_DATA_DEBUG) return;
  console.info(`[agent-data] ${event}`, data);
}

type AgentRow = {
  id: string;
  workspace_id: string;
  openclaw_agent_id?: string | null;
  status: string;
  model: string;
  last_heartbeat_at: string;
};

type AgentAssigneeRow = {
  id: string;
  openclaw_agent_id?: string | null;
};

type AgentLogRow = {
  id: string;
  agent_id: string;
  runtime_agent_id?: string | null;
  occurred_at: string;
  level: string;
  type: string;
  run_id: string | null;
  message: string;
  event_id?: string | null;
  event_type?: string | null;
  direction?: string | null;
  channel_type?: string | null;
  session_key?: string | null;
  source_message_id?: string | null;
  correlation_id?: string | null;
  status?: string | null;
  retry_count?: number | null;
  message_preview?: string | null;
  is_json?: boolean | null;
  contains_pii?: boolean | null;
  memory_source?: string | null;
  memory_key?: string | null;
  collection?: string | null;
  query_text?: string | null;
  result_count?: number | null;
  raw_payload?: unknown;
};

type ActivityLogRow = {
  id: string;
  occurred_at: string;
  source: string;
  event: string;
  details: string;
  level: string;
};

type DashboardTicketRow = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent" | null;
  due_date: string | null;
  tags: string[] | null;
  assignee_ids: string[] | null;
  checklist_done: number;
  checklist_total: number;
  comments_count: number;
  attachments_count: number;
  created_at: string;
  updated_at: string;
  position: number | string;
};

type BoardsPageRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type BoardsPageColumnRow = {
  id: string;
  board_id: string;
  title: string;
  color_key: string | null;
  is_default: boolean | null;
  position: number | string;
};

type BoardsPageTicketRow = {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent" | null;
  due_date: string | null;
  tags: string[] | null;
  assignee_ids: string[] | null;
  checklist_done: number;
  checklist_total: number;
  comments_count: number;
  attachments_count: number;
  created_at: string;
  position: number | string;
};

type SidebarProfileRow = {
  email: string | null;
  name: string | null;
  avatar_url: string | null;
};

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : null;
}

function toDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isCompletedColumn(title: string, colorKey: string | null) {
  const normalized = title.toLowerCase();
  return colorKey === "success" || normalized.includes("done") || normalized.includes("complete");
}

function toneFromColorKey(
  colorKey: string | null,
): BoardState["columns"][string]["tone"] {
  if (colorKey === "success") return "success";
  if (colorKey === "warning") return "warning";
  if (colorKey === "info") return "info";
  return "neutral";
}

function toDashboardStatusKey(columnTitle: string) {
  const normalized = columnTitle.toLowerCase();
  if (normalized.includes("review")) return "review";
  if (
    normalized.includes("done") ||
    normalized.includes("complete") ||
    normalized.includes("completed")
  ) {
    return "done";
  }
  if (
    normalized.includes("progress") ||
    normalized.includes("upcoming") ||
    normalized.includes("active")
  ) {
    return "in_progress";
  }
  return "backlog";
}

function buildTaskChartData(
  ticketsRows: DashboardTicketRow[],
  completedColumnIds: Set<string>,
  logRows: Array<{ occurred_at: string }>,
): DashboardChartPoint[] {
  const dayCount = 90;
  const now = new Date();
  const createdByDate = new Map<string, number>();
  const completedByDate = new Map<string, number>();
  const logsByDate = new Map<string, number>();

  for (const row of ticketsRows) {
    const createdKey = toDateKey(row.created_at);
    if (createdKey) {
      createdByDate.set(createdKey, (createdByDate.get(createdKey) ?? 0) + 1);
    }

    if (completedColumnIds.has(row.column_id)) {
      const completedKey = toDateKey(row.updated_at);
      if (completedKey) {
        completedByDate.set(completedKey, (completedByDate.get(completedKey) ?? 0) + 1);
      }
    }
  }

  for (const row of logRows) {
    const key = toDateKey(row.occurred_at);
    if (!key) continue;
    logsByDate.set(key, (logsByDate.get(key) ?? 0) + 1);
  }

  const points: DashboardChartPoint[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    date.setUTCDate(date.getUTCDate() - offset);
    const dateKey = toDateKey(date.toISOString());
    if (!dateKey) continue;
    points.push({
      date: dateKey,
      created: createdByDate.get(dateKey) ?? 0,
      completed: completedByDate.get(dateKey) ?? 0,
      logs: logsByDate.get(dateKey) ?? 0,
    });
  }

  return points;
}

function asStatus(value: string): AgentStatus {
  if (value === "running" || value === "idle" || value === "degraded") {
    return value;
  }
  return "idle";
}

async function getContext(supabase: SupabaseClient): Promise<Context | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  if (ENV_WORKSPACE_ID) {
    const { data: preferredRows, error: preferredError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("workspace_id", ENV_WORKSPACE_ID)
      .limit(1);

    if (preferredError) {
      throw new Error(preferredError.message);
    }

    if (preferredRows?.[0]?.workspace_id) {
      return {
        workspaceId: ENV_WORKSPACE_ID,
      };
    }
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
      workspaceId: configuredWorkspaceId,
    };
  }

  const { data: memberRows, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .order("workspace_id", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const workspaceId = memberRows?.[0]?.workspace_id as string | undefined;
  if (!workspaceId) {
    return null;
  }

  return {
    workspaceId,
  };
}

function mapTickets(rows: Array<{
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent" | null;
  due_date: string | null;
  tags: string[] | null;
  assignee_ids: string[] | null;
  checklist_done: number;
  checklist_total: number;
  comments_count: number;
  attachments_count: number;
  created_at: string;
}>, statusKeyByColumnId: Record<string, string>): Record<string, Ticket> {
  const tickets: Record<string, Ticket> = {};
  for (const row of rows) {
    tickets[row.id] = {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      statusId: statusKeyByColumnId[row.column_id] ?? "backlog",
      priority: row.priority ?? "medium",
      dueDate: toDateInput(row.due_date),
      tags: row.tags ?? [],
      assigneeIds: row.assignee_ids ?? [],
      checklistDone: row.checklist_done,
      checklistTotal: row.checklist_total,
      comments: row.comments_count,
      attachments: row.attachments_count,
      createdAt: new Date(row.created_at).valueOf(),
    };
  }
  return tickets;
}

function buildBoardStateFromRows(
  columnRows: BoardsPageColumnRow[],
  ticketRows: BoardsPageTicketRow[],
): BoardState {
  const columns: BoardState["columns"] = {};
  const columnOrder: string[] = [];
  const ticketIdsByColumn: Record<string, string[]> = {};

  const sortedColumns = [...columnRows].sort((a, b) => Number(a.position) - Number(b.position));
  for (const row of sortedColumns) {
    columns[row.id] = {
      id: row.id,
      title: row.title,
      tone: toneFromColorKey(row.color_key),
      isDefault: row.is_default ?? false,
    };
    columnOrder.push(row.id);
    ticketIdsByColumn[row.id] = [];
  }

  const columnIndexById = Object.fromEntries(columnOrder.map((id, index) => [id, index]));
  const sortedTickets = [...ticketRows].sort((a, b) => {
    const aColumnIndex = columnIndexById[a.column_id] ?? Number.MAX_SAFE_INTEGER;
    const bColumnIndex = columnIndexById[b.column_id] ?? Number.MAX_SAFE_INTEGER;
    if (aColumnIndex !== bColumnIndex) {
      return aColumnIndex - bColumnIndex;
    }
    return Number(a.position) - Number(b.position);
  });

  const tickets: BoardState["tickets"] = {};
  for (const row of sortedTickets) {
    if (!columns[row.column_id]) continue;
    tickets[row.id] = {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      statusId: row.column_id,
      priority: row.priority ?? "medium",
      dueDate: toDateInput(row.due_date),
      tags: row.tags ?? [],
      assigneeIds: row.assignee_ids ?? [],
      checklistDone: row.checklist_done,
      checklistTotal: row.checklist_total,
      comments: row.comments_count,
      attachments: row.attachments_count,
      createdAt: new Date(row.created_at).valueOf(),
    };
    ticketIdsByColumn[row.column_id].push(row.id);
  }

  return {
    columns,
    columnOrder,
    tickets,
    ticketIdsByColumn,
  };
}

export async function getBoardsPageData(): Promise<BoardHydration[]> {
  const supabase = await getServerSupabaseClient();
  const context = await getContext(supabase);

  if (!context) {
    return [];
  }

  const { data: boardsRows, error: boardsError } = await supabase
    .from("boards")
    .select("id, name, description, created_at, updated_at")
    .eq("workspace_id", context.workspaceId)
    .order("created_at", { ascending: true });

  if (boardsError) {
    throw new Error(boardsError.message);
  }

  const boards = (boardsRows ?? []) as BoardsPageRow[];
  if (boards.length === 0) {
    return [];
  }

  const boardIds = boards.map((row) => row.id);
  const [{ data: columnRows, error: columnsError }, { data: ticketRows, error: ticketsError }] =
    await Promise.all([
      supabase
        .from("columns")
        .select("id, board_id, title, color_key, is_default, position")
        .in("board_id", boardIds),
      supabase
        .from("tickets")
        .select(
          "id, board_id, column_id, title, description, priority, due_date, tags, assignee_ids, checklist_done, checklist_total, comments_count, attachments_count, created_at, position",
        )
        .in("board_id", boardIds),
    ]);

  if (columnsError) {
    throw new Error(columnsError.message);
  }
  if (ticketsError) {
    throw new Error(ticketsError.message);
  }

  const columnsByBoardId = new Map<string, BoardsPageColumnRow[]>();
  for (const row of (columnRows ?? []) as BoardsPageColumnRow[]) {
    const list = columnsByBoardId.get(row.board_id) ?? [];
    list.push(row);
    columnsByBoardId.set(row.board_id, list);
  }

  const ticketsByBoardId = new Map<string, BoardsPageTicketRow[]>();
  for (const row of (ticketRows ?? []) as BoardsPageTicketRow[]) {
    const list = ticketsByBoardId.get(row.board_id) ?? [];
    list.push(row);
    ticketsByBoardId.set(row.board_id, list);
  }

  return boards.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    createdAt: new Date(row.created_at).valueOf(),
    updatedAt: new Date(row.updated_at).valueOf(),
    data: buildBoardStateFromRows(
      columnsByBoardId.get(row.id) ?? [],
      ticketsByBoardId.get(row.id) ?? [],
    ),
  }));
}

export async function getDashboardData() {
  const supabase = await getServerSupabaseClient();
  const context = await getContext(supabase);

  if (!context) {
    return {
      boardId: null as string | null,
      board: emptyBoard,
      tickets: [] as Ticket[],
      activityLogs: [] as DashboardActivityLog[],
      chartData: [] as DashboardChartPoint[],
      logs24h: 0,
    };
  }

  const { data: boards, error: boardError } = await supabase
    .from("boards")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (boardError) {
    throw new Error(boardError.message);
  }

  const boardId = boards?.[0]?.id as string | undefined;
  if (!boardId) {
    return {
      boardId: null as string | null,
      board: emptyBoard,
      tickets: [],
      activityLogs: [],
      chartData: [],
      logs24h: 0,
    };
  }

  const [{ data: columns, error: columnError }, { data: ticketsRows, error: ticketError }] =
    await Promise.all([
      supabase
        .from("columns")
        .select("id, title, color_key, is_default, position")
        .eq("board_id", boardId)
        .order("position", { ascending: true }),
      supabase
        .from("tickets")
        .select(
          "id, column_id, title, description, priority, due_date, tags, assignee_ids, checklist_done, checklist_total, comments_count, attachments_count, created_at, updated_at, position",
        )
        .eq("board_id", boardId)
        .order("position", { ascending: true }),
    ]);

  if (columnError) {
    throw new Error(columnError.message);
  }
  if (ticketError) {
    throw new Error(ticketError.message);
  }

  const sortedColumns = [...(columns ?? [])].sort(
    (a, b) => Number(a.position) - Number(b.position),
  );
  const columnsMap: BoardState["columns"] = {};
  const columnOrder: string[] = [];
  const ticketIdsByColumn: Record<string, string[]> = {};
  const statusKeyByColumnId: Record<string, string> = {};

  for (const column of sortedColumns) {
    columnsMap[column.id] = {
      id: column.id,
      title: column.title,
      tone: toneFromColorKey(column.color_key),
      isDefault: (column.is_default as boolean | null) ?? false,
    };
    statusKeyByColumnId[column.id] = toDashboardStatusKey(column.title);
    columnOrder.push(column.id);
    ticketIdsByColumn[column.id] = [];
  }

  const sortedTickets = ([...(ticketsRows ?? [])] as DashboardTicketRow[]).sort(
    (a, b) => Number(a.position) - Number(b.position),
  );
  const tickets = mapTickets(sortedTickets, statusKeyByColumnId);
  for (const row of sortedTickets) {
    if (!ticketIdsByColumn[row.column_id]) {
      ticketIdsByColumn[row.column_id] = [];
    }
    ticketIdsByColumn[row.column_id].push(row.id);
  }

  const board: BoardState = {
    columns: columnsMap,
    columnOrder,
    tickets,
    ticketIdsByColumn,
  };

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const completedColumnIds = new Set(
    (columns ?? [])
      .filter((column) => isCompletedColumn(column.title, column.color_key))
      .map((column) => column.id),
  );

  const [activityResult, recentLogsResult, logs24hCountResult, logsForChartResult] = await Promise.all([
    supabase
      .from("activity_logs")
      .select("id, occurred_at, source, event, details, level")
      .eq("workspace_id", context.workspaceId)
      .order("occurred_at", { ascending: false })
      .limit(20),
    supabase
      .from("agent_logs")
      .select("id, agent_id, occurred_at, level, event_type, message")
      .eq("workspace_id", context.workspaceId)
      .order("occurred_at", { ascending: false })
      .limit(5),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", context.workspaceId)
      .gte("occurred_at", twentyFourHoursAgo),
    supabase
      .from("agent_logs")
      .select("occurred_at")
      .eq("workspace_id", context.workspaceId)
      .gte("occurred_at", ninetyDaysAgo)
      .limit(5000),
  ]);

  if (activityResult.error) {
    throw new Error(activityResult.error.message);
  }
  if (recentLogsResult.error) {
    throw new Error(recentLogsResult.error.message);
  }
  if (logs24hCountResult.error) {
    throw new Error(logs24hCountResult.error.message);
  }
  if (logsForChartResult.error) {
    throw new Error(logsForChartResult.error.message);
  }

  const chartData = buildTaskChartData(
    sortedTickets,
    completedColumnIds,
    ((logsForChartResult.data ?? []) as Array<{ occurred_at: string }>),
  );

  type RecentLogRow = {
    id: string;
    agent_id: string;
    occurred_at: string;
    level: string | null;
    event_type: string | null;
    message: string | null;
  };

  const recentLogRows = (recentLogsResult.data ?? []) as RecentLogRow[];
  const logAgentIds = [...new Set(recentLogRows.map((r) => r.agent_id).filter(Boolean))];
  const agentNameById: Record<string, string> = {};

  if (logAgentIds.length > 0) {
    const { data: logAgentRows } = await supabase
      .from("agents")
      .select("id, openclaw_agent_id")
      .in("id", logAgentIds);
    for (const row of (logAgentRows ?? []) as Array<{ id: string; openclaw_agent_id: string | null }>) {
      const name = canonicalAgentRuntimeId(row.openclaw_agent_id);
      agentNameById[row.id] = name || `Agent ${row.id.slice(0, 8)}`;
    }
  }

  const activityLogs: DashboardActivityLog[] = [
    ...(((activityResult.data ?? []) as ActivityLogRow[]).map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      source:
        row.source === "Agent" || row.source === "Tasks" || row.source === "System" || row.source === "API"
          ? row.source
          : "System",
      event: row.event,
      details: row.details,
      level:
        row.level === "success" || row.level === "warning" || row.level === "error" || row.level === "info"
          ? row.level
          : "info",
    })) as DashboardActivityLog[]),
    ...recentLogRows.map((row) => ({
      id: `agent-log-${row.id}`,
      occurredAt: row.occurred_at,
      source: "Agent" as const,
      event: row.event_type || "agent.log",
      details: (row.message || "").slice(0, 140),
      level:
        row.level === "success" || row.level === "warning" || row.level === "error" || row.level === "info"
          ? (row.level as DashboardActivityLog["level"])
          : ("info" as const),
      agentName: agentNameById[row.agent_id],
    })),
  ]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, 4);

  return {
    boardId,
    board,
    tickets: Object.values(tickets),
    activityLogs,
    chartData,
    logs24h: Math.max(0, logs24hCountResult.count ?? 0),
  };
}

function mapAgent(row: AgentRow): Agent {
  const runtimeId = canonicalAgentRuntimeId(row.openclaw_agent_id);
  const resolvedId = runtimeId || "main";
  const fallbackName = resolvedId || `Agent ${row.id.slice(0, 8)}`;
  return {
    id: resolvedId,
    name: fallbackName,
    status: asStatus(row.status),
    runtime: {
      model: row.model || null,
      queueDepth: null,
      activeRuns: null,
      lastHeartbeatAt: row.last_heartbeat_at || null,
      uptimeMinutes: null,
    },
  };
}

const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 500;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalAgentRuntimeId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("runtime:") ? text.slice("runtime:".length) : text;
}

function runtimeAgentFilterIds(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const canonical = canonicalAgentRuntimeId(raw);
  if (!raw && !canonical) return [] as string[];
  if (raw && canonical && raw !== canonical) return [raw, canonical];
  return [raw || canonical];
}

const AGENT_LOG_SELECT =
  "id, agent_id, runtime_agent_id, occurred_at, level, type, run_id, message, event_id, event_type, direction, channel_type, session_key, source_message_id, correlation_id, status, retry_count, is_json, message_preview, raw_payload, memory_source, memory_key, collection, query_text, result_count, contains_pii";
const AGENT_LOG_SELECT_LEGACY =
  "id, agent_id, occurred_at, level, type, run_id, message, event_id, event_type, direction, channel_type, session_key, source_message_id, correlation_id, status, retry_count, is_json, message_preview, raw_payload, memory_source, memory_key, collection, query_text, result_count, contains_pii";

function clampLogLimit(limit?: number) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return DEFAULT_LOG_LIMIT;
  return Math.min(MAX_LOG_LIMIT, Math.max(50, Math.trunc(parsed)));
}

function clampLogPage(page?: number) {
  const parsed = Number(page);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

function buildEmptyLogPageInfo(limit = DEFAULT_LOG_LIMIT, page = 1): AgentLogPageInfo {
  return {
    limit,
    page,
    shownCount: 0,
    totalCount: 0,
    pageCount: 1,
  };
}

function buildEmptyAgentHealthActivity(): AgentHealthActivity {
  return {
    lastActivityAt: null,
    responses1h: 0,
    errors1h: 0,
  };
}

async function getRuntimeSnapshots() {
  let runtimeSnapshots: RuntimeSnapshotMap = {};
  try {
    runtimeSnapshots = await collectRuntimeSnapshots();
  } catch {
    runtimeSnapshots = {};
  }
  return runtimeSnapshots;
}

async function listAgentLogs(
  supabase: SupabaseClient,
  workspaceId: string,
  options?: {
    agentId?: string;
    runtimeAgentId?: string;
    sessionKeyPrefix?: string;
    limit?: number;
    page?: number;
  },
) {
  const limit = clampLogLimit(options?.limit);
  const requestedPage = clampLogPage(options?.page);

  let countQuery = supabase
    .from("agent_logs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (options?.agentId) {
    countQuery = countQuery.eq("agent_id", options.agentId);
  }
  if (options?.runtimeAgentId) {
    const runtimeIds = runtimeAgentFilterIds(options.runtimeAgentId);
    const clauses: string[] = [];
    for (const runtimeId of runtimeIds) {
      clauses.push(`runtime_agent_id.eq.${runtimeId}`);
      clauses.push(`session_key.ilike.agent:${runtimeId}:%`);
    }
    if (clauses.length > 0) {
      countQuery = countQuery.or(clauses.join(","));
    }
  } else if (options?.sessionKeyPrefix) {
    countQuery = countQuery.ilike("session_key", `${options.sessionKeyPrefix}%`);
  }

  const { count, error: countError } = await countQuery;
  if (countError) {
    throw new Error(countError.message);
  }

  debugAgentData("listAgentLogs.count", {
    workspaceId,
    options,
    count: count ?? 0,
  });

  const totalCount = Math.max(0, count ?? 0);
  const pageCount = Math.max(1, Math.ceil(totalCount / limit));
  const page = Math.min(requestedPage, pageCount);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const applyFilters = <T extends {
    eq: (column: string, value: string) => T;
    or: (filters: string) => T;
    ilike: (column: string, pattern: string) => T;
  }>(query: T) => {
    let scoped = query;
    if (options?.agentId) {
      scoped = scoped.eq("agent_id", options.agentId);
    }
    if (options?.runtimeAgentId) {
      const runtimeIds = runtimeAgentFilterIds(options.runtimeAgentId);
      const clauses: string[] = [];
      for (const runtimeId of runtimeIds) {
        clauses.push(`runtime_agent_id.eq.${runtimeId}`);
        clauses.push(`session_key.ilike.agent:${runtimeId}:%`);
      }
      if (clauses.length > 0) {
        scoped = scoped.or(clauses.join(","));
      }
    } else if (options?.sessionKeyPrefix) {
      scoped = scoped.ilike("session_key", `${options.sessionKeyPrefix}%`);
    }
    return scoped;
  };

  const buildQuery = (selectClause: string) =>
    applyFilters(
      supabase
        .from("agent_logs")
        .select(selectClause)
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    );

  let { data, error } = await buildQuery(AGENT_LOG_SELECT);

  if (error && /runtime_agent_id/i.test(error.message)) {
    ({ data, error } = await buildQuery(AGENT_LOG_SELECT_LEGACY));
  }

  if (error) {
    throw new Error(error.message);
  }

  const normalizedRows = (data ?? []) as unknown as AgentLogRow[];

  debugAgentData("listAgentLogs.rows", {
    workspaceId,
    options,
    page,
    limit,
    rows: normalizedRows.length,
  });

  return {
    rows: normalizedRows,
    pageInfo: {
      limit,
      page,
      shownCount: normalizedRows.length,
      totalCount,
      pageCount,
    } satisfies AgentLogPageInfo,
  };
}

async function getAgentHealthActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  agentId: string,
): Promise<AgentHealthActivity> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [lastActivityResult, responsesResult, errorsResult] = await Promise.all([
    supabase
      .from("agent_logs")
      .select("occurred_at")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", agentId)
      .neq("type", "system")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("agent_id", agentId)
      .gte("occurred_at", since)
      .eq("event_type", "chat.assistant_out"),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("agent_id", agentId)
      .gte("occurred_at", since)
      .eq("level", "error"),
  ]);

  if (lastActivityResult.error) {
    throw new Error(lastActivityResult.error.message);
  }
  if (responsesResult.error) {
    throw new Error(responsesResult.error.message);
  }
  if (errorsResult.error) {
    throw new Error(errorsResult.error.message);
  }

  const lastActivityRow = lastActivityResult.data?.[0] as { occurred_at: string } | undefined;

  return {
    lastActivityAt: lastActivityRow?.occurred_at ?? null,
    responses1h: Math.max(0, responsesResult.count ?? 0),
    errors1h: Math.max(0, errorsResult.count ?? 0),
  };
}

const LOG_EVENT_TYPES = new Set<AgentLogEventType>([
  "chat.user_in",
  "chat.assistant_out",
  "chat.reaction",
  "tool.start",
  "tool.success",
  "tool.error",
  "system.startup",
  "system.shutdown",
  "system.warning",
  "system.error",
  "heartbeat.tick",
  "heartbeat.status_change",
  "memory.read",
  "memory.write",
  "memory.search",
  "memory.upsert",
  "memory.error",
]);

const LOG_CHANNEL_TYPES = new Set<AgentLogChannelType>(["telegram", "gateway", "internal", "qdrant"]);
const LOG_DIRECTIONS = new Set<AgentLogDirection>(["inbound", "outbound", "internal"]);
const LOG_MEMORY_SOURCES = new Set<AgentLogMemorySource>([
  "",
  "session",
  "daily_file",
  "long_term_file",
  "episodic_file",
  "qdrant_vector",
]);

function logicalAgentIdFromSessionKey(sessionKey: string | null | undefined) {
  const value = String(sessionKey || "").trim();
  if (!value.startsWith("agent:")) return "";

  const body = value.slice("agent:".length);
  const segments = body.split(":").filter(Boolean);
  if (segments.length === 0) return "";

  const first = segments[0] ?? "";
  if (first === "runtime" && segments.length >= 2) {
    return `${first}:${segments[1] ?? ""}`;
  }

  return first;
}

function mapAgentLog(row: AgentLogRow): AgentLog {
  const level =
    row.level === "info" || row.level === "warning" || row.level === "error" || row.level === "debug"
      ? row.level
      : "info";
  const type =
    row.type === "workflow" || row.type === "tool" || row.type === "memory" || row.type === "system"
      ? row.type
      : row.type === "model"
        ? "workflow"
        : "system";
  const normalized = normalizeAgentLogPayload(row.message);
  const cleanedMessage = normalized.cleanedMessage || row.message;
  const classifiedEventType = classifyAgentLogEvent(level, type, cleanedMessage);
  const eventType =
    typeof row.event_type === "string" && LOG_EVENT_TYPES.has(row.event_type as AgentLogEventType)
      ? (row.event_type as AgentLogEventType)
      : classifiedEventType;
  const channelType =
    typeof row.channel_type === "string" && LOG_CHANNEL_TYPES.has(row.channel_type as AgentLogChannelType)
      ? (row.channel_type as AgentLogChannelType)
      : classifyAgentLogChannel(cleanedMessage);
  const direction =
    typeof row.direction === "string" && LOG_DIRECTIONS.has(row.direction as AgentLogDirection)
      ? (row.direction as AgentLogDirection)
      : classifyAgentLogDirection(eventType, cleanedMessage);
  const dbMemorySource =
    typeof row.memory_source === "string" && LOG_MEMORY_SOURCES.has(row.memory_source as AgentLogMemorySource)
      ? (row.memory_source as AgentLogMemorySource)
      : "";
  const memorySource =
    dbMemorySource
      ? dbMemorySource
      : classifyAgentLogMemorySource(eventType, cleanedMessage);

  const rawPayload = row.raw_payload ?? normalized.rawPayload ?? null;
  const retryCount = Number.isFinite(row.retry_count) ? Math.max(0, Math.trunc(row.retry_count ?? 0)) : 0;
  const resultCount = Number.isFinite(row.result_count) ? Math.max(0, Math.trunc(row.result_count ?? 0)) : null;

  const logicalAgentId =
    canonicalAgentRuntimeId(typeof row.runtime_agent_id === "string" ? row.runtime_agent_id : "") ||
    canonicalAgentRuntimeId(logicalAgentIdFromSessionKey(row.session_key));

  return {
    id: row.id,
    agentId: logicalAgentId || row.agent_id,
    occurredAt: row.occurred_at,
    level,
    type,
    runId: typeof row.run_id === "string" ? row.run_id : "",
    eventId: typeof row.event_id === "string" && row.event_id.trim() ? row.event_id : row.id,
    message: cleanedMessage,
    eventType,
    direction,
    channelType,
    sessionKey: typeof row.session_key === "string" ? row.session_key : "",
    sourceMessageId: typeof row.source_message_id === "string" ? row.source_message_id : "",
    correlationId: typeof row.correlation_id === "string" ? row.correlation_id : "",
    status: typeof row.status === "string" ? row.status : "",
    retryCount,
    messagePreview: row.message_preview ?? normalized.messagePreview,
    isJson: row.is_json ?? normalized.isJson,
    jsonState: row.is_json === true ? "valid" : normalized.jsonState,
    containsPii: row.contains_pii ?? detectContainsPii(cleanedMessage, rawPayload),
    memorySource,
    memoryKey: typeof row.memory_key === "string" ? row.memory_key : "",
    collection: typeof row.collection === "string" ? row.collection : "",
    queryText: typeof row.query_text === "string" ? row.query_text : "",
    resultCount,
    rawPayload,
  };
}

const ASSIGNEE_COLORS = [
  "#5B7CF6",
  "#55A07A",
  "#F0A64F",
  "#EA6C73",
  "#8A7FF6",
  "#06B6D4",
] as const;

function initialsFromName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "AG";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function colorFromId(id: string) {
  const hash = Array.from(id).reduce((total, char) => total + char.charCodeAt(0), 0);
  return ASSIGNEE_COLORS[hash % ASSIGNEE_COLORS.length];
}

export async function getWorkspaceAssignees(): Promise<Assignee[]> {
  const supabase = await getServerSupabaseClient();
  const context = await getContext(supabase);

  if (!context) {
    return [];
  }

  const { data: agentRows, error } = await supabase
    .from("agents")
    .select("id, openclaw_agent_id")
    .eq("workspace_id", context.workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  let runtimeSnapshots: RuntimeSnapshotMap = {};
  try {
    runtimeSnapshots = await collectRuntimeSnapshots();
  } catch {
    runtimeSnapshots = {};
  }

  return ((agentRows ?? []) as AgentAssigneeRow[])
    .map((row) => {
      const runtimeId = canonicalAgentRuntimeId(row.openclaw_agent_id);
      const runtimeName = runtimeId ? String(runtimeSnapshots[runtimeId]?.name || "").trim() : "";
      const displayName = runtimeName || runtimeId || row.id;
      return {
        id: row.id,
        name: displayName,
        initials: initialsFromName(displayName),
        color: colorFromId(row.id),
      };
    })
    .filter((assignee) => Boolean(assignee.id));
}

export async function getSidebarUser(): Promise<SidebarUser | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!user) {
    return null;
  }

  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("email, name, avatar_url")
    .eq("id", user.id)
    .limit(1);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const profile = (profileRows?.[0] ?? null) as SidebarProfileRow | null;
  const profileName = profile?.name?.trim() ?? "";
  const fallbackFromEmail = (user.email ?? "").split("@")[0]?.trim() ?? "";

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    name: profileName || fallbackFromEmail || "Openclaw User",
    avatarUrl: profile?.avatar_url ?? "",
  };
}

export async function getSetupStatus(): Promise<boolean> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return false;
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .order("workspace_id", { ascending: true })
    .limit(1);

  if (membershipError) {
    return false;
  }

  const workspaceId = (memberships?.[0]?.workspace_id as string | undefined);
  if (!workspaceId) {
    return false;
  }

  const { data, error } = await supabase
    .from("user_workspace_settings")
    .select("setup_completed")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    return false;
  }

  return data?.setup_completed === true;
}

export async function getAgentsAndLogsData(options?: {
  limit?: number;
  page?: number;
}) {
  const supabase = await getServerSupabaseClient();
  const context = await getContext(supabase);
  const limit = clampLogLimit(options?.limit);
  const page = clampLogPage(options?.page);

  if (!context) {
    return {
      agents: [] as Agent[],
      logs: [] as AgentLog[],
      pageInfo: buildEmptyLogPageInfo(limit, page),
      logTotals: {
        total: 0,
        info: 0,
        warning: 0,
        error: 0,
      },
    };
  }

  const [
    { data: agentRows, error: agentError },
    logPage,
    runtimeSnapshots,
    totalLogsResult,
    infoLogsResult,
    warningLogsResult,
    errorLogsResult,
  ] = await Promise.all([
    supabase
      .from("agents")
      .select(
        "id, workspace_id, openclaw_agent_id, status, model, last_heartbeat_at",
      )
      .eq("workspace_id", context.workspaceId)
      .order("created_at", { ascending: true }),
    listAgentLogs(supabase, context.workspaceId, {
      limit,
      page,
    }),
    getRuntimeSnapshots(),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", context.workspaceId),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", context.workspaceId)
      .eq("level", "info"),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", context.workspaceId)
      .eq("level", "warning"),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", context.workspaceId)
      .eq("level", "error"),
  ]);

  if (agentError) {
    throw new Error(agentError.message);
  }
  if (totalLogsResult.error) {
    throw new Error(totalLogsResult.error.message);
  }
  if (infoLogsResult.error) {
    throw new Error(infoLogsResult.error.message);
  }
  if (warningLogsResult.error) {
    throw new Error(warningLogsResult.error.message);
  }
  if (errorLogsResult.error) {
    throw new Error(errorLogsResult.error.message);
  }

  const mappedAgents = ((agentRows ?? []) as AgentRow[]).map(mapAgent);
  const knownAgentIds = new Set(mappedAgents.map((agent) => canonicalAgentRuntimeId(agent.id)));

  debugAgentData("getAgentsAndLogsData.base", {
    workspaceId: context.workspaceId,
    dbAgents: mappedAgents.length,
    logRows: logPage.rows.length,
    page: logPage.pageInfo.page,
    limit: logPage.pageInfo.limit,
  });
  const runtimeOnlyAgents: Agent[] = Object.entries(runtimeSnapshots)
    .map(([agentId, snapshot]) => ({
      runtimeId: agentId,
      displayId: canonicalAgentRuntimeId(agentId),
      snapshot,
    }))
    .filter((entry) => entry.displayId && !knownAgentIds.has(entry.displayId))
    .map((entry) => ({
      id: entry.displayId,
      name: String(entry.snapshot?.name || entry.displayId),
      status: "idle",
      runtime: {
        model: null,
        queueDepth: null,
        activeRuns: null,
        lastHeartbeatAt: null,
        uptimeMinutes: null,
      },
    }));

  const mergedAgents = [...mappedAgents, ...runtimeOnlyAgents].map((agent) =>
    mergeAgentWithRuntime(agent, runtimeSnapshots),
  );

  const agentsById = new Map<string, Agent>();
  for (const agent of mergedAgents) {
    const key = canonicalAgentRuntimeId(agent.id) || agent.id;
    const existing = agentsById.get(key);
    if (!existing) {
      agentsById.set(key, agent);
      continue;
    }

    const existingScore =
      (existing.status === "running" ? 4 : existing.status === "degraded" ? 3 : 1) +
      (existing.runtime.model ? 1 : 0);
    const candidateScore =
      (agent.status === "running" ? 4 : agent.status === "degraded" ? 3 : 1) +
      (agent.runtime.model ? 1 : 0);

    if (candidateScore > existingScore) {
      agentsById.set(key, agent);
    }
  }

  return {
    agents: Array.from(agentsById.values()),
    logs: logPage.rows.map(mapAgentLog),
    pageInfo: logPage.pageInfo,
    logTotals: {
      total: Math.max(0, totalLogsResult.count ?? 0),
      info: Math.max(0, infoLogsResult.count ?? 0),
      warning: Math.max(0, warningLogsResult.count ?? 0),
      error: Math.max(0, errorLogsResult.count ?? 0),
    },
  };
}

export async function getAgentDetailsData(
  agentId: string,
  options?: {
    limit?: number;
    page?: number;
  },
) {
  const buildQueueSummary = async (workspaceId: string, runtimeAgentId: string) => {
    const normalizedRuntimeAgentId = String(runtimeAgentId || "").trim();
    if (!normalizedRuntimeAgentId) {
      return {
        assigned: 0,
        queued: 0,
        running: 0,
        blockedBySchedule: 0,
        blockedByApproval: 0,
        nextUp: [] as Array<{ id: string; title: string; priority: string; scheduledFor: string | null; dueDate: string | null }>,
      };
    }

    const agentUuid = UUID_REGEX.test(normalizedRuntimeAgentId)
      ? normalizedRuntimeAgentId
      : (
          await supabase
            .from("agents")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("openclaw_agent_id", normalizedRuntimeAgentId)
            .limit(1)
            .maybeSingle()
        ).data?.id ?? null;

    if (!agentUuid) {
      return {
        assigned: 0,
        queued: 0,
        running: 0,
        blockedBySchedule: 0,
        blockedByApproval: 0,
        nextUp: [] as Array<{ id: string; title: string; priority: string; scheduledFor: string | null; dueDate: string | null }>,
      };
    }

    const [ticketsRes, columnsRes] = await Promise.all([
      supabase
        .from("tickets")
        .select("id,title,priority,column_id,auto_approve,scheduled_for,execution_state,created_at,due_date")
        .eq("assigned_agent_id", agentUuid),
      supabase.from("columns").select("id,title"),
    ]);

    if (ticketsRes.error || columnsRes.error) {
      return {
        assigned: 0,
        queued: 0,
        running: 0,
        blockedBySchedule: 0,
        blockedByApproval: 0,
        nextUp: [] as Array<{ id: string; title: string; priority: string; scheduledFor: string | null; dueDate: string | null }>,
      };
    }

    const colTitleById = new Map(
      ((columnsRes.data ?? []) as Array<{ id: string; title: string }>).map((c) => [
        c.id,
        String(c.title || "").trim().toLowerCase(),
      ]),
    );

    const now = Date.now();
    let assigned = 0;
    let queued = 0;
    let running = 0;
    let blockedBySchedule = 0;
    let blockedByApproval = 0;

    const queueItems = ((ticketsRes.data ?? []) as Array<{
      id: string;
      title: string;
      priority: string;
      created_at: string;
      due_date: string | null;
      column_id: string;
      auto_approve: boolean;
      scheduled_for: string | null;
      execution_state: string;
    }>);

    for (const ticket of queueItems) {
      assigned += 1;
      const state = String(ticket.execution_state || "");
      if (state === "queued") queued += 1;
      if (state === "running" || state === "picked_up") running += 1;

      const colTitle = colTitleById.get(ticket.column_id) || "";
      if ((colTitle === "planned" || colTitle === "to-do" || colTitle === "todo") && !ticket.auto_approve) {
        blockedByApproval += 1;
      }
      const scheduledTs = ticket.scheduled_for ? new Date(ticket.scheduled_for).valueOf() : null;
      if (scheduledTs != null && Number.isFinite(scheduledTs) && scheduledTs > now) blockedBySchedule += 1;
    }

    const priorityScore = (value: string) => {
      if (value === "urgent") return 4;
      if (value === "high") return 3;
      if (value === "medium") return 2;
      return 1;
    };

    const nextUp = queueItems
      .filter((ticket) => {
        const state = String(ticket.execution_state || "");
        return state === "queued" || state === "pending";
      })
      .sort((a, b) => {
        const pa = priorityScore(String(a.priority || "medium"));
        const pb = priorityScore(String(b.priority || "medium"));
        if (pa !== pb) return pb - pa;
        const da = a.due_date ? new Date(a.due_date).valueOf() : null;
        const db = b.due_date ? new Date(b.due_date).valueOf() : null;
        if (da != null && db != null && da !== db) return da - db;
        if (da != null && db == null) return -1;
        if (da == null && db != null) return 1;
        return new Date(a.created_at).valueOf() - new Date(b.created_at).valueOf();
      })
      .slice(0, 5)
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        priority: String(ticket.priority || "medium"),
        scheduledFor: ticket.scheduled_for,
        dueDate: ticket.due_date,
      }));

    return { assigned, queued, running, blockedBySchedule, blockedByApproval, nextUp };
  };
  const supabase = await getServerSupabaseClient();
  const context = await getContext(supabase);
  const limit = clampLogLimit(options?.limit);
  const page = clampLogPage(options?.page);

  if (!context) {
    return {
      agent: null as Agent | null,
      logs: [] as AgentLog[],
      pageInfo: buildEmptyLogPageInfo(limit, page),
      healthActivity: buildEmptyAgentHealthActivity(),
      queueSummary: { assigned: 0, queued: 0, running: 0, blockedBySchedule: 0, blockedByApproval: 0, nextUp: [] },
    };
  }

  const requestedAgentId = canonicalAgentRuntimeId(agentId);
  const isUuidAgentId = UUID_REGEX.test(requestedAgentId);

  if (!isUuidAgentId) {
    const runtimeSnapshots = await getRuntimeSnapshots();
    const runtimeSnapshotEntry = Object.entries(runtimeSnapshots).find(([runtimeId]) => {
      return canonicalAgentRuntimeId(runtimeId) === requestedAgentId;
    });
    const runtimeSnapshot = runtimeSnapshotEntry?.[1];
    const runtimeOnlyAgent = runtimeSnapshot
      ? {
          id: requestedAgentId,
          name: runtimeSnapshot.name || requestedAgentId,
          status: "idle" as const,
          runtime: {
            model: null,
            queueDepth: null,
            activeRuns: null,
            lastHeartbeatAt: null,
            uptimeMinutes: null,
          },
        }
      : null;

    const logPage = await listAgentLogs(supabase, context.workspaceId, {
      runtimeAgentId: requestedAgentId,
      limit,
      page,
    });

    debugAgentData("getAgentDetailsData.runtime", {
      workspaceId: context.workspaceId,
      runtimeAgentId: requestedAgentId,
      runtimeSnapshotExists: Boolean(runtimeOnlyAgent),
      logRows: logPage.rows.length,
    });

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = logPage.rows.filter((row) => {
      const ts = new Date(row.occurred_at).valueOf();
      return Number.isFinite(ts) && ts >= oneHourAgo;
    });

    const lastActivityAt =
      logPage.rows.find((row) => row.type !== "system")?.occurred_at ?? logPage.rows[0]?.occurred_at ?? null;

    const queueSummary = await buildQueueSummary(context.workspaceId, requestedAgentId);

    return {
      agent: runtimeOnlyAgent ? mergeAgentWithRuntime(runtimeOnlyAgent, runtimeSnapshots) : null,
      logs: logPage.rows.map(mapAgentLog),
      pageInfo: logPage.pageInfo,
      healthActivity: {
        lastActivityAt,
        responses1h: recent.filter((row) => row.event_type === "chat.assistant_out").length,
        errors1h: recent.filter((row) => row.level === "error").length,
      },
      queueSummary,
    };
  }

  const [{ data: agentRows, error: agentError }, runtimeSnapshots] = await Promise.all([
    supabase
      .from("agents")
      .select(
        "id, workspace_id, openclaw_agent_id, status, model, last_heartbeat_at",
      )
      .eq("workspace_id", context.workspaceId)
      .eq("id", requestedAgentId)
      .limit(1),
    getRuntimeSnapshots(),
  ]);

  if (agentError) {
    throw new Error(agentError.message);
  }

  const agentRow = (agentRows?.[0] ?? null) as AgentRow | null;
  const mappedAgent = agentRow ? mapAgent(agentRow) : null;

  const runtimeAgentId = mappedAgent ? canonicalAgentRuntimeId(mappedAgent.id) : "";

  const [logPage, healthActivity, queueSummary] = await Promise.all([
    listAgentLogs(supabase, context.workspaceId, {
      agentId: requestedAgentId,
      runtimeAgentId: runtimeAgentId || undefined,
      limit,
      page,
    }),
    getAgentHealthActivity(supabase, context.workspaceId, requestedAgentId),
    buildQueueSummary(context.workspaceId, runtimeAgentId || requestedAgentId),
  ]);

  debugAgentData("getAgentDetailsData.db", {
    workspaceId: context.workspaceId,
    requestedAgentId,
    foundAgent: Boolean(agentRow),
    mappedAgentId: mappedAgent?.id ?? null,
    logRows: logPage.rows.length,
  });

  return {
    agent: mappedAgent ? mergeAgentWithRuntime(mappedAgent, runtimeSnapshots) : null,
    logs: logPage.rows.map(mapAgentLog),
    pageInfo: logPage.pageInfo,
    healthActivity,
    queueSummary,
  };
}
