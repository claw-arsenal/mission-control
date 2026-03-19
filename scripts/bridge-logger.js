#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const OPENCLAW_HOME = path.join(HOME, ".openclaw");
const TEMPLATE_ENV_PATH =
  process.env.DASHBOARD_TEMPLATE_ENV ||
  "/etc/clawd/template.env";
const LOGGER_PATH = path.join(OPENCLAW_HOME, "bridge-logger.js");
const AGENTS_DIR = path.join(OPENCLAW_HOME, "agents");
const GATEWAY_LOG_DIR = "/tmp/openclaw";
const DEAD_LETTER_PATH = path.join(OPENCLAW_HOME, "bridge-dead-letter.jsonl");
const OFFSETS_PATH = path.join(OPENCLAW_HOME, "bridge-offsets.json");

const HEARTBEAT_MS = 45_000;
const SESSION_SCAN_MS = 5_000;
const GATEWAY_SCAN_MS = 12_000;
const DEAD_LETTER_REPLAY_MS = 30_000;
const IDLE_AFTER_MS = 180_000;
const MAX_MESSAGE_CHARS = 4_000;
const UI_MESSAGE_CHARS = 900;
const PREVIEW_CHARS = 240;
const DEDUPE_WINDOW_MS = 30_000;
const DEDUPE_LIMIT = 10_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 160;
const DEAD_LETTER_BATCH_SIZE = 100;
const LIVE_EVENTS_CHANNEL = "agent-logs-live";

const REQUIRED_ENV_KEYS = [
  "OPENCLAW_WORKSPACE_ID",
  "OPENCLAW_AGENT_ID",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const dedupeMap = new Map();
const recentLogTimes = [];
let replayInFlight = false;

let supabase;
let liveChannel = null;
let liveChannelReady = false;
let workspaceId = "";
let agentId = "";
let supportsRuntimeAgentIdColumn = false;
let currentStatus = "idle";
let currentAgentModel = "unknown";
let heartbeatFailures = 0;
let lastSessionActivityAt = Date.now();

const watchedSessions = new Set();
const watchedGatewayLogs = new Set();
const seenToolEvents = new Set();
const fileOffsets = new Map();
let offsetsDirty = false;
let offsetsFlushTimer = null;

function loadEnvFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

function mustEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env: ${key}`);
  return value;
}

function resolveSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!value) {
    throw new Error("Missing required env: NEXT_PUBLIC_SUPABASE_URL");
  }
  return value;
}

function hasRequiredEnv() {
  return REQUIRED_ENV_KEYS.every((key) => Boolean(process.env[key]));
}

function loadEnvironment() {
  if (hasRequiredEnv()) return [];

  const candidates = [TEMPLATE_ENV_PATH].filter(Boolean);

  const loaded = [];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    loadEnvFile(filePath);
    loaded.push(filePath);
    if (hasRequiredEnv()) break;
  }

  return loaded;
}

function toIsoNow() {
  return new Date().toISOString();
}

function loadOffsets() {
  try {
    if (!fs.existsSync(OFFSETS_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(OFFSETS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    for (const [filePath, offset] of Object.entries(parsed)) {
      if (!Number.isFinite(offset)) continue;
      fileOffsets.set(filePath, Math.max(0, Number(offset)));
    }
  } catch {
    // ignore malformed offsets; logger can continue from file end.
  }
}

function scheduleOffsetsFlush() {
  if (offsetsFlushTimer) return;
  offsetsFlushTimer = setTimeout(() => {
    offsetsFlushTimer = null;
    if (!offsetsDirty) return;
    offsetsDirty = false;
    try {
      const out = {};
      for (const [filePath, offset] of fileOffsets.entries()) {
        out[filePath] = offset;
      }
      fs.writeFileSync(OFFSETS_PATH, JSON.stringify(out));
    } catch {
      offsetsDirty = true;
    }
  }, 300);
}

function setFileOffset(filePath, offset) {
  fileOffsets.set(filePath, Math.max(0, Number(offset) || 0));
  offsetsDirty = true;
  scheduleOffsetsFlush();
}

function getFileOffset(filePath) {
  const offset = fileOffsets.get(filePath);
  return Number.isFinite(offset) ? Math.max(0, Number(offset)) : null;
}

function cleanText(input) {
  let out = String(input || "");
  out = out.replace(/\[\[\s*reply_to_current\s*\]\]/gi, " ");
  out = out.replace(/\[\[\s*reply_to:\s*[^\]]+\]\]/gi, " ");
  out = out.replace(/(?:^|\n)Conversation info[^\n]*:\s*```[\s\S]*?```/gi, " ");
  out = out.replace(/(?:^|\n)Sender[^\n]*:\s*```[\s\S]*?```/gi, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out.slice(0, MAX_MESSAGE_CHARS);
}

function redactSecrets(input) {
  let out = cleanText(input);
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, "Bearer [REDACTED]");
  out = out.replace(/\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[REDACTED_JWT]");
  out = out.replace(/\b(sb_(?:publishable|secret)_[A-Za-z0-9._-]+)\b/g, "[REDACTED_SUPABASE_KEY]");
  out = out.replace(
    /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^"',\s]+/gi,
    (_full, keyName) => `${keyName}=[REDACTED]`,
  );
  return out.slice(0, MAX_MESSAGE_CHARS);
}

function containsPii(text) {
  const source = String(text || "");
  if (!source) return false;
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(source)) return true;
  if (/\+\d{7,15}\b/.test(source)) return true;
  return false;
}

function previewFromMessage(message) {
  return cleanText(message).slice(0, PREVIEW_CHARS);
}

function detectJsonPayload(value) {
  if (!value || typeof value !== "string") return { isJson: false, payload: null };
  const source = value.trim();
  if (!source) return { isJson: false, payload: null };
  try {
    return { isJson: true, payload: JSON.parse(source) };
  } catch {
    return { isJson: false, payload: null };
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function readTextPieces(value, depth = 0) {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => readTextPieces(item, depth + 1));
  if (typeof value === "object") {
    const keys = ["text", "input_text", "output_text", "message", "input", "output", "content", "value"];
    return keys.flatMap((key) => readTextPieces(value[key], depth + 1));
  }
  return [];
}

function flattenRecordText(record) {
  const fromContent = cleanText(readTextPieces(record?.content).join(" "));
  if (fromContent) return fromContent;

  const candidates = [record?.text, record?.message, record?.input, record?.output, record?.final, record?.response];
  for (const candidate of candidates) {
    const text = cleanText(readTextPieces(candidate).join(" "));
    if (text) return text;
  }
  return "";
}

function normalizeModelName(value) {
  const model = String(value || "").trim();
  if (!model) return "";
  return model.slice(0, 160);
}

function normalizeRecord(raw) {
  const nested = raw?.message && typeof raw.message === "object" ? raw.message : raw;
  return {
    role: nested?.role || raw?.role || "",
    content: nested?.content || raw?.content || [],
    text: nested?.text || raw?.text || nested?.message || raw?.message || "",
    runId:
      nested?.id ||
      raw?.id ||
      nested?.response_id ||
      raw?.response_id ||
      nested?.run_id ||
      raw?.run_id ||
      "",
    sourceMessageId:
      nested?.message_id ||
      raw?.message_id ||
      nested?.id ||
      raw?.id ||
      raw?.timestamp ||
      nested?.timestamp ||
      "",
    model:
      nested?.model ||
      raw?.model ||
      nested?.model_name ||
      raw?.model_name ||
      raw?.provider_model ||
      nested?.provider_model ||
      nested?.response?.model ||
      raw?.response?.model ||
      nested?.api?.model ||
      raw?.api?.model ||
      nested?.meta?.model ||
      raw?.meta?.model ||
      "",
    stopReason: nested?.stopReason || raw?.stopReason || "",
    error: nested?.error || raw?.error || null,
    toolCalls: nested?.toolCalls || raw?.toolCalls || [],
    eventType:
      nested?.event_type ||
      raw?.event_type ||
      nested?.eventType ||
      raw?.eventType ||
      nested?.type ||
      raw?.type ||
      "",
  };
}

function hasTypingSignal(raw, normalized) {
  const role = String(normalized?.role || "").toLowerCase();
  if (role !== "assistant") return false;

  const eventType = String(normalized?.eventType || "").toLowerCase();
  if (eventType.includes("typing")) return true;

  const text = String(normalized?.text || "").trim().toLowerCase();
  if (text === "typing" || text === "assistant is typing") return true;

  const content = Array.isArray(normalized?.content) ? normalized.content : [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const itemType = String(item.type || item.event_type || item.eventType || "").toLowerCase();
    if (itemType.includes("typing")) return true;
  }

  const rawType = String(raw?.type || raw?.event_type || raw?.eventType || "").toLowerCase();
  return rawType.includes("typing");
}

function extractToolCalls(record) {
  const calls = [];
  const pushCall = (value) => {
    if (value && typeof value === "object") calls.push(value);
  };

  if (Array.isArray(record?.toolCalls)) record.toolCalls.forEach(pushCall);
  if (Array.isArray(record?.tools)) record.tools.forEach(pushCall);
  if (record?.tool_call && typeof record.tool_call === "object") pushCall(record.tool_call);

  const content = Array.isArray(record?.content) ? record.content : [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "toolCall" || item.type === "tool_call" || item.type === "tool") pushCall(item);
    if (item.toolCall && typeof item.toolCall === "object") pushCall(item.toolCall);
  }

  return calls;
}

function toolStatus(toolCall) {
  const value = String(toolCall?.status || toolCall?.state || toolCall?.outcome || "").toLowerCase();
  if (!value) return "started";
  if (value.includes("fail") || value.includes("error") || value.includes("timeout")) return "error";
  if (value.includes("success") || value.includes("ok") || value.includes("done")) return "success";
  return "started";
}

function inferMemorySource(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("daily")) return "daily_file";
  if (lower.includes("episodic")) return "episodic_file";
  if (lower.includes("long-term") || lower.includes("memory.md")) return "long_term_file";
  if (
    lower.includes("qdrant") ||
    lower.includes("vector") ||
    lower.includes("embedding") ||
    lower.includes("point")
  ) {
    return "qdrant_vector";
  }
  return "session";
}

function isErrorLikeText(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("failure") ||
    lower.includes("exception") ||
    lower.includes("traceback") ||
    lower.includes("command not found") ||
    lower.includes("permission denied") ||
    lower.includes("interactive authentication required") ||
    lower.includes("could not be found") ||
    lower.includes("exit code") ||
    lower.includes("timeout") ||
    lower.includes("unauthorized")
  );
}

function hasMemoryHints(text) {
  const lower = String(text || "").toLowerCase();
  const explicitMemoryOps =
    lower.includes("memory_store") ||
    lower.includes("memory_search") ||
    lower.includes("memory_write") ||
    lower.includes("memory_upsert") ||
    lower.includes("memory.read") ||
    lower.includes("memory.write") ||
    lower.includes("memory.search") ||
    lower.includes("memory.upsert");

  const vectorHints =
    lower.includes("qdrant") ||
    lower.includes("vector") ||
    lower.includes("embedding") ||
    lower.includes("collection");

  return explicitMemoryOps || vectorHints;
}

function inferMemoryEventType(status, text) {
  const lower = String(text || "").toLowerCase();
  if (status === "error" || lower.includes("error") || lower.includes("failed") || lower.includes("timeout")) {
    return "memory.error";
  }
  if (lower.includes("upsert") || lower.includes("insert") || lower.includes("persist")) {
    return "memory.upsert";
  }
  if (lower.includes("write") || lower.includes("save") || lower.includes("append") || lower.includes("update")) {
    return "memory.write";
  }
  if (
    lower.includes("search") ||
    lower.includes("query") ||
    lower.includes("retrieve") ||
    lower.includes("recall") ||
    lower.includes("semantic")
  ) {
    return "memory.search";
  }
  return "memory.read";
}

function pruneDedupe(now) {
  for (const [key, timestamp] of dedupeMap.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) dedupeMap.delete(key);
  }
  if (dedupeMap.size > DEDUPE_LIMIT) {
    const entries = [...dedupeMap.entries()].sort((a, b) => a[1] - b[1]);
    const removeCount = Math.floor(entries.length / 2);
    for (let index = 0; index < removeCount; index += 1) dedupeMap.delete(entries[index][0]);
  }
}

function canEmit(dedupeKey, level) {
  const now = Date.now();
  pruneDedupe(now);

  const last = dedupeMap.get(dedupeKey);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  dedupeMap.set(dedupeKey, now);

  while (recentLogTimes.length > 0 && now - recentLogTimes[0] > RATE_WINDOW_MS) {
    recentLogTimes.shift();
  }

  if (level !== "error" && recentLogTimes.length >= RATE_LIMIT) return false;
  recentLogTimes.push(now);
  return true;
}

function appendDeadLetter(row, errorMessage) {
  const line = JSON.stringify({
    occurred_at: toIsoNow(),
    error: String(errorMessage || "insert failed"),
    row,
  });
  fs.appendFileSync(DEAD_LETTER_PATH, `${line}\n`);
}

async function initLiveChannel() {
  if (liveChannel || !supabase) return;
  try {
    liveChannel = supabase.channel(LIVE_EVENTS_CHANNEL, {
      config: { broadcast: { self: false, ack: false } },
    });
    await liveChannel.subscribe((status) => {
      liveChannelReady = status === "SUBSCRIBED";
    });
  } catch {
    liveChannel = null;
    liveChannelReady = false;
  }
}

async function emitLiveLogEvent(row) {
  if (!liveChannel || !liveChannelReady) return;
  try {
    await liveChannel.send({
      type: "broadcast",
      event: "agent_log_insert",
      payload: {
        workspace_id: row.workspace_id,
        agent_id: row.agent_id,
        runtime_agent_id: row.runtime_agent_id || "",
        occurred_at: toIsoNow(),
      },
    });
  } catch {
    // best effort only
  }
}

async function insertAgentLog({
  logAgentId = "",
  runtimeAgentId = "",
  level = "info",
  type = "system",
  eventType = "system.warning",
  direction = "internal",
  channelType = "internal",
  runId = "",
  sessionKey = "",
  sourceMessageId = "",
  correlationId = "",
  status = "",
  retryCount = 0,
  memorySource = "",
  memoryKey = "",
  collection = "",
  queryText = "",
  resultCount = null,
  rawPayload = null,
  message,
  dedupeSuffix = "",
}) {
  if (!message) return;

  const sanitized = redactSecrets(message);
  if (!sanitized) return;

  const dedupeKey = `${eventType}|${level}|${runId}|${dedupeSuffix || sanitized.slice(0, 200)}`;
  if (!canEmit(dedupeKey, level)) return;

  const jsonDetected = detectJsonPayload(sanitized);
  const clippedMessage =
    sanitized.length > UI_MESSAGE_CHARS
      ? `${sanitized.slice(0, UI_MESSAGE_CHARS - 1)}…`
      : sanitized;

  const row = {
    workspace_id: workspaceId,
    agent_id: agentId,
    level,
    type,
    run_id: runId || "",
    event_type: eventType,
    direction,
    channel_type: channelType,
    ...(supportsRuntimeAgentIdColumn
      ? { runtime_agent_id: runtimeAgentId || logAgentId || "" }
      : {}),
    session_key: sessionKey || null,
    source_message_id: sourceMessageId,
    correlation_id: correlationId || runId || sourceMessageId || "",
    status,
    retry_count: Number.isFinite(retryCount) ? Math.max(0, Math.trunc(retryCount)) : 0,
    is_json: jsonDetected.isJson || Boolean(rawPayload && typeof rawPayload === "object"),
    message_preview: previewFromMessage(sanitized),
    raw_payload: rawPayload ?? jsonDetected.payload,
    memory_source: memorySource,
    memory_key: memoryKey,
    collection,
    query_text: cleanText(queryText).slice(0, 240),
    result_count: Number.isFinite(resultCount) ? Math.max(0, Math.trunc(resultCount)) : null,
    contains_pii: containsPii(sanitized),
    message: clippedMessage,
  };

  const { error } = await supabase.from("agent_logs").insert(row);
  if (!error) {
    emitLiveLogEvent(row).catch(() => {});
    return;
  }
  console.error("[bridge] insert error:", error.message);
  appendDeadLetter(row, error.message);
}

async function replayDeadLetters() {
  if (replayInFlight || !fs.existsSync(DEAD_LETTER_PATH)) return;
  replayInFlight = true;

  try {
    const source = fs.readFileSync(DEAD_LETTER_PATH, "utf8");
    const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const rows = lines
      .map((line) => ({
        line,
        row: parseJsonLine(line)?.row,
      }))
      .filter((entry) => entry.row && typeof entry.row === "object");

    const remaining = [];
    for (const batch of chunkItems(rows, DEAD_LETTER_BATCH_SIZE)) {
      const batchRows = batch.map((entry) => entry.row);
      const { error } = await supabase.from("agent_logs").insert(batchRows);
      if (!error) continue;

      for (const entry of batch) {
        const { error: singleError } = await supabase.from("agent_logs").insert(entry.row);
        if (singleError) {
          remaining.push(entry.line);
        }
      }
    }

    if (remaining.length === 0) {
      fs.unlinkSync(DEAD_LETTER_PATH);
    } else {
      fs.writeFileSync(DEAD_LETTER_PATH, `${remaining.join("\n")}\n`);
    }
  } finally {
    replayInFlight = false;
  }
}

async function setStatus(nextStatus, reason) {
  if (!nextStatus || currentStatus === nextStatus) return;
  const previous = currentStatus;
  currentStatus = nextStatus;

  await supabase
    .from("agents")
    .update({ status: currentStatus, last_heartbeat_at: toIsoNow() })
    .eq("id", agentId);

  await insertAgentLog({
    level: nextStatus === "degraded" ? "warning" : "info",
    type: "system",
    eventType: "heartbeat.status_change",
    direction: "internal",
    channelType: "internal",
    status: nextStatus,
    message: `[heartbeat] status ${previous} -> ${nextStatus}${reason ? ` (${reason})` : ""}`,
    dedupeSuffix: `status:${previous}:${nextStatus}:${reason || ""}`,
  });
}

async function syncAgentIdentity(candidateModel) {
  const nextModel = normalizeModelName(candidateModel);
  const updateRow = {};

  if (nextModel && currentAgentModel.toLowerCase() !== nextModel.toLowerCase()) {
    updateRow.model = nextModel;
  }
  if (Object.keys(updateRow).length === 0) return;

  updateRow.last_heartbeat_at = toIsoNow();

  const { error } = await supabase
    .from("agents")
    .update(updateRow)
    .eq("id", agentId);

  if (error) {
    console.error("[bridge] identity sync error:", error.message);
    return;
  }

  if (nextModel) currentAgentModel = nextModel;
}

async function heartbeatTick() {
  const idleFor = Date.now() - lastSessionActivityAt;
  if (idleFor > IDLE_AFTER_MS && currentStatus === "running") {
    await setStatus("idle", "no recent session activity");
  }

  const { error } = await supabase
    .from("agents")
    .update({ status: currentStatus, last_heartbeat_at: toIsoNow() })
    .eq("id", agentId);

  if (error) {
    heartbeatFailures += 1;
    console.error("[bridge] heartbeat error:", error.message);
    if (heartbeatFailures >= 3) await setStatus("degraded", "heartbeat failures");
    return;
  }

  if (currentStatus === "degraded" && heartbeatFailures >= 3) {
    await setStatus("running", "heartbeat recovered");
  }
  heartbeatFailures = 0;

  await insertAgentLog({
    level: "debug",
    type: "system",
    eventType: "heartbeat.tick",
    direction: "internal",
    channelType: "internal",
    status: currentStatus,
    message: `[heartbeat] tick status=${currentStatus}`,
    dedupeSuffix: `heartbeat-tick:${Math.floor(Date.now() / 60000)}`,
  });
}

function listSessionFiles() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const files = [];
  for (const agentName of fs.readdirSync(AGENTS_DIR)) {
    const sessionsDir = path.join(AGENTS_DIR, agentName, "sessions");
    if (!fs.existsSync(sessionsDir)) continue;
    for (const name of fs.readdirSync(sessionsDir)) {
      if (!name.endsWith(".jsonl")) continue;
      files.push(path.join(sessionsDir, name));
    }
  }
  return files;
}

function parseSessionMeta(filePath) {
  const sessionsDir = path.dirname(filePath);
  const agentDir = path.dirname(sessionsDir);
  const parsedAgentId = path.basename(agentDir);
  const parsedSessionKey = path.basename(filePath);
  return {
    agentId: parsedAgentId || agentId,
    sessionKey: parsedSessionKey,
  };
}

function listGatewayFiles() {
  if (!fs.existsSync(GATEWAY_LOG_DIR)) return [];
  return fs
    .readdirSync(GATEWAY_LOG_DIR)
    .filter((name) => name.startsWith("openclaw-") && name.endsWith(".log"))
    .map((name) => path.join(GATEWAY_LOG_DIR, name));
}

function tailFile(filePath, onLine) {
  let position = 0;
  let draining = false;
  let pending = false;

  const drain = () => {
    if (draining) {
      pending = true;
      return;
    }

    draining = true;
    fs.stat(filePath, (error, stat) => {
      if (error) {
        draining = false;
        return;
      }
      if (stat.size < position) position = 0;
      if (stat.size === position) {
        draining = false;
        if (pending) {
          pending = false;
          drain();
        }
        return;
      }

      const nextEnd = stat.size;
      const stream = fs.createReadStream(filePath, { start: position, end: nextEnd });
      const rl = readline.createInterface({ input: stream });
      rl.on("line", onLine);
      rl.on("close", () => {
        position = nextEnd;
        setFileOffset(filePath, position);
        draining = false;
        if (pending) {
          pending = false;
          drain();
        }
      });
      rl.on("error", () => {
        draining = false;
      });
    });
  };

  fs.stat(filePath, (error, stat) => {
    if (error) return;
    const stored = getFileOffset(filePath);
    if (stored == null) {
      position = stat.size;
      setFileOffset(filePath, position);
      return;
    }
    position = Math.min(stored, stat.size);
    if (stat.size > position) {
      drain();
    }
  });

  if (typeof fs.watch !== "function") {
    console.warn(`[bridge] fs.watch unavailable for ${filePath}; tail disabled`);
    return;
  }

  try {
    fs.watch(filePath, { persistent: true }, () => {
      drain();
    });
  } catch {
    console.warn(`[bridge] fs.watch failed for ${filePath}; tail disabled`);
  }
}

async function handleToolCalls(record, runId, scopedSessionKey, logAgentId = "") {
  const calls = extractToolCalls(record);
  for (const call of calls) {
    const callId = String(call?.id || call?.call_id || safeJson(call?.arguments || {}));
    const name = String(call?.name || call?.toolName || call?.tool || "unknown_tool");
    const status = toolStatus(call);
    const eventKey = `${runId}|${callId}|${status}`;
    if (seenToolEvents.has(eventKey)) continue;
    seenToolEvents.add(eventKey);
    if (seenToolEvents.size > 30_000) seenToolEvents.clear();

    const lowerName = name.toLowerCase();
    const callProbe = [
      name,
      safeJson(call?.arguments || {}),
      safeJson(call?.result || {}),
      safeJson(call?.error || {}),
      String(call?.collection || ""),
      String(call?.source || ""),
      String(call?.arguments?.collection || ""),
    ]
      .join(" ")
      .toLowerCase();
    const isReaction = lowerName.includes("message") && String(call?.arguments?.action || "").toLowerCase() === "react";
    const isMemoryTool =
      lowerName.includes("memory") ||
      lowerName.startsWith("qdrant") ||
      lowerName.includes("vector");
    const isMemory = isMemoryTool || hasMemoryHints(callProbe);
    const isQdrant =
      callProbe.includes("qdrant") ||
      callProbe.includes("vector") ||
      callProbe.includes("embedding") ||
      callProbe.includes("point");

    const eventType = isReaction
      ? "chat.reaction"
      : isMemory
        ? inferMemoryEventType(status, callProbe)
        : status === "error"
          ? "tool.error"
          : status === "started"
            ? "tool.start"
            : "tool.success";
    const type = isMemory ? "memory" : "tool";
    const channelType = isQdrant ? "qdrant" : "internal";

    const resultCount = Number.isFinite(call?.result_count)
      ? call.result_count
      : Array.isArray(call?.result?.points)
        ? call.result.points.length
        : Array.isArray(call?.result?.results)
          ? call.result.results.length
          : Array.isArray(call?.result?.matches)
            ? call.result.matches.length
        : null;
    const summary = `action=${call?.arguments?.action || "n/a"} args=${safeJson(call?.arguments || {})}`;
    const resultSuffix = call?.result ? ` result=${safeJson(call.result)}` : "";
    const errorSuffix = call?.error ? ` error=${safeJson(call.error)}` : "";
    const collection = String(
      call?.arguments?.collection ||
      call?.collection ||
      call?.result?.collection ||
      "",
    );
    const queryText = String(
      call?.arguments?.query ||
      call?.arguments?.text ||
      call?.arguments?.prompt ||
      call?.arguments?.input ||
      call?.arguments?.search ||
      "",
    );

    await insertAgentLog({
      level: status === "error" ? "error" : "info",
      type,
      eventType,
      direction: isReaction ? "outbound" : "internal",
      channelType,
      runId,
      sessionKey: scopedSessionKey,
      sourceMessageId: callId,
      correlationId: runId || callId,
      status,
      retryCount: Number.isFinite(call?.retry_count) ? call.retry_count : 0,
      memorySource: isMemory ? inferMemorySource(callProbe) : "",
      memoryKey: callId,
      collection,
      queryText,
      resultCount,
      rawPayload: call,
      message: `Tool ${name} (${status}) - ${summary}${resultSuffix}${errorSuffix}`,
      dedupeSuffix: `tool:${logAgentId || agentId}:${runId}:${callId}:${status}`,
      logAgentId,
    });
  }
}

async function handleSessionLine(line, filePath) {
  lastSessionActivityAt = Date.now();
  const parsed = parseJsonLine(line);
  if (!parsed) return;

  const normalized = normalizeRecord(parsed);
  const runId = String(normalized.runId || "");
  const { agentId: logAgentId, sessionKey } = parseSessionMeta(filePath);
  const scopedSessionKey = `agent:${logAgentId}:${sessionKey}`;
  const sourceMessageId = String(normalized.sourceMessageId || `${sessionKey}:${runId}`);
  const role = String(normalized.role || "unknown").toLowerCase();
  const text = flattenRecordText(normalized);
  if (role === "assistant" && logAgentId === agentId) {
    await syncAgentIdentity(normalized.model);
  }

  if (hasTypingSignal(parsed, normalized)) {
    await insertAgentLog({
      level: "info",
      type: "workflow",
      eventType: "chat.assistant_typing",
      direction: "outbound",
      channelType: "internal",
      runId,
      sessionKey: scopedSessionKey,
      sourceMessageId,
      correlationId: runId || sourceMessageId,
      message: "Assistant is typing…",
      dedupeSuffix: `typing:${logAgentId}:${runId}:${sourceMessageId}`,
      logAgentId,
    });
  }

  if (text) {
    const looksSystemText = /^system\s*:/i.test(text) || /^system\s*\(/i.test(text);
    const logicalSystem = role === "system" || looksSystemText;
    const systemIsError = logicalSystem && isErrorLikeText(text);
    const toolLikeRole =
      role === "tool" ||
      role === "toolresult" ||
      role === "tool_result" ||
      role === "toolcall" ||
      role === "tool_call";
    const explicitToolError =
      String(normalized.stopReason || "").toLowerCase().includes("error") ||
      Boolean(normalized.error);
    const toolIsError = toolLikeRole && (explicitToolError || isErrorLikeText(text));

    const eventType = role === "assistant"
      ? "chat.assistant_out"
      : role === "user"
        ? "chat.user_in"
        : toolLikeRole
          ? role.includes("call")
            ? "tool.start"
            : toolIsError
              ? "tool.error"
              : "tool.success"
          : logicalSystem
            ? (systemIsError ? "system.error" : "system.warning")
            : "system.warning";
    const direction = role === "assistant" ? "outbound" : role === "user" ? "inbound" : "internal";
    await insertAgentLog({
      level: toolLikeRole
        ? (toolIsError ? "error" : "info")
        : logicalSystem
          ? (systemIsError ? "error" : "warning")
          : "info",
      type: toolLikeRole ? "tool" : logicalSystem ? "system" : "workflow",
      eventType,
      direction,
      channelType: "internal",
      runId,
      sessionKey: scopedSessionKey,
      sourceMessageId,
      correlationId: runId || sourceMessageId,
      message:
        role === "assistant"
          ? `Assistant: ${text}`
          : role === "user"
            ? `User: ${text}`
            : toolLikeRole
              ? `Tool: ${text}`
              : logicalSystem
                ? `System: ${text}`
                : text,
      dedupeSuffix: `role:${logAgentId}:${role}:${sourceMessageId}`,
      logAgentId,
    });
  }

  await handleToolCalls(normalized, runId, scopedSessionKey, logAgentId);

  if (normalized.error) {
    await insertAgentLog({
      level: "error",
      type: "system",
      eventType: "system.error",
      direction: "internal",
      channelType: "internal",
      runId,
      sessionKey: scopedSessionKey,
      sourceMessageId,
      correlationId: runId || sourceMessageId,
      status: "error",
      rawPayload: normalized.error,
      message: `System error: ${safeJson(normalized.error)}`,
      dedupeSuffix: `record-error:${logAgentId}:${runId}:${sourceMessageId}`,
      logAgentId,
    });
  }

  if (normalized.stopReason && String(normalized.stopReason).toLowerCase().includes("error")) {
    await insertAgentLog({
      level: "error",
      type: "system",
      eventType: "system.error",
      direction: "internal",
      channelType: "internal",
      runId,
      sessionKey: scopedSessionKey,
      sourceMessageId,
      correlationId: runId || sourceMessageId,
      status: "error",
      message: `System error: ${normalized.stopReason}`,
      dedupeSuffix: `stop-reason:${logAgentId}:${runId}:${sourceMessageId}`,
      logAgentId,
    });
  }

  if (currentStatus === "idle") await setStatus("running", "session activity resumed");
}

async function handleGatewayLine(line) {
  const lower = String(line || "").toLowerCase();
  if (!lower) return;
  if (
    !lower.includes("error") &&
    !lower.includes("warn") &&
    !lower.includes("timeout") &&
    !lower.includes("failed") &&
    !lower.includes("reconnect") &&
    !lower.includes("disconnect") &&
    !lower.includes("unauthorized")
  ) {
    return;
  }

  const knownToolExecMiss =
    lower.includes("[tools] exec failed") &&
    (lower.includes("command not found") || lower.includes("exit code 127"));

  if (knownToolExecMiss) {
    await insertAgentLog({
      level: "error",
      type: "system",
      eventType: "system.error",
      direction: "internal",
      channelType: "gateway",
      status: "error",
      message: `System error: ${cleanText(line)}`,
      dedupeSuffix: `gateway-tools-exec-miss:${cleanText(line).slice(0, 180)}`,
    });
    return;
  }

  const level = lower.includes("warn") || lower.includes("reconnect") || lower.includes("disconnect")
    ? "warning"
    : "error";
  await insertAgentLog({
    level,
    type: "system",
    eventType: level === "warning" ? "system.warning" : "system.error",
    direction: "internal",
    channelType: "gateway",
    status: lower.includes("reconnect") ? "reconnect" : level,
    message: level === "warning" ? `System warning: ${cleanText(line)}` : `System error: ${cleanText(line)}`,
    dedupeSuffix: `gateway:${cleanText(line).slice(0, 180)}`,
  });
}

function attachSessionFiles() {
  for (const filePath of listSessionFiles()) {
    if (watchedSessions.has(filePath)) continue;
    watchedSessions.add(filePath);
    tailFile(filePath, (line) => {
      handleSessionLine(line, filePath).catch((error) => {
        console.error("[bridge] session parse error:", error.message);
      });
    });
  }
}

function attachGatewayFiles() {
  for (const filePath of listGatewayFiles()) {
    if (watchedGatewayLogs.has(filePath)) continue;
    watchedGatewayLogs.add(filePath);
    tailFile(filePath, (line) => {
      handleGatewayLine(line).catch((error) => {
        console.error("[bridge] gateway parse error:", error.message);
      });
    });
  }
}

async function runStartupChecks() {
  if (!HOME) throw new Error("Cannot resolve HOME for bridge logger.");
  if (!fs.existsSync(LOGGER_PATH)) throw new Error(`Logger file not found: ${LOGGER_PATH}`);

  const loadedEnvFiles = loadEnvironment();
  for (const key of REQUIRED_ENV_KEYS) mustEnv(key);

  workspaceId = mustEnv("OPENCLAW_WORKSPACE_ID");
  agentId = mustEnv("OPENCLAW_AGENT_ID");
  supabase = createClient(resolveSupabaseUrl(), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

  const { data: agents, error: agentError } = await supabase
    .from("agents")
    .select("id, model")
    .eq("id", agentId)
    .limit(1);
  if (agentError) throw new Error(`Supabase connectivity check failed: ${agentError.message}`);
  if (!agents || agents.length === 0) throw new Error(`Agent not found for OPENCLAW_AGENT_ID=${agentId}`);
  currentAgentModel = normalizeModelName(agents[0]?.model) || "unknown";

  if (loadedEnvFiles.length > 0) {
    console.log(`[bridge] loaded env from: ${loadedEnvFiles.join(", ")}`);
  } else {
    console.log("[bridge] loaded env from process environment");
  }

  const { error: columnsError } = await supabase
    .from("agent_logs")
    .select("id,event_type,direction,channel_type,message_preview")
    .limit(1);
  if (columnsError) throw new Error(`Schema check failed: ${columnsError.message}`);

  const { error: runtimeAgentColumnError } = await supabase
    .from("agent_logs")
    .select("runtime_agent_id")
    .limit(1);
  supportsRuntimeAgentIdColumn = !runtimeAgentColumnError;

  await initLiveChannel();
}

async function shutdown(signal) {
  try {
    await setStatus("idle", signal);
    await insertAgentLog({
      level: "info",
      type: "system",
      eventType: "system.shutdown",
      direction: "internal",
      channelType: "internal",
      status: "success",
      message: `bridge logger stopped (${signal})`,
      dedupeSuffix: `shutdown:${signal}`,
    });
  } finally {
    if (offsetsFlushTimer) {
      clearTimeout(offsetsFlushTimer);
      offsetsFlushTimer = null;
    }
    if (offsetsDirty) {
      try {
        const out = {};
        for (const [filePath, offset] of fileOffsets.entries()) {
          out[filePath] = offset;
        }
        fs.writeFileSync(OFFSETS_PATH, JSON.stringify(out));
      } catch {
        // ignore
      }
    }
    process.exit(0);
  }
}

async function main() {
  loadOffsets();
  await runStartupChecks();
  await insertAgentLog({
    level: "info",
    type: "system",
    eventType: "system.startup",
    direction: "internal",
    channelType: "internal",
    status: "success",
    message: "bridge logger started",
    dedupeSuffix: "startup",
  });

  await setStatus("running", "logger start");
  await heartbeatTick();

  attachSessionFiles();
  attachGatewayFiles();

  setInterval(() => {
    attachSessionFiles();
  }, SESSION_SCAN_MS);
  setInterval(() => {
    attachGatewayFiles();
  }, GATEWAY_SCAN_MS);
  setInterval(() => {
    heartbeatTick().catch((error) => console.error("[bridge] heartbeat tick error:", error.message));
  }, HEARTBEAT_MS);
  setInterval(() => {
    replayDeadLetters().catch((error) => console.error("[bridge] dead-letter replay error:", error.message));
  }, DEAD_LETTER_REPLAY_MS);

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => process.exit(0));
  });
  process.on("unhandledRejection", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    insertAgentLog({
      level: "error",
      type: "system",
      eventType: "system.error",
      direction: "internal",
      channelType: "internal",
      status: "error",
      message: `[unhandledRejection] ${message}`,
      dedupeSuffix: `unhandled-rejection:${message.slice(0, 180)}`,
    }).catch(() => {});
  });
}

main().catch((error) => {
  console.error("[bridge] fatal:", error.message);
  process.exit(1);
});
