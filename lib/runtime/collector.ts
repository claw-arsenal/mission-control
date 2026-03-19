import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { RuntimeSnapshot, RuntimeSnapshotMap, RuntimeStatus } from "@/lib/runtime/types";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const AGENTS_DIR = path.join(OPENCLAW_HOME, "agents");
const LEGACY_SESSIONS_DIR = path.join(AGENTS_DIR, "main", "sessions");
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");
const IDENTITY_PATH = path.join(OPENCLAW_HOME, "workspace", "IDENTITY.md");
const AGENT_WORKSPACES_DIR = path.join(OPENCLAW_HOME, "workspace", "agents");
const WORKSPACE_SOUL_PATH = path.join(OPENCLAW_HOME, "workspace", "SOUL.md");
const USER_SKILLS_DIR = path.join(OPENCLAW_HOME, "skills");
const TEMPLATE_ENV_PATH = process.env.DASHBOARD_TEMPLATE_ENV || "/etc/clawd/template.env";
const BRIDGE_ENV_PATH = path.join(OPENCLAW_HOME, "dashboard-bridge.env");
const STALE_SEC = 120;
const MAX_SESSION_FILES = 24;
const TAIL_LINE_COUNT = 300;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

type SessionFile = {
  agentKey: string;
  filePath: string;
  mtimeIso: string;
  mtimeMs: number;
};

type MutableSnapshot = {
  agentId: string;
  name: string;
  status: RuntimeStatus;
  model: string | null;
  activeRuns: number | null;
  queueDepth: number | null;
  uptimeMinutes: number | null;
  lastHeartbeatAt: string | null;
  collectedAt: string;
  identityName: string;
  identityEmoji: string;
  identityRole: string;
  activeSkills: Set<string>;
  soul: string;
};

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    out[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return out;
}

function parseAgentIdList(value: unknown): string[] {
  const source = String(value || "").trim();
  if (!source) return [];
  return source
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item, index, list) => item && UUID_PATTERN.test(item) && list.indexOf(item) === index);
}

function parseNonNegInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.trunc(num));
}

function parseTime(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const epochMs = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(epochMs);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    const epochMs = num > 1_000_000_000_000 ? num : num * 1000;
    const date = new Date(epochMs);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }

  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function heartbeatAgeSec(lastHeartbeatAt: string | null): number | null {
  if (!lastHeartbeatAt) return null;
  const ageMs = Date.now() - new Date(lastHeartbeatAt).valueOf();
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  return Math.floor(ageMs / 1000);
}

function deriveStatus(base: unknown): RuntimeStatus {
  const normalized = String(base || "").trim().toLowerCase();
  if (normalized === "running" || normalized === "idle" || normalized === "degraded") return normalized;
  return "unknown";
}

function normalizeRuntimeName(value: unknown): string {
  let name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) return "";

  name = name
    .replace(/^[-*#>\s]+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .trim();

  if (!name) return "";
  if (name.toLowerCase() === "assistant") return "";
  return name.slice(0, 120);
}

function pickName(record: Record<string, unknown>): string {
  const candidates = [
    record.assistant_name,
    record.agent_name,
    (record.assistant as Record<string, unknown> | undefined)?.name,
    (record.agent as Record<string, unknown> | undefined)?.name,
    (record.meta as Record<string, unknown> | undefined)?.assistant_name,
    (record.meta as Record<string, unknown> | undefined)?.agent_name,
  ];

  for (const candidate of candidates) {
    const next = normalizeRuntimeName(candidate);
    if (next) return next;
  }
  return "";
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const source = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickNameFromConfig(config: Record<string, unknown> | null): string {
  if (!config) return "";
  const candidates = [
    config.name,
    config.agent_name,
    config.agentName,
    (config.agent as Record<string, unknown> | undefined)?.name,
    (config.runtime as Record<string, unknown> | undefined)?.name,
    (config.profile as Record<string, unknown> | undefined)?.name,
    (config.bot as Record<string, unknown> | undefined)?.name,
    ((config.channels as Record<string, unknown> | undefined)?.telegram as Record<
      string,
      unknown
    > | undefined)?.name,
  ];

  for (const candidate of candidates) {
    const next = normalizeRuntimeName(candidate);
    if (next) return next;
  }
  return "";
}

type AgentIdentityProfile = {
  name: string;
  emoji: string;
  role: string;
};

async function readIdentityProfile(filePath: string): Promise<AgentIdentityProfile> {
  try {
    const source = await fs.readFile(filePath, "utf8");
    const pickField = (field: string) => {
      const pattern = new RegExp(
        String.raw`^\s*(?:[-*]\s*)?(?:\*\*)?${field}(?:\*\*)?\s*:\s*(.+)\s*$`,
        "im",
      );
      const match = source.match(pattern);
      return match ? String(match[1] || "").trim() : "";
    };

    const cleanEmoji = (value: string) => {
      return String(value || "")
        .replace(/[*`_]/g, "")
        .replace(/^emoji\s*/i, "")
        .replace(/^:\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 16);
    };

    const name = normalizeRuntimeName(pickField("Name"));
    const emoji = cleanEmoji(pickField("Emoji"));
    const role =
      normalizeRuntimeName(pickField("Role")) ||
      normalizeRuntimeName(pickField("Creature")) ||
      normalizeRuntimeName(pickField("Vibe"));

    return { name, emoji, role };
  } catch {
    return { name: "", emoji: "", role: "" };
  }
}

async function resolveAgentIdentityProfiles(agentKeys: string[]) {
  const pairs = await Promise.all(
    agentKeys.map(async (agentKey) => {
      if (agentKey === "main") return [agentKey, await readIdentityProfile(IDENTITY_PATH)] as const;
      const identityPath = path.join(AGENT_WORKSPACES_DIR, agentKey, "IDENTITY.md");
      return [agentKey, await readIdentityProfile(identityPath)] as const;
    }),
  );

  return Object.fromEntries(pairs) as Record<string, AgentIdentityProfile>;
}

function collectSkillNamesFromText(source: string) {
  const skills = new Set<string>();
  const text = String(source || "");
  if (!text) return skills;

  const tagPattern = /<name>\s*([^<\n]+?)\s*<\/name>/gi;
  for (const match of text.matchAll(tagPattern)) {
    const value = String(match[1] || "").trim();
    if (value) skills.add(value);
  }

  return skills;
}

async function listSkillNamesFromDir(dirPath: string) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [] as string[];
  }
}

async function resolveDefaultSkillNames() {
  return listSkillNamesFromDir(USER_SKILLS_DIR);
}

async function resolveAgentSpecificSkillNames(agentKey: string) {
  const agentSkillsDir = path.join(AGENT_WORKSPACES_DIR, agentKey, "skills");
  return listSkillNamesFromDir(agentSkillsDir);
}

async function readSoulText(filePath: string) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    return source.trim().slice(0, 6000);
  } catch {
    return "";
  }
}

async function resolveAgentSoul(agentKey: string) {
  if (agentKey === "main") {
    return readSoulText(WORKSPACE_SOUL_PATH);
  }
  return readSoulText(path.join(AGENT_WORKSPACES_DIR, agentKey, "SOUL.md"));
}

function pickModel(record: Record<string, unknown>): string {
  const candidates = [
    record.model,
    record.model_name,
    record.provider_model,
    (record.response as Record<string, unknown> | undefined)?.model,
    (record.api as Record<string, unknown> | undefined)?.model,
    (record.meta as Record<string, unknown> | undefined)?.model,
    (record.session as Record<string, unknown> | undefined)?.model,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value.slice(0, 160);
  }
  return "";
}

function unwrapRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const nested = record.message;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

async function readEnvMap(filePath: string): Promise<Record<string, string>> {
  try {
    const source = await fs.readFile(filePath, "utf8");
    return parseEnv(source);
  } catch {
    return {};
  }
}

async function resolveConfiguredAgentIds() {
  const [bridgeEnv, templateEnv] = await Promise.all([
    readEnvMap(BRIDGE_ENV_PATH),
    readEnvMap(TEMPLATE_ENV_PATH),
  ]);

  const ids = [
    ...parseAgentIdList(bridgeEnv.OPENCLAW_AGENT_IDS),
    ...parseAgentIdList(templateEnv.OPENCLAW_AGENT_IDS),
    ...parseAgentIdList(bridgeEnv.OPENCLAW_AGENT_ID),
    ...parseAgentIdList(templateEnv.OPENCLAW_AGENT_ID),
  ];

  return ids.filter((id, index) => ids.indexOf(id) === index);
}

async function listSessionFiles() {
  const sessionDirs = new Map<string, string>();

  try {
    const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionsDir = path.join(AGENTS_DIR, entry.name, "sessions");
      sessionDirs.set(entry.name, sessionsDir);
    }
  } catch {
    if (await directoryExists(LEGACY_SESSIONS_DIR)) {
      sessionDirs.set("main", LEGACY_SESSIONS_DIR);
    }
  }

  if (sessionDirs.size === 0 && (await directoryExists(LEGACY_SESSIONS_DIR))) {
    sessionDirs.set("main", LEGACY_SESSIONS_DIR);
  }

  const files: SessionFile[] = [];
  for (const [agentKey, sessionsDir] of sessionDirs.entries()) {
    try {
      const names = await fs.readdir(sessionsDir);
      const jsonlFiles = names.filter((name) => name.endsWith(".jsonl"));
      for (const name of jsonlFiles) {
        const filePath = path.join(sessionsDir, name);
        const stat = await fs.stat(filePath);
        files.push({
          agentKey,
          filePath,
          mtimeIso: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
        });
      }
    } catch {
      continue;
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSION_FILES);
}

async function listAgentKeys() {
  try {
    const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [] as string[];
  }
}

function resolveAgentIdFromKey(agentKey: string) {
  const fromAgentKey = extractUuidFromValue(agentKey);
  if (fromAgentKey) return fromAgentKey;
  return `runtime:${agentKey}`;
}

async function directoryExists(dirPath: string) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function readTailLines(filePath: string, lineCount = TAIL_LINE_COUNT) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    const lines = source.split(/\r?\n/).filter(Boolean);
    return lines.slice(-lineCount);
  } catch {
    return [];
  }
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line);
    return unwrapRecord(parsed);
  } catch {
    return null;
  }
}

function extractUuidFromValue(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(UUID_PATTERN);
  return match ? match[0] : "";
}

function extractAgentIdFromRecord(record: Record<string, unknown>) {
  const candidates = [
    record.agent_id,
    record.agentId,
    record.assistant_id,
    record.assistantId,
    record.bot_id,
    record.botId,
    (record.agent as Record<string, unknown> | undefined)?.id,
    (record.assistant as Record<string, unknown> | undefined)?.id,
    (record.meta as Record<string, unknown> | undefined)?.agent_id,
    (record.meta as Record<string, unknown> | undefined)?.agentId,
    (record.session as Record<string, unknown> | undefined)?.agent_id,
    (record.session as Record<string, unknown> | undefined)?.agentId,
  ];

  for (const candidate of candidates) {
    const id = extractUuidFromValue(candidate);
    if (id) return id;
  }
  return "";
}

function resolveAgentId(
  record: Record<string, unknown>,
  file: SessionFile,
  configuredAgentIds: string[],
) {
  const fromRecord = extractAgentIdFromRecord(record);
  if (fromRecord) return fromRecord;

  const fromAgentKey = extractUuidFromValue(file.agentKey);
  if (fromAgentKey) return fromAgentKey;

  const runtimeAgentKey = String(file.agentKey || "").trim();

  if (runtimeAgentKey) {
    return `runtime:${runtimeAgentKey}`;
  }

  if (configuredAgentIds.length === 1) {
    return configuredAgentIds[0] ?? "";
  }

  for (const agentId of configuredAgentIds) {
    if (file.filePath.includes(agentId)) {
      return agentId;
    }
  }

  return "";
}

function ensureSnapshot(
  snapshotMap: Record<string, MutableSnapshot>,
  agentId: string,
  collectedAt: string,
  fallbackHeartbeatAt: string | null,
) {
  const existing = snapshotMap[agentId];
  if (existing) return existing;

  const created: MutableSnapshot = {
    agentId,
    name: "",
    status: fallbackHeartbeatAt ? "running" : "idle",
    model: null,
    activeRuns: null,
    queueDepth: null,
    uptimeMinutes: null,
    lastHeartbeatAt: fallbackHeartbeatAt,
    collectedAt,
    identityName: "",
    identityEmoji: "",
    identityRole: "",
    activeSkills: new Set<string>(),
    soul: "",
  };
  snapshotMap[agentId] = created;
  return created;
}

function applyRecordToSnapshot(snapshot: MutableSnapshot, record: Record<string, unknown>) {
  const parsedModel = pickModel(record);
  if (parsedModel) snapshot.model = parsedModel;

  const parsedName = pickName(record);
  if (parsedName) snapshot.name = parsedName;

  const parsedActiveRuns = parseNonNegInt(record.active_runs ?? record.activeRuns);
  if (parsedActiveRuns !== null) snapshot.activeRuns = parsedActiveRuns;

  const parsedQueueDepth = parseNonNegInt(record.queue_depth ?? record.queueDepth);
  if (parsedQueueDepth !== null) snapshot.queueDepth = parsedQueueDepth;

  const parsedUptime = parseNonNegInt(record.uptime_minutes ?? record.uptimeMinutes);
  if (parsedUptime !== null) snapshot.uptimeMinutes = parsedUptime;

  const statusCandidate = deriveStatus(record.status);
  if (statusCandidate !== "unknown") {
    snapshot.status = statusCandidate;
  }

  const parsedHeartbeat =
    parseTime(record.last_heartbeat_at) ??
    parseTime(record.lastHeartbeatAt) ??
    parseTime(record.timestamp) ??
    parseTime(record.occurred_at) ??
    parseTime(record.updated_at);

  if (parsedHeartbeat) {
    if (!snapshot.lastHeartbeatAt || parsedHeartbeat > snapshot.lastHeartbeatAt) {
      snapshot.lastHeartbeatAt = parsedHeartbeat;
    }
  }
}

function finalizeSnapshot(snapshot: MutableSnapshot): RuntimeSnapshot {
  const age = heartbeatAgeSec(snapshot.lastHeartbeatAt);
  return {
    agentId: snapshot.agentId,
    name: snapshot.name,
    status: snapshot.status,
    model: snapshot.model,
    activeRuns: snapshot.activeRuns,
    queueDepth: snapshot.queueDepth,
    uptimeMinutes: snapshot.uptimeMinutes,
    lastHeartbeatAt: snapshot.lastHeartbeatAt,
    heartbeatAgeSec: age,
    stale: age == null ? true : age > STALE_SEC,
    source: "openclaw-runtime",
    collectedAt: snapshot.collectedAt,
    identity: {
      name: snapshot.identityName,
      emoji: snapshot.identityEmoji,
      role: snapshot.identityRole,
    },
    activeSkills: Array.from(snapshot.activeSkills).sort(),
    soul: snapshot.soul,
  };
}

export async function collectRuntimeSnapshots(): Promise<RuntimeSnapshotMap> {
  const collectedAt = new Date().toISOString();
  const configuredAgentIds = await resolveConfiguredAgentIds();
  const openclawConfig = await readJson(OPENCLAW_CONFIG_PATH);
  const configName = pickNameFromConfig(openclawConfig);
  const mainIdentityProfile = await readIdentityProfile(IDENTITY_PATH);

  const agentsConfig = (openclawConfig?.agents as Record<string, unknown> | undefined) ?? {};
  const configuredAgents = Array.isArray(agentsConfig.list) ? ((agentsConfig.list as unknown[]) ?? []) : [];
  const defaultsConfig = (agentsConfig.defaults as Record<string, unknown> | undefined) ?? {};
  const configuredDefaultModel = pickModel((defaultsConfig.model as Record<string, unknown> | undefined) ?? {});
  const configuredAgentModelByKey = new Map<string, string>();
  for (const item of configuredAgents) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const key = String(record.id || "").trim();
    if (!key) continue;
    const model = pickModel(record);
    if (model) {
      configuredAgentModelByKey.set(key, model);
    }
  }
  const [sessionFiles, agentKeys, defaultSkillNames] = await Promise.all([
    listSessionFiles(),
    listAgentKeys(),
    resolveDefaultSkillNames(),
  ]);
  const agentIdentityProfiles = await resolveAgentIdentityProfiles(agentKeys);
  const mutableSnapshots: Record<string, MutableSnapshot> = {};
  const oldestSessionMtimeByAgentId: Record<string, number> = {};

  for (const file of sessionFiles) {
    const lines = await readTailLines(file.filePath);
    let fallbackAgentId = "";

    for (const line of lines) {
      const record = parseLine(line);
      if (!record) continue;

      const agentId = resolveAgentId(record, file, configuredAgentIds);
      if (!agentId) continue;

      fallbackAgentId = fallbackAgentId || agentId;
      const snapshot = ensureSnapshot(mutableSnapshots, agentId, collectedAt, file.mtimeIso);
      const currentOldest = oldestSessionMtimeByAgentId[agentId];
      if (currentOldest == null || file.mtimeMs < currentOldest) {
        oldestSessionMtimeByAgentId[agentId] = file.mtimeMs;
      }
      for (const skill of collectSkillNamesFromText(line)) {
        snapshot.activeSkills.add(skill);
      }
      applyRecordToSnapshot(snapshot, record);
    }

    if (fallbackAgentId) continue;

    const inferredAgentId =
      extractUuidFromValue(file.agentKey) ||
      (configuredAgentIds.length === 1 ? configuredAgentIds[0] ?? "" : "");

    if (!inferredAgentId) continue;
    ensureSnapshot(mutableSnapshots, inferredAgentId, collectedAt, file.mtimeIso);
    const currentOldest = oldestSessionMtimeByAgentId[inferredAgentId];
    if (currentOldest == null || file.mtimeMs < currentOldest) {
      oldestSessionMtimeByAgentId[inferredAgentId] = file.mtimeMs;
    }
  }

  if (Object.keys(mutableSnapshots).length === 0 && configuredAgentIds.length === 1) {
    const fallbackAgentId = configuredAgentIds[0] ?? "";
    if (fallbackAgentId) {
      const newestHeartbeat = sessionFiles[0]?.mtimeIso ?? null;
      ensureSnapshot(mutableSnapshots, fallbackAgentId, collectedAt, newestHeartbeat);
    }
  }

  for (const agentKey of agentKeys) {
    const runtimeAgentId = resolveAgentIdFromKey(agentKey);
    if (!runtimeAgentId) continue;
    const snapshot = ensureSnapshot(mutableSnapshots, runtimeAgentId, collectedAt, null);
    for (const skill of defaultSkillNames) {
      snapshot.activeSkills.add(skill);
    }
    const agentSpecificSkills = await resolveAgentSpecificSkillNames(agentKey);
    for (const skill of agentSpecificSkills) {
      snapshot.activeSkills.add(skill);
    }
    if (!snapshot.soul) {
      snapshot.soul = await resolveAgentSoul(agentKey);
    }
    const identity = agentIdentityProfiles[agentKey];
    if (identity?.name && !snapshot.identityName) {
      snapshot.identityName = identity.name;
    }
    if (identity?.emoji && !snapshot.identityEmoji) {
      snapshot.identityEmoji = identity.emoji;
    }
    if (identity?.role && !snapshot.identityRole) {
      snapshot.identityRole = identity.role;
    }

    if (!snapshot.name) {
      snapshot.name =
        normalizeRuntimeName(identity?.name || "") ||
        normalizeRuntimeName(agentKey.replace(/-/g, " ")) ||
        snapshot.name;
    }
    if (!snapshot.model) {
      snapshot.model = configuredAgentModelByKey.get(agentKey) ?? configuredDefaultModel ?? null;
    }
  }

  const fallbackName = configName || mainIdentityProfile.name;
  if (fallbackName) {
    const snapshotIds = Object.keys(mutableSnapshots);
    if (snapshotIds.length === 1) {
      const onlyId = snapshotIds[0] ?? "";
      if (onlyId && !mutableSnapshots[onlyId]?.name) {
        mutableSnapshots[onlyId].name = fallbackName;
      }
    }
  }

  for (const [agentId, snapshot] of Object.entries(mutableSnapshots)) {
    if (snapshot.uptimeMinutes != null && snapshot.uptimeMinutes > 0) continue;
    const oldestMtime = oldestSessionMtimeByAgentId[agentId];
    if (!Number.isFinite(oldestMtime)) continue;
    const ageMinutes = Math.floor((Date.now() - oldestMtime) / 60000);
    if (Number.isFinite(ageMinutes) && ageMinutes > 0) {
      snapshot.uptimeMinutes = ageMinutes;
    }
  }

  const snapshotMap: RuntimeSnapshotMap = {};
  for (const [agentId, snapshot] of Object.entries(mutableSnapshots)) {
    if (snapshot.activeSkills.size === 0) {
      for (const skill of defaultSkillNames) {
        snapshot.activeSkills.add(skill);
      }
    }
    snapshotMap[agentId] = finalizeSnapshot(snapshot);
  }

  return snapshotMap;
}
