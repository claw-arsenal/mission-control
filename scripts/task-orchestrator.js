#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || "/home/clawdbot", ".openclaw");
const ENV_PATH = process.env.DASHBOARD_ENV_PATH || "/etc/clawd/template.env";
const LOOP_MS = Math.max(3000, Number(process.env.TASK_ORCHESTRATOR_LOOP_MS || 8000));
const ALERT_CHANNEL = process.env.DASHBOARD_ALERT_CHANNEL || "telegram";
const ALERT_TARGET = process.env.DASHBOARD_ALERT_TARGET || "";
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const source = fs.readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const idx = raw.indexOf("=");
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(OPENCLAW_HOME, ".env"));
loadEnvFile(ENV_PATH);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[task-orchestrator] missing supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const priorityRank = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const retryTracker = new Map();
const retryBackoffMs = [60_000, 5 * 60_000, 15 * 60_000];

function toTs(value) {
  if (!value) return null;
  const ts = new Date(value).valueOf();
  return Number.isFinite(ts) ? ts : null;
}

function isDue(ticket) {
  const now = Date.now();
  const scheduledTs = toTs(ticket.scheduled_for);
  if (scheduledTs != null && scheduledTs > now) return false;
  return true;
}

function columnTitleById(columns) {
  const map = new Map();
  for (const c of columns) {
    map.set(c.id, String(c.title || "").trim().toLowerCase());
  }
  return map;
}

function isTodoTitle(title) {
  return title === "to-do" || title === "todo" || title === "planned";
}

function isInProgressTitle(title) {
  return title === "in progress" || title === "doing";
}

function isCompletedTitle(title) {
  return title === "completed" || title === "done";
}

function boardInProgressColumn(columns) {
  const map = new Map();
  for (const c of columns) {
    const title = String(c.title || "").trim().toLowerCase();
    if (!isInProgressTitle(title)) continue;
    map.set(c.board_id, c.id);
  }
  return map;
}

function boardCompletedColumn(columns) {
  const map = new Map();
  for (const c of columns) {
    const title = String(c.title || "").trim().toLowerCase();
    if (!isCompletedTitle(title)) continue;
    map.set(c.board_id, c.id);
  }
  return map;
}

async function loadWorkspaceNotificationTargets(workspaceId, eventType) {
  const { data, error } = await supabase
    .from("notification_channels")
    .select("provider,target,enabled,events")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  if (error) return [];

  return (data || [])
    .filter((row) => {
      const events = Array.isArray(row.events) ? row.events.map((item) => String(item || "")) : [];
      return events.length === 0 || events.includes(eventType);
    })
    .map((row) => ({
      channel: String(row.provider || "").trim() || "telegram",
      target: String(row.target || "").trim(),
    }))
    .filter((row) => row.target);
}

function sendAlertMessage(channel, target, message) {
  return new Promise((resolve) => {
    execFile(
      OPENCLAW_BIN,
      ["message", "send", "--channel", channel, "--target", target, "--message", message],
      { timeout: 10_000 },
      () => resolve(),
    );
  });
}

async function sendAlert(workspaceId, eventType, message) {
  const channels = await loadWorkspaceNotificationTargets(workspaceId, eventType);
  if (channels.length === 0 && ALERT_TARGET) {
    await sendAlertMessage(ALERT_CHANNEL, ALERT_TARGET, message);
    return;
  }

  for (const channel of channels) {
    await sendAlertMessage(channel.channel, channel.target, message);
  }
}

function runAssignedAgentTicket(ticket, runtimeAgentId, openSubtasks, shouldCancel) {
  const title = String(ticket.title || "").trim();
  const description = String(ticket.description || "").trim();
  const priority = String(ticket.priority || "medium");
  const due = ticket.due_date || "none";
  const scheduled = ticket.scheduled_for || "now";

  const subtasksLine =
    openSubtasks.length > 0
      ? [
          "Open subtasks (treat as explicit checklist context):",
          ...openSubtasks.map((subtask, idx) => `${idx + 1}. ${subtask}`),
        ].join("\n")
      : "Open subtasks: (none)";

  const taskMessage = [
    `Execute assigned ticket ${ticket.id}.`,
    `Title: ${title}`,
    `Priority: ${priority}`,
    `Due: ${due}`,
    `Scheduled: ${scheduled}`,
    description ? `Description: ${description}` : "Description: (empty)",
    subtasksLine,
    "Reply with a concise completion summary and explicit outcome.",
  ].join("\n");

  return new Promise((resolve) => {
    const child = require("child_process").spawn(
      OPENCLAW_BIN,
      ["agent", "--agent", runtimeAgentId, "--message", taskMessage, "--json", "--timeout", "900"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setInterval(async () => {
      if (done) return;
      const cancelled = await shouldCancel();
      if (!cancelled) return;
      done = true;
      clearInterval(timer);
      child.kill("SIGTERM");
      resolve({ ok: false, output: stdout.slice(0, 2000), error: "cancelled" });
    }, 3000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
      if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (code !== 0) {
        resolve({ ok: false, output: stdout.slice(0, 2000), error: stderr || `agent exit code ${code}` });
        return;
      }
      resolve({ ok: true, output: stdout.slice(0, 2000), error: "" });
    });
  });
}

async function appendActivity(workspaceId, ticketId, event, details, level = "info") {
  await supabase.from("activity_logs").insert({
    workspace_id: workspaceId,
    ticket_id: ticketId,
    source: "Agent",
    event,
    details,
    level,
  });
}

async function appendAgentLog(workspaceId, agentRow, message, eventType = "system.warning", level = "info") {
  if (!agentRow?.id) return;
  await supabase.from("agent_logs").insert({
    workspace_id: workspaceId,
    agent_id: agentRow.id,
    runtime_agent_id: agentRow.openclaw_agent_id || "",
    level,
    type: "workflow",
    event_type: eventType,
    direction: "internal",
    channel_type: "internal",
    run_id: "",
    source_message_id: "",
    correlation_id: "",
    message,
    contains_pii: false,
  });
}

async function runOnce() {
  const [boardsRes, columnsRes, ticketsRes, agentsRes] = await Promise.all([
    supabase.from("boards").select("id,workspace_id"),
    supabase.from("columns").select("id,board_id,title"),
    supabase
      .from("tickets")
      .select("id,board_id,column_id,title,description,priority,due_date,created_at,auto_approve,assigned_agent_id,scheduled_for,execution_state")
      .neq("assigned_agent_id", ""),
    supabase.from("agents").select("id,workspace_id,openclaw_agent_id"),
  ]);

  for (const result of [boardsRes, columnsRes, ticketsRes, agentsRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const boards = boardsRes.data || [];
  const columns = columnsRes.data || [];
  const tickets = ticketsRes.data || [];
  const agents = agentsRes.data || [];

  const workspaceByBoard = new Map(boards.map((b) => [b.id, b.workspace_id]));
  const colTitleById = columnTitleById(columns);
  const inProgressByBoard = boardInProgressColumn(columns);
  const completedByBoard = boardCompletedColumn(columns);
  const agentByWorkspaceRuntimeId = new Map();
  for (const a of agents) {
    const key = `${a.workspace_id}|${String(a.openclaw_agent_id || "").trim()}`;
    agentByWorkspaceRuntimeId.set(key, a);
  }

  // cancellation when leaving In progress
  for (const ticket of tickets) {
    const workspaceId = workspaceByBoard.get(ticket.board_id);
    if (!workspaceId) continue;

    const state = String(ticket.execution_state || "pending");
    const colTitle = colTitleById.get(ticket.column_id) || "";
    if (!["queued", "picked_up", "running"].includes(state)) continue;
    if (isInProgressTitle(colTitle)) continue;

    const { error } = await supabase
      .from("tickets")
      .update({ execution_state: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", ticket.id)
      .eq("execution_state", state);
    if (error) continue;

    const cancelMsg = `Task cancelled (left In progress): ${ticket.title}`;
    await appendActivity(workspaceId, ticket.id, "ticket.cancelled", "Execution cancelled (ticket left In progress)", "warning");
    const cancelAgentRow = agentByWorkspaceRuntimeId.get(`${workspaceId}|${String(ticket.assigned_agent_id || "").trim()}`);
    await appendAgentLog(workspaceId, cancelAgentRow, cancelMsg, "system.shutdown", "warning");
  }

  // sync done state -> Completed column
  for (const ticket of tickets) {
    const workspaceId = workspaceByBoard.get(ticket.board_id);
    if (!workspaceId) continue;
    const state = String(ticket.execution_state || "pending");
    if (state !== "done") continue;

    const completedColumnId = completedByBoard.get(ticket.board_id);
    if (!completedColumnId || ticket.column_id === completedColumnId) continue;

    const { error } = await supabase
      .from("tickets")
      .update({ column_id: completedColumnId, completed_at: new Date().toISOString() })
      .eq("id", ticket.id)
      .eq("execution_state", "done");
    if (error) continue;

    await appendActivity(workspaceId, ticket.id, "ticket.completed", "Ticket moved to Completed by orchestrator", "success");
    const doneAgentRow = agentByWorkspaceRuntimeId.get(`${workspaceId}|${String(ticket.assigned_agent_id || "").trim()}`);
    await appendAgentLog(workspaceId, doneAgentRow, `Task completed, moved to Completed: ${ticket.title}`, "tool.success");
  }

  // auto move To-do -> In progress for auto-approved and due tickets
  for (const ticket of tickets) {
    const workspaceId = workspaceByBoard.get(ticket.board_id);
    if (!workspaceId) continue;
    const colTitle = colTitleById.get(ticket.column_id) || "";
    if (!isTodoTitle(colTitle)) continue;
    if (!ticket.auto_approve) continue;
    if (!isDue(ticket)) continue;

    const inProgressColumnId = inProgressByBoard.get(ticket.board_id);
    if (!inProgressColumnId) continue;

    const { error } = await supabase
      .from("tickets")
      .update({ column_id: inProgressColumnId, execution_state: "queued", cancelled_at: null })
      .eq("id", ticket.id)
      .eq("column_id", ticket.column_id);
    if (error) continue;

    const queuedMsg = `Ticket queued for execution: ${ticket.title} | priority=${ticket.priority} | scheduled=${ticket.scheduled_for || "now"}`;
    await appendActivity(workspaceId, ticket.id, "ticket.queued", queuedMsg, "info");
    const queuedAgentRow = agentByWorkspaceRuntimeId.get(`${workspaceId}|${String(ticket.assigned_agent_id || "").trim()}`);
    await appendAgentLog(workspaceId, queuedAgentRow, queuedMsg, "system.startup");
    await sendAlert(workspaceId, "ticket.queued", `🗂️ ${queuedMsg}`);
  }

  // pick up queued/pending In progress tickets with per-agent priority/FIFO ordering
  const candidates = tickets.filter((ticket) => {
    const colTitle = colTitleById.get(ticket.column_id) || "";
    if (!isInProgressTitle(colTitle)) return false;
    const state = String(ticket.execution_state || "pending");
    if (!(state === "pending" || state === "queued")) return false;
    if (!isDue(ticket)) return false;
    return true;
  });

  const grouped = new Map();
  for (const ticket of candidates) {
    const workspaceId = workspaceByBoard.get(ticket.board_id);
    if (!workspaceId) continue;
    const key = `${workspaceId}|${ticket.assigned_agent_id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ticket);
  }

  for (const [key, group] of grouped.entries()) {
    const [workspaceId, runtimeAgentId] = key.split("|");
    const agentRow = agentByWorkspaceRuntimeId.get(`${workspaceId}|${runtimeAgentId}`);
    if (!agentRow) continue;

    group.sort((a, b) => {
      const pa = priorityRank[a.priority] || 1;
      const pb = priorityRank[b.priority] || 1;
      if (pa !== pb) return pb - pa;

      const da = toTs(a.due_date);
      const db = toTs(b.due_date);
      if (da != null && db != null && da !== db) return da - db;
      if (da != null && db == null) return -1;
      if (da == null && db != null) return 1;

      const ca = toTs(a.created_at) || 0;
      const cb = toTs(b.created_at) || 0;
      return ca - cb;
    });

    const ticket = group[0];
    if (!ticket) continue;

    const { error } = await supabase
      .from("tickets")
      .update({ execution_state: "picked_up", picked_up_at: new Date().toISOString(), cancelled_at: null })
      .eq("id", ticket.id)
      .in("execution_state", ["pending", "queued"]);
    if (error) continue;

    const notify = `Picked up task: ${ticket.title} | priority=${ticket.priority} | due=${ticket.due_date || "none"}`;
    await appendActivity(workspaceId, ticket.id, "ticket.picked_up", notify, "info");
    await appendAgentLog(workspaceId, agentRow, notify, "tool.start");
    await sendAlert(workspaceId, "ticket.picked_up", `🤖 ${notify} | agent=${runtimeAgentId}`);

    const { error: runningError } = await supabase
      .from("tickets")
      .update({ execution_state: "running" })
      .eq("id", ticket.id)
      .eq("execution_state", "picked_up");
    if (runningError) continue;

    const runningMsg = `Started execution: ${ticket.title} | agent=${runtimeAgentId}`;
    await appendActivity(workspaceId, ticket.id, "ticket.running", `Started execution with agent ${runtimeAgentId}`, "info");
    await appendAgentLog(workspaceId, agentRow, runningMsg, "tool.start");

    const { data: subtaskRows, error: subtaskError } = await supabase
      .from("ticket_subtasks")
      .select("title, completed, position")
      .eq("ticket_id", ticket.id)
      .order("position", { ascending: true });

    if (subtaskError) {
      await appendAgentLog(
        workspaceId,
        agentRow,
        `Unable to load subtasks for ${ticket.title}: ${subtaskError.message}`,
      );
    }

    const openSubtasks = (subtaskRows || [])
      .filter((row) => row && row.completed !== true)
      .map((row) => String(row.title || "").trim())
      .filter(Boolean);

    const execution = await runAssignedAgentTicket(ticket, runtimeAgentId, openSubtasks, async () => {
      const { data } = await supabase
        .from("tickets")
        .select("column_id,execution_state")
        .eq("id", ticket.id)
        .limit(1)
        .maybeSingle();
      if (!data) return true;
      const currentTitle = colTitleById.get(data.column_id) || "";
      if (!isInProgressTitle(currentTitle)) return true;
      return String(data.execution_state || "") === "cancelled";
    });
    if (!execution.ok) {
      if (execution.error === "cancelled") {
        await supabase
          .from("tickets")
          .update({ execution_state: "cancelled", cancelled_at: new Date().toISOString() })
          .eq("id", ticket.id)
          .eq("execution_state", "running");
        await appendActivity(workspaceId, ticket.id, "ticket.cancelled", "Execution interrupted by ticket state change", "warning");
        await appendAgentLog(workspaceId, agentRow, `Task execution cancelled: ${ticket.title}`, "system.shutdown", "warning");
        await sendAlert(workspaceId, "ticket.cancelled", `🛑 Task cancelled: ${ticket.title} | agent=${runtimeAgentId}`);
        continue;
      }

      const retryCount = (retryTracker.get(ticket.id) || 0) + 1;
      retryTracker.set(ticket.id, retryCount);
      const maxRetries = retryBackoffMs.length;
      if (retryCount <= maxRetries) {
        const backoffMs = retryBackoffMs[retryCount - 1] || retryBackoffMs[retryBackoffMs.length - 1];
        const nextScheduledAt = new Date(Date.now() + backoffMs).toISOString();
        await supabase
          .from("tickets")
          .update({ execution_state: "queued", scheduled_for: nextScheduledAt })
          .eq("id", ticket.id)
          .eq("execution_state", "running");
        await appendActivity(
          workspaceId,
          ticket.id,
          "ticket.retry_scheduled",
          `Execution failed (${runtimeAgentId}). Retry ${retryCount}/${maxRetries} at ${nextScheduledAt}`,
          "warning",
        );
        await appendAgentLog(
          workspaceId,
          agentRow,
          `Task retry scheduled: ${ticket.title} (retry ${retryCount}/${maxRetries}): ${String(execution.error || "unknown error").slice(0, 240)}`,
          "system.warning",
          "warning",
        );
        await sendAlert(workspaceId, "ticket.retry_scheduled", `⚠️ Task retry scheduled: ${ticket.title} | agent=${runtimeAgentId} | retry ${retryCount}/${maxRetries}`);
        continue;
      }

      await supabase
        .from("tickets")
        .update({ execution_state: "failed" })
        .eq("id", ticket.id)
        .eq("execution_state", "running");
      await appendActivity(
        workspaceId,
        ticket.id,
        "ticket.failed",
        `Execution failed (${runtimeAgentId}): ${String(execution.error || "unknown error").slice(0, 400)}`,
        "error",
      );
      await appendAgentLog(
        workspaceId,
        agentRow,
        `Task execution failed: ${ticket.title}: ${String(execution.error || "unknown error").slice(0, 400)}`,
        "system.error",
        "error",
      );
      await sendAlert(workspaceId, "ticket.failed", `❌ Task failed: ${ticket.title} | agent=${runtimeAgentId} | ${String(execution.error || "unknown").slice(0, 240)}`);
      continue;
    }

    retryTracker.delete(ticket.id);

    await supabase
      .from("tickets")
      .update({ execution_state: "done", completed_at: new Date().toISOString() })
      .eq("id", ticket.id)
      .eq("execution_state", "running");

    await appendActivity(
      workspaceId,
      ticket.id,
      "ticket.done",
      `Execution completed by ${runtimeAgentId}. Summary: ${String(execution.output || "").slice(0, 400)}`,
      "success",
    );
    await appendAgentLog(
      workspaceId,
      agentRow,
      `Task execution completed: ${ticket.title}. Summary: ${String(execution.output || "").slice(0, 400)}`,
      "tool.success",
    );
    await sendAlert(workspaceId, "ticket.done", `✅ Task completed: ${ticket.title} | agent=${runtimeAgentId}`);
  }
}

async function loop() {
  while (true) {
    try {
      await runOnce();
    } catch (error) {
      console.error("[task-orchestrator]", error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_MS));
  }
}

loop();
