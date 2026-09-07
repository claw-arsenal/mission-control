import { getSql } from "@/lib/local-db";
import { MODULES, type ModuleId } from "@/lib/modules/registry";
import { discoverSkills } from "@/lib/skills/discovery";
import { moduleAvailability } from "./availability";

/**
 * Module enablement is read often and changes rarely. Cache the snapshot
 * in-memory for a short TTL so request handlers don't all hit the DB.
 */
type Snapshot = {
  enabled: Set<ModuleId>;
  availability: Record<string, { available: boolean; reason: string | null }>;
  fetchedAt: number;
};

let cached: Snapshot | null = null;
const TTL_MS = 5_000;

async function ensureSchema(sql: ReturnType<typeof getSql>) {
  await sql`
    CREATE TABLE IF NOT EXISTS module_state (
      module_id text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      enabled_at timestamptz,
      disabled_at timestamptz,
      enabled_by_email text,
      enabled_by_name text,
      disabled_by_email text,
      disabled_by_name text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  // Keep existing choices. Newly introduced optional modules start disabled.
  for (const m of MODULES) {
    await sql`
      INSERT INTO module_state (module_id, enabled, enabled_at)
      VALUES (${m.id}, ${m.core}, case when ${m.core} then now() else null end)
      ON CONFLICT (module_id) DO NOTHING
    `;
  }
}

async function loadSnapshot(): Promise<Snapshot> {
  const sql = getSql();
  await ensureSchema(sql);
  const rows = await sql`select module_id, enabled from module_state` as Array<{ module_id: string; enabled: boolean }>;
  const enabled = new Set<ModuleId>();
  let skills: ReturnType<typeof discoverSkills> = [];
  let discoveryError = false;
  try { skills = discoverSkills(); } catch { discoveryError = true; }
  const availability: Snapshot["availability"] = {};
  for (const def of MODULES) {
    availability[def.id] = discoveryError && def.skill
      ? { available: false, reason: "Skill discovery failed. Check OpenClaw configuration and directory access." }
      : moduleAvailability(def, skills);
    if (def.core || (rows.some(r => r.module_id === def.id && r.enabled) && availability[def.id].available)) enabled.add(def.id);
  }
  return { enabled, availability, fetchedAt: Date.now() };
}

export async function readModuleSnapshot(force = false): Promise<Snapshot> {
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  cached = await loadSnapshot();
  return cached;
}

export function invalidateModuleCache(): void {
  cached = null;
}

export async function isModuleEnabled(id: ModuleId): Promise<boolean> {
  const snap = await readModuleSnapshot();
  return snap.enabled.has(id);
}

/**
 * Throwable gate for API routes. Throws an Error whose message is a JSON
 * payload route handlers can wrap into a 503 fail response.
 */
export class ModuleDisabledError extends Error {
  constructor(public moduleId: ModuleId) {
    super(`Module "${moduleId}" is disabled. Enable it in Settings to use this feature.`);
    this.name = "ModuleDisabledError";
  }
}

export async function requireModuleEnabled(id: ModuleId): Promise<void> {
  const enabled = await isModuleEnabled(id);
  if (!enabled) throw new ModuleDisabledError(id);
}
