import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import type {
  AdapterSession,
  AdapterUser,
  BoardRecord,
  CreateTicketActivityPayload,
  ColumnRecord,
  CreateTicketSubtaskPayload,
  TaskDataAdapter,
  TicketAttachmentRecord,
  TicketActivityLevel,
  TicketActivityRecord,
  TicketCommentRecord,
  TicketPriority,
  TicketRecord,
  TicketSubtaskRecord,
  UpdateTicketSubtaskPatch,
} from "@/lib/db/adapter";

const POSITION_STEP = 1024;
const MIN_POSITION_GAP = 0.00001;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toUuidAssigneeIds = (ids: string[] | undefined): string[] => {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => String(id || "").trim())
    .filter((id, index, all) => UUID_REGEX.test(id) && all.indexOf(id) === index);
};

type WorkspaceMemberRow = {
  workspace_id: string;
};

type BoardRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type ColumnRow = {
  id: string;
  board_id: string;
  title: string;
  color_key: string | null;
  is_default: boolean | null;
  position: number | string;
  created_at: string;
};

type TicketRow = {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: TicketPriority | null;
  due_date: string | null;
  tags: string[] | null;
  assignee_ids: string[] | null;
  assigned_agent_id: string | null;
  auto_approve: boolean | null;
  scheduled_for: string | null;
  execution_state: string | null;
  checklist_done: number;
  checklist_total: number;
  attachments_count: number;
  comments_count: number;
  position: number | string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type TicketAttachmentRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  ticket_id: string;
  name: string;
  url: string;
  mime_type: string;
  size: number;
  path: string;
  created_by: string | null;
  created_at: string;
};

type TicketSubtaskRow = {
  id: string;
  ticket_id: string;
  title: string;
  completed: boolean;
  position: number | string;
  created_at: string;
  updated_at: string;
};

type TicketCommentRow = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
};

type TicketActivityRow = {
  id: string;
  ticket_id: string | null;
  source: string;
  event: string;
  details: string | null;
  level: string;
  occurred_at: string;
};

type PositionItem = {
  id: string;
  position: number;
};

const toNumber = (value: number | string) =>
  typeof value === "number" ? value : Number(value);

const resolveAssignedAgentId = async (
  client: ReturnType<typeof getBrowserSupabaseClient>,
  workspaceId: string,
  assignedAgentId: string | null | undefined,
): Promise<string | null | undefined> => {
  if (assignedAgentId === undefined) return undefined;

  const normalized = String(assignedAgentId || "").trim();
  if (!normalized) return null;

  if (UUID_REGEX.test(normalized)) {
    const { data, error } = await client
      .from("agents")
      .select("openclaw_agent_id")
      .eq("workspace_id", workspaceId)
      .eq("id", normalized)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const runtimeAgentId = String(data?.openclaw_agent_id || "").trim();
    return runtimeAgentId || null;
  }

  return normalized;
};

const getWorkspaceIdForBoard = async (
  client: ReturnType<typeof getBrowserSupabaseClient>,
  boardId: string,
): Promise<string> => {
  const { data, error } = await client
    .from("boards")
    .select("workspace_id")
    .eq("id", boardId)
    .single();

  if (error || !data?.workspace_id) {
    throw new Error(error?.message ?? "Board workspace not found.");
  }

  return data.workspace_id as string;
};

const getWorkspaceIdForTicket = async (
  client: ReturnType<typeof getBrowserSupabaseClient>,
  ticketId: string,
): Promise<string> => {
  const { data, error } = await client
    .from("tickets")
    .select("board_id")
    .eq("id", ticketId)
    .single();

  if (error || !data?.board_id) {
    throw new Error(error?.message ?? "Ticket board not found.");
  }

  return getWorkspaceIdForBoard(client, data.board_id as string);
};

const toAdapterUser = (user: User | null): AdapterUser | null => {
  if (!user?.email) {
    return null;
  }

  const rawName = user.user_metadata?.name;
  const fallbackName = user.email.split("@")[0] || "Openclaw User";
  const normalizedName =
    typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : fallbackName;
  const avatar = user.user_metadata?.avatar_url;

  return {
    id: user.id,
    email: user.email,
    name: normalizedName,
    avatarUrl: typeof avatar === "string" ? avatar : "",
  };
};

const toBoardRecord = (row: BoardRow): BoardRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.description ?? "",
  createdAt: row.created_at,
});

const toColumnRecord = (row: ColumnRow): ColumnRecord => ({
  id: row.id,
  boardId: row.board_id,
  title: row.title,
  colorKey: row.color_key,
  isDefault: row.is_default ?? false,
  position: toNumber(row.position),
  createdAt: row.created_at,
});

const toTicketRecord = (row: TicketRow): TicketRecord => ({
  id: row.id,
  boardId: row.board_id,
  columnId: row.column_id,
  title: row.title,
  description: row.description ?? "",
  priority: row.priority ?? "medium",
  dueDate: row.due_date,
  tags: row.tags ?? [],
  assigneeIds: row.assignee_ids ?? [],
  assignedAgentId: row.assigned_agent_id ?? "",
  autoApprove: Boolean(row.auto_approve),
  scheduledFor: row.scheduled_for,
  executionState:
    row.execution_state === "queued" ||
    row.execution_state === "picked_up" ||
    row.execution_state === "running" ||
    row.execution_state === "done" ||
    row.execution_state === "cancelled" ||
    row.execution_state === "failed"
      ? row.execution_state
      : "pending",
  checklistDone: row.checklist_done,
  checklistTotal: row.checklist_total,
  attachmentsCount: row.attachments_count,
  commentsCount: row.comments_count,
  position: toNumber(row.position),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTicketAttachmentRecord = (row: TicketAttachmentRow): TicketAttachmentRecord => ({
  id: row.id,
  ticketId: row.ticket_id,
  name: row.name,
  url: row.url,
  mimeType: row.mime_type,
  size: row.size,
  path: row.path,
  createdAt: row.created_at,
});

const toTicketSubtaskRecord = (row: TicketSubtaskRow): TicketSubtaskRecord => ({
  id: row.id,
  ticketId: row.ticket_id,
  title: row.title,
  completed: row.completed,
  position: toNumber(row.position),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTicketCommentRecord = (row: TicketCommentRow): TicketCommentRecord => ({
  id: row.id,
  ticketId: row.ticket_id,
  authorId: row.author_id,
  authorName: row.author_name?.trim() || "Unknown",
  content: row.content,
  createdAt: row.created_at,
});

const toTicketActivityLevel = (value: string): TicketActivityLevel => {
  if (value === "success" || value === "warning" || value === "error") {
    return value;
  }
  return "info";
};

const toTicketActivityRecord = (row: TicketActivityRow): TicketActivityRecord => ({
  id: row.id,
  ticketId: row.ticket_id ?? "",
  source: row.source,
  event: row.event,
  details: row.details ?? "",
  level: toTicketActivityLevel(row.level),
  occurredAt: row.occurred_at,
});

const computePosition = (previous: number | null, next: number | null) => {
  if (previous === null && next === null) return POSITION_STEP;
  if (previous === null && next !== null) return next / 2;
  if (previous !== null && next === null) return previous + POSITION_STEP;
  return ((previous as number) + (next as number)) / 2;
};

const positionNeedsRebalance = (previous: number | null, next: number | null) => {
  if (previous === null || next === null) return false;
  return next - previous < MIN_POSITION_GAP;
};

async function requireUserId() {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Error(error?.message ?? "You must be signed in.");
  }
  return data.user;
}

async function ensureProfile(user: User) {
  const client = getBrowserSupabaseClient();
  const fallbackName = user.email?.split("@")[0] || "Openclaw User";
  const userName =
    typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim()
      ? user.user_metadata.name.trim()
      : fallbackName;
  const avatar =
    typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null;

  const { error } = await client.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      name: userName,
      avatar_url: avatar,
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function getProfileName(userId: string) {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client
    .from("profiles")
    .select("name, email")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const name =
    typeof data?.name === "string" && data.name.trim()
      ? data.name.trim()
      : typeof data?.email === "string" && data.email.includes("@")
        ? data.email.split("@")[0]
        : "Openclaw User";

  return name;
}

async function getOrCreateWorkspaceId(user: User) {
  const client = getBrowserSupabaseClient();
  const { data: memberRows, error: memberError } = await client
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1);

  if (memberError) {
    throw new Error(memberError.message);
  }

  const existing = (memberRows as WorkspaceMemberRow[] | null)?.[0];
  if (existing?.workspace_id) {
    return existing.workspace_id;
  }

  const { data: workspaceRow, error: workspaceError } = await client
    .from("workspaces")
    .insert({
      owner_id: user.id,
      name: "My Workspace",
    })
    .select("id")
    .single();

  if (workspaceError || !workspaceRow?.id) {
    throw new Error(workspaceError?.message ?? "Failed to create workspace.");
  }

  const { error: memberInsertError } = await client.from("workspace_members").insert({
    workspace_id: workspaceRow.id,
    user_id: user.id,
    role: "owner",
  });

  if (memberInsertError) {
    throw new Error(memberInsertError.message);
  }

  return workspaceRow.id as string;
}

async function getTicketContext(ticketId: string) {
  const client = getBrowserSupabaseClient();
  const { data: ticketRow, error: ticketError } = await client
    .from("tickets")
    .select("id, board_id")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError || !ticketRow?.board_id) {
    throw new Error(ticketError?.message ?? "Ticket not found.");
  }

  const { data: boardRow, error: boardError } = await client
    .from("boards")
    .select("workspace_id")
    .eq("id", ticketRow.board_id as string)
    .maybeSingle();

  if (boardError || !boardRow?.workspace_id) {
    throw new Error(boardError?.message ?? "Board not found.");
  }

  return {
    ticketId: ticketRow.id as string,
    boardId: ticketRow.board_id as string,
    workspaceId: boardRow.workspace_id as string,
  };
}

function sanitizeFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80) || "file";
}

async function rebalanceTickets(columnId: string, orderedTicketIds?: string[]) {
  const client = getBrowserSupabaseClient();
  const ticketIds =
    orderedTicketIds ??
    (
      (
        await client
          .from("tickets")
          .select("id")
          .eq("column_id", columnId)
          .order("position", { ascending: true })
      ).data ?? []
    ).map((item) => item.id as string);

  await Promise.all(
    ticketIds.map((id, index) =>
      client
        .from("tickets")
        .update({ position: (index + 1) * POSITION_STEP })
        .eq("id", id)
        .eq("column_id", columnId),
    ),
  );
}

function getNeighborPositions(items: PositionItem[], beforeId: string | null) {
  if (items.length === 0) {
    return { previous: null as number | null, next: null as number | null };
  }

  if (!beforeId) {
    return {
      previous: items[items.length - 1]?.position ?? null,
      next: null,
    };
  }

  const nextIndex = items.findIndex((item) => item.id === beforeId);
  if (nextIndex < 0) {
    return {
      previous: items[items.length - 1]?.position ?? null,
      next: null,
    };
  }

  const previous = nextIndex > 0 ? items[nextIndex - 1]?.position ?? null : null;
  const next = items[nextIndex]?.position ?? null;
  return { previous, next };
}

export function createSupabaseAdapter(): TaskDataAdapter {
  return {
    async signUp(email, password) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client.auth.signUp({
        email,
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.user) {
        await ensureProfile(data.user);
        await getOrCreateWorkspaceId(data.user);
      }

      return toAdapterUser(data.user ?? null);
    },

    async signIn(email, password) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.user) {
        await ensureProfile(data.user);
        await getOrCreateWorkspaceId(data.user);
      }

      return toAdapterUser(data.user ?? null);
    },

    async signOut() {
      const client = getBrowserSupabaseClient();
      const { error } = await client.auth.signOut();
      if (error) {
        throw new Error(error.message);
      }
    },

    async getSession() {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) {
        throw new Error(error.message);
      }

      const session = data.session;
      if (!session) {
        return null;
      }

      return {
        accessToken: session.access_token,
        user: toAdapterUser(session.user),
      } satisfies AdapterSession;
    },

    async getUser() {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client.auth.getUser();
      if (error) {
        throw new Error(error.message);
      }
      return toAdapterUser(data.user ?? null);
    },

    async listBoards() {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("boards")
        .select("id, workspace_id, name, description, created_at")
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as BoardRow[]).map(toBoardRecord);
    },

    async getBoard(boardId) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("boards")
        .select("id, workspace_id, name, description, created_at")
        .eq("id", boardId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (!data) {
        return null;
      }

      return toBoardRecord(data as BoardRow);
    },

    async createBoard(payload) {
      const user = await requireUserId();
      await ensureProfile(user);

      const client = getBrowserSupabaseClient();
      const workspaceId = payload.workspaceId ?? (await getOrCreateWorkspaceId(user));

      const { data, error } = await client
        .from("boards")
        .insert({
          workspace_id: workspaceId,
          name: payload.name,
          description: payload.description ?? "",
        })
        .select("id, workspace_id, name, description, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create board.");
      }

      return toBoardRecord(data as BoardRow);
    },

    async updateBoard(boardId, patch) {
      const client = getBrowserSupabaseClient();
      const updatePayload: Record<string, string | null> = {};

      if (typeof patch.name === "string") {
        updatePayload.name = patch.name;
      }
      if (patch.description !== undefined) {
        updatePayload.description = patch.description;
      }

      const { data, error } = await client
        .from("boards")
        .update(updatePayload)
        .eq("id", boardId)
        .select("id, workspace_id, name, description, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to update board.");
      }

      return toBoardRecord(data as BoardRow);
    },

    async deleteBoard(boardId) {
      const client = getBrowserSupabaseClient();
      const { error } = await client.from("boards").delete().eq("id", boardId);
      if (error) {
        throw new Error(error.message);
      }
    },

    async listColumns(boardId) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("columns")
        .select("id, board_id, title, color_key, is_default, position, created_at")
        .eq("board_id", boardId)
        .order("position", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as ColumnRow[]).map(toColumnRecord);
    },

    async createColumn(boardId, payload) {
      const client = getBrowserSupabaseClient();
      const { data: existingRows, error: existingError } = await client
        .from("columns")
        .select("position")
        .eq("board_id", boardId)
        .order("position", { ascending: false })
        .limit(1);

      if (existingError) {
        throw new Error(existingError.message);
      }

      const lastPosition = toNumber((existingRows?.[0]?.position as number | string | undefined) ?? 0);
      const nextPosition = lastPosition > 0 ? lastPosition + POSITION_STEP : POSITION_STEP;

      const { data, error } = await client
        .from("columns")
        .insert({
          board_id: boardId,
          title: payload.title,
          color_key: payload.colorKey ?? null,
          is_default: payload.isDefault ?? false,
          position: nextPosition,
        })
        .select("id, board_id, title, color_key, is_default, position, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create column.");
      }

      return toColumnRecord(data as ColumnRow);
    },

    async updateColumn(columnId, patch) {
      const client = getBrowserSupabaseClient();
      const updatePayload: Record<string, string | boolean | null> = {};

      if (typeof patch.title === "string") {
        updatePayload.title = patch.title;
      }
      if (patch.colorKey !== undefined) {
        updatePayload.color_key = patch.colorKey;
      }
      if (patch.isDefault !== undefined) {
        updatePayload.is_default = patch.isDefault;
      }

      const { data, error } = await client
        .from("columns")
        .update(updatePayload)
        .eq("id", columnId)
        .select("id, board_id, title, color_key, is_default, position, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to update column.");
      }

      return toColumnRecord(data as ColumnRow);
    },

    async deleteColumn(columnId) {
      const client = getBrowserSupabaseClient();
      const { error } = await client.from("columns").delete().eq("id", columnId);
      if (error) {
        throw new Error(error.message);
      }
    },

    async reorderColumns(boardId, orderedColumnIds) {
      await Promise.all(
        orderedColumnIds.map((columnId, index) =>
          getBrowserSupabaseClient()
            .from("columns")
            .update({ position: (index + 1) * POSITION_STEP })
            .eq("id", columnId)
            .eq("board_id", boardId),
        ),
      );
    },

    async listTickets(boardId) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("tickets")
        .select(
          "id, board_id, column_id, title, description, priority, due_date, tags, assignee_ids, assigned_agent_id, auto_approve, scheduled_for, execution_state, checklist_done, checklist_total, attachments_count, comments_count, position, created_by, created_at, updated_at",
        )
        .eq("board_id", boardId)
        .order("column_id", { ascending: true })
        .order("position", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as TicketRow[]).map(toTicketRecord);
    },

    async createTicket(boardId, payload) {
      const user = await requireUserId();
      const client = getBrowserSupabaseClient();

      const { data: orderRows, error: orderError } = await client
        .from("tickets")
        .select("id, position")
        .eq("column_id", payload.columnId)
        .order("position", { ascending: true });

      if (orderError) {
        throw new Error(orderError.message);
      }

      let positionRows: PositionItem[] = ((orderRows ?? []) as Array<{ id: string; position: number | string }>).map(
        (row) => ({
          id: row.id,
          position: toNumber(row.position),
        }),
      );

      let { previous, next } = getNeighborPositions(positionRows, payload.beforeTicketId ?? null);
      if (positionNeedsRebalance(previous, next)) {
        await rebalanceTickets(payload.columnId, positionRows.map((item) => item.id));
        const { data: reloadedRows } = await client
          .from("tickets")
          .select("id, position")
          .eq("column_id", payload.columnId)
          .order("position", { ascending: true });
        positionRows = ((reloadedRows ?? []) as Array<{ id: string; position: number | string }>).map(
          (row) => ({
            id: row.id,
            position: toNumber(row.position),
          }),
        );
        ({ previous, next } = getNeighborPositions(positionRows, payload.beforeTicketId ?? null));
      }

      const position = computePosition(previous, next);
      const workspaceId = await getWorkspaceIdForBoard(client, boardId);
      const assignedAgentId = await resolveAssignedAgentId(
        client,
        workspaceId,
        payload.assignedAgentId,
      );

      const { data, error } = await client
        .from("tickets")
        .insert({
          board_id: boardId,
          column_id: payload.columnId,
          title: payload.title,
          description: payload.description ?? "",
          priority: payload.priority ?? "medium",
          due_date: payload.dueDate ?? null,
          tags: payload.tags ?? [],
          assignee_ids: toUuidAssigneeIds(payload.assigneeIds),
          assigned_agent_id: assignedAgentId ?? "",
          auto_approve: payload.autoApprove ?? false,
          scheduled_for: payload.scheduledFor ?? null,
          execution_state: "pending",
          checklist_done: payload.checklistDone ?? 0,
          checklist_total: payload.checklistTotal ?? 0,
          attachments_count: payload.attachmentsCount ?? 0,
          comments_count: payload.commentsCount ?? 0,
          position,
          created_by: user.id,
        })
        .select(
          "id, board_id, column_id, title, description, priority, due_date, tags, assignee_ids, assigned_agent_id, auto_approve, scheduled_for, execution_state, checklist_done, checklist_total, attachments_count, comments_count, position, created_by, created_at, updated_at",
        )
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create ticket.");
      }

      return toTicketRecord(data as TicketRow);
    },

    async updateTicket(ticketId, patch) {
      const client = getBrowserSupabaseClient();
      const updatePayload: Record<string, unknown> = {};

      if (patch.columnId !== undefined) updatePayload.column_id = patch.columnId;
      if (patch.title !== undefined) updatePayload.title = patch.title;
      if (patch.description !== undefined) updatePayload.description = patch.description;
      if (patch.priority !== undefined) updatePayload.priority = patch.priority;
      if (patch.dueDate !== undefined) updatePayload.due_date = patch.dueDate;
      if (patch.tags !== undefined) updatePayload.tags = patch.tags;
      if (patch.assigneeIds !== undefined) updatePayload.assignee_ids = toUuidAssigneeIds(patch.assigneeIds);
      if (patch.assignedAgentId !== undefined) {
        const workspaceId = await getWorkspaceIdForTicket(client, ticketId);
        const assignedAgentId = await resolveAssignedAgentId(
          client,
          workspaceId,
          patch.assignedAgentId,
        );
        updatePayload.assigned_agent_id = assignedAgentId ?? "";
      }
      if (patch.autoApprove !== undefined) updatePayload.auto_approve = patch.autoApprove;
      if (patch.scheduledFor !== undefined) updatePayload.scheduled_for = patch.scheduledFor;
      if (patch.executionState !== undefined) updatePayload.execution_state = patch.executionState;
      if (patch.checklistDone !== undefined) updatePayload.checklist_done = patch.checklistDone;
      if (patch.checklistTotal !== undefined) updatePayload.checklist_total = patch.checklistTotal;
      if (patch.attachmentsCount !== undefined) updatePayload.attachments_count = patch.attachmentsCount;
      if (patch.commentsCount !== undefined) updatePayload.comments_count = patch.commentsCount;

      const { data, error } = await client
        .from("tickets")
        .update(updatePayload)
        .eq("id", ticketId)
        .select(
          "id, board_id, column_id, title, description, priority, due_date, tags, assignee_ids, assigned_agent_id, auto_approve, scheduled_for, execution_state, checklist_done, checklist_total, attachments_count, comments_count, position, created_by, created_at, updated_at",
        )
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to update ticket.");
      }

      return toTicketRecord(data as TicketRow);
    },

    async deleteTicket(ticketId) {
      const client = getBrowserSupabaseClient();

      const { data: attachmentRows, error: attachmentError } = await client
        .from("ticket_attachments")
        .select("path")
        .eq("ticket_id", ticketId);

      if (attachmentError && attachmentError.code !== "42P01") {
        throw new Error(attachmentError.message);
      }

      const paths = ((attachmentRows ?? []) as Array<{ path: string | null }>)
        .map((row) => row.path)
        .filter((path): path is string => Boolean(path));

      if (paths.length > 0) {
        await client.storage.from("ticket-attachments").remove(paths);
      }

      const { error } = await client.from("tickets").delete().eq("id", ticketId);
      if (error) {
        throw new Error(error.message);
      }
    },

    async moveTicket(ticketId, payload) {
      const client = getBrowserSupabaseClient();

      const { data: ticketRow, error: ticketError } = await client
        .from("tickets")
        .select("id, column_id")
        .eq("id", ticketId)
        .single();

      if (ticketError || !ticketRow) {
        throw new Error(ticketError?.message ?? "Ticket not found.");
      }

      const { data: orderRows, error: orderError } = await client
        .from("tickets")
        .select("id, position")
        .eq("column_id", payload.toColumnId)
        .order("position", { ascending: true });

      if (orderError) {
        throw new Error(orderError.message);
      }

      let positionRows: PositionItem[] = ((orderRows ?? []) as Array<{ id: string; position: number | string }>)
        .map((row) => ({
          id: row.id,
          position: toNumber(row.position),
        }))
        .filter((row) => row.id !== ticketId);

      let { previous, next } = getNeighborPositions(positionRows, payload.beforeTicketId);
      if (positionNeedsRebalance(previous, next)) {
        await rebalanceTickets(payload.toColumnId, positionRows.map((item) => item.id));
        const { data: reloadedRows } = await client
          .from("tickets")
          .select("id, position")
          .eq("column_id", payload.toColumnId)
          .order("position", { ascending: true });
        positionRows = ((reloadedRows ?? []) as Array<{ id: string; position: number | string }>)
          .map((row) => ({
            id: row.id,
            position: toNumber(row.position),
          }))
          .filter((row) => row.id !== ticketId);
        ({ previous, next } = getNeighborPositions(positionRows, payload.beforeTicketId));
      }

      const position = computePosition(previous, next);
      const { error: updateError } = await client
        .from("tickets")
        .update({
          column_id: payload.toColumnId,
          position,
        })
        .eq("id", ticketId);

      if (updateError) {
        throw new Error(updateError.message);
      }
    },

    async reorderTickets(columnId, orderedTicketIds) {
      await Promise.all(
        orderedTicketIds.map((ticketId, index) =>
          getBrowserSupabaseClient()
            .from("tickets")
            .update({ position: (index + 1) * POSITION_STEP })
            .eq("id", ticketId)
            .eq("column_id", columnId),
        ),
      );
    },

    async listTicketAttachments(ticketId) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("ticket_attachments")
        .select("id, workspace_id, board_id, ticket_id, name, url, mime_type, size, path, created_by, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      const rows = (data ?? []) as TicketAttachmentRow[];
      const records = rows.map(toTicketAttachmentRecord);

      const signedUrls = await Promise.all(
        rows.map(async (row) => {
          if (!row.path) return "";
          const { data: signedData } = await client.storage
            .from("ticket-attachments")
            .createSignedUrl(row.path, 60 * 60);
          return signedData?.signedUrl ?? "";
        }),
      );

      return records.map((record, index) => ({
        ...record,
        url: signedUrls[index] || record.url,
      }));
    },

    async uploadTicketAttachment(ticketId, file) {
      const user = await requireUserId();
      const { boardId, workspaceId } = await getTicketContext(ticketId);
      const client = getBrowserSupabaseClient();

      const sanitizedName = sanitizeFileName(file.name);
      const randomSuffix = Math.random().toString(36).slice(2, 8);
      const path = `${workspaceId}/${ticketId}/${Date.now()}-${randomSuffix}-${sanitizedName}`;

      const { error: uploadError } = await client.storage
        .from("ticket-attachments")
        .upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: signedData } = await client.storage
        .from("ticket-attachments")
        .createSignedUrl(path, 60 * 60);

      const { data, error } = await client
        .from("ticket_attachments")
        .insert({
          workspace_id: workspaceId,
          board_id: boardId,
          ticket_id: ticketId,
          name: file.name,
          url: signedData?.signedUrl ?? "",
          mime_type: file.type || "application/octet-stream",
          size: file.size,
          path,
          created_by: user.id,
        })
        .select("id, workspace_id, board_id, ticket_id, name, url, mime_type, size, path, created_by, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to save attachment.");
      }

      return toTicketAttachmentRecord(data as TicketAttachmentRow);
    },

    async deleteTicketAttachment(attachmentId) {
      const client = getBrowserSupabaseClient();
      const { data: existing, error: findError } = await client
        .from("ticket_attachments")
        .select("id, path")
        .eq("id", attachmentId)
        .maybeSingle();

      if (findError) {
        throw new Error(findError.message);
      }

      if (!existing) {
        return;
      }

      const { error: deleteError } = await client
        .from("ticket_attachments")
        .delete()
        .eq("id", attachmentId);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      if (existing.path) {
        await client.storage
          .from("ticket-attachments")
          .remove([existing.path as string]);
      }
    },

    async listTicketSubtasks(ticketId) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("ticket_subtasks")
        .select("id, ticket_id, title, completed, position, created_at, updated_at")
        .eq("ticket_id", ticketId)
        .order("position", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as TicketSubtaskRow[]).map(toTicketSubtaskRecord);
    },

    async createTicketSubtask(ticketId: string, payload: CreateTicketSubtaskPayload) {
      const client = getBrowserSupabaseClient();
      const { data: existingRows, error: existingError } = await client
        .from("ticket_subtasks")
        .select("position")
        .eq("ticket_id", ticketId)
        .order("position", { ascending: false })
        .limit(1);

      if (existingError) {
        throw new Error(existingError.message);
      }

      const lastPosition = toNumber((existingRows?.[0]?.position as number | string | undefined) ?? 0);
      const nextPosition = lastPosition > 0 ? lastPosition + POSITION_STEP : POSITION_STEP;

      const { data, error } = await client
        .from("ticket_subtasks")
        .insert({
          ticket_id: ticketId,
          title: payload.title.trim(),
          completed: false,
          position: nextPosition,
        })
        .select("id, ticket_id, title, completed, position, created_at, updated_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create subtask.");
      }

      return toTicketSubtaskRecord(data as TicketSubtaskRow);
    },

    async updateTicketSubtask(subtaskId: string, patch: UpdateTicketSubtaskPatch) {
      const client = getBrowserSupabaseClient();
      const updatePayload: Record<string, string | boolean> = {};

      if (patch.title !== undefined) updatePayload.title = patch.title;
      if (patch.completed !== undefined) updatePayload.completed = patch.completed;

      const { data, error } = await client
        .from("ticket_subtasks")
        .update(updatePayload)
        .eq("id", subtaskId)
        .select("id, ticket_id, title, completed, position, created_at, updated_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to update subtask.");
      }

      return toTicketSubtaskRecord(data as TicketSubtaskRow);
    },

    async deleteTicketSubtask(subtaskId) {
      const client = getBrowserSupabaseClient();
      const { error } = await client.from("ticket_subtasks").delete().eq("id", subtaskId);
      if (error) {
        throw new Error(error.message);
      }
    },

    async listTicketComments(ticketId) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("ticket_comments")
        .select("id, ticket_id, author_id, author_name, content, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as TicketCommentRow[]).map(toTicketCommentRecord);
    },

    async createTicketComment(ticketId, content) {
      const user = await requireUserId();
      await ensureProfile(user);
      const authorName = await getProfileName(user.id);
      const client = getBrowserSupabaseClient();

      const { data, error } = await client
        .from("ticket_comments")
        .insert({
          ticket_id: ticketId,
          author_id: user.id,
          author_name: authorName,
          content: content.trim(),
        })
        .select("id, ticket_id, author_id, author_name, content, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to add comment.");
      }

      return toTicketCommentRecord(data as TicketCommentRow);
    },

    async deleteTicketComment(commentId) {
      const client = getBrowserSupabaseClient();
      const { error } = await client.from("ticket_comments").delete().eq("id", commentId);
      if (error) {
        throw new Error(error.message);
      }
    },

    async listTicketActivity(ticketId) {
      const client = getBrowserSupabaseClient();
      const { data, error } = await client
        .from("activity_logs")
        .select("id, ticket_id, source, event, details, level, occurred_at")
        .eq("ticket_id", ticketId)
        .order("occurred_at", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as TicketActivityRow[]).map(toTicketActivityRecord);
    },

    async createTicketActivity(ticketId, payload: CreateTicketActivityPayload) {
      const event = payload.event.trim();
      if (!event) {
        throw new Error("Activity event is required.");
      }

      const { workspaceId } = await getTicketContext(ticketId);
      const client = getBrowserSupabaseClient();
      const source =
        typeof payload.source === "string" && payload.source.trim().length > 0
          ? payload.source.trim()
          : "Tasks";
      const level = payload.level ?? "info";
      const details = typeof payload.details === "string" ? payload.details.trim() : "";

      const { data, error } = await client
        .from("activity_logs")
        .insert({
          workspace_id: workspaceId,
          ticket_id: ticketId,
          source,
          event,
          details,
          level,
        })
        .select("id, ticket_id, source, event, details, level, occurred_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create activity.");
      }

      return toTicketActivityRecord(data as TicketActivityRow);
    },
  };
}
