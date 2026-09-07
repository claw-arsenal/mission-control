import type { InstalledSkill } from "@/lib/skills/discovery";
import type { ModuleDefinition } from "./registry";

export function moduleAvailability(def: ModuleDefinition, skills: InstalledSkill[]) {
  if (!def.skill) return { available: true, reason: null };
  const skill = skills.find(skill => skill.key === def.skill!.key);
  if (!skill) return { available: false, reason: `Install the ${def.skill.key} skill to use this module.` };
  if (!skill.enabled) return { available: false, reason: `The ${def.skill.key} skill is disabled in OpenClaw.` };
  if (!skill.capabilities.includes(def.skill.capability)) {
    return { available: false, reason: `Update the ${def.skill.key} skill to support ${def.skill.capability}.` };
  }
  return { available: true, reason: null };
}
