import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { discoverSkills } from "./discovery";
import { moduleAvailability } from "@/lib/modules/availability";
import { MODULES } from "@/lib/modules/registry";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "mc-skill-test-")); roots.push(root); return root; }
function skill(root: string, area: string, capabilities: string[]) {
  const dir = join(root, area, "skills", "mission-control"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), '---\r\nname: "Mission Control"\r\ndescription: Catalog integration\r\n---\r\n');
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ capabilities }));
}
it("uses configured workspace precedence and CRLF frontmatter while checking required capabilities", () => {
  const root = fixture(); skill(root, "workspace", ['mobile-apps.reviews.read']); skill(root, "", []);
  const found = discoverSkills({ OPENCLAW_HOME: root });
  expect(found).toHaveLength(1); expect(found[0].name).toBe('Mission Control');
  const def = MODULES.find(m => m.id === 'mobile-apps')!;
  expect(moduleAvailability(def, found).available).toBe(true);
  expect(moduleAvailability(def, []).reason).toContain('Install');
  expect(moduleAvailability(def, [{ ...found[0], capabilities: [] }]).reason).toContain('Update');
  writeFileSync(join(root, 'openclaw.json'), JSON.stringify({ skills: { entries: { 'mission-control': { enabled: false } } } }));
  expect(moduleAvailability(def, discoverSkills({ OPENCLAW_HOME: root })).reason).toContain('disabled');
});
it("discovers an explicitly configured custom workspace and fails closed on invalid config", () => {
  const root = fixture(); skill(root, "custom", ['metrics.read']);
  writeFileSync(join(root, 'openclaw.json'), JSON.stringify({ agents: { defaults: { workspace: join(root, 'custom') } } }));
  expect(discoverSkills({ OPENCLAW_HOME: root })[0].capabilities).toEqual(['metrics.read']);
  writeFileSync(join(root, 'openclaw.json'), '{bad');
  expect(() => discoverSkills({ OPENCLAW_HOME: root })).toThrow();
});
