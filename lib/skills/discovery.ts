import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export type InstalledSkill = {
  key: string; name: string; description: string; directory: string;
  enabled: boolean; capabilities: string[];
};

type OpenClawConfig = {
  agents?: { defaults?: { workspace?: string } };
  skills?: { load?: { extraDirs?: string[] }; entries?: Record<string, { enabled?: boolean }> };
};

function expand(value: string) { return value.replace(/^~(?=$|[\\/])/, homedir()); }

export function discoverSkills(env: Record<string, string | undefined> = process.env): InstalledSkill[] {
  const home = resolve(expand(env.OPENCLAW_HOME || join(homedir(), ".openclaw")));
  let config: OpenClawConfig = {};
  const configPath = env.OPENCLAW_CONFIG_PATH || join(home, "openclaw.json");
  if (existsSync(/*turbopackIgnore: true*/ configPath)) {
    // Invalid configuration must not silently ignore explicitly disabled skills.
    config = JSON.parse(readFileSync(/*turbopackIgnore: true*/ configPath, "utf8").replace(/,(\s*[}\]])/g, "$1"));
  }
  const dirs = [
    join(expand(env.OPENCLAW_WORKSPACE || config.agents?.defaults?.workspace || join(home, "workspace")), "skills"),
    join(home, "skills"),
    ...(env.MISSION_CONTROL_SKILLS_DIRS?.split(delimiter).filter(Boolean) || []),
    ...(config.skills?.load?.extraDirs || []),
  ];
  const found = new Map<string, InstalledSkill>();
  for (const dir of new Set(dirs.map(dir => resolve(expand(dir))))) {
    if (!existsSync(/*turbopackIgnore: true*/ dir)) continue;
    for (const entry of readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || found.has(entry.name)) continue;
      const directory = join(dir, entry.name);
      if (!existsSync(/*turbopackIgnore: true*/ join(directory, "SKILL.md"))) continue;
      const content = readFileSync(/*turbopackIgnore: true*/ join(directory, "SKILL.md"), "utf8");
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || "";
      const field = (key: string) => frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^(['"])(.*)\1$/, "$2");
      let capabilities: string[] = [];
      try {
        const manifest = JSON.parse(readFileSync(/*turbopackIgnore: true*/ join(directory, "manifest.json"), "utf8"));
        if (Array.isArray(manifest.capabilities)) capabilities = manifest.capabilities.filter((c: unknown) => typeof c === "string");
      } catch { /* Legacy skills remain visible; unsupported capabilities stay unavailable. */ }
      found.set(entry.name, {
        key: entry.name, name: field("name") || entry.name, description: field("description") || "",
        directory, capabilities, enabled: config.skills?.entries?.[entry.name]?.enabled !== false,
      });
    }
  }
  return [...found.values()];
}
