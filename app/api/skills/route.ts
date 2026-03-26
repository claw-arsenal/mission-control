import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

type SkillInfo = {
  key: string;
  name: string;
  description: string;
};

export async function GET() {
  try {
    const homeDir = process.env.HOME || "/home/clawdbot";
    const skills: SkillInfo[] = [];

    // Read skills from workspace skills and managed skills directories
    const skillsDirs = [
      resolve(homeDir, ".openclaw/workspace/skills"),
      resolve(homeDir, ".openclaw/skills"),
    ];

    for (const dir of skillsDirs) {
      if (!existsSync(dir)) continue;
      const { readdirSync } = await import("fs");
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skillKey = entry.name;
          if (skills.find((s) => s.key === skillKey)) continue; // dedup
          const skillMdPath = resolve(dir, skillKey, "SKILL.md");
          if (!existsSync(skillMdPath)) continue;
          try {
            const content = readFileSync(skillMdPath, "utf8");
            const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
            let name = skillKey;
            let description = "";
            if (fmMatch) {
              const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
              const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m);
              if (nameMatch) name = nameMatch[1].trim();
              if (descMatch) description = descMatch[1].trim();
            }
            skills.push({ key: skillKey, name, description });
          } catch {
            skills.push({ key: skillKey, name: skillKey, description: "" });
          }
        }
      } catch {
        // Dir not readable
      }
    }

    // Also try openclaw CLI for installed skills
    try {
      const result = execSync("openclaw skills list --json 2>/dev/null || echo '[]'", {
        timeout: 5000,
        encoding: "utf8",
      });
      const cliSkills = JSON.parse(result);
      if (Array.isArray(cliSkills)) {
        for (const s of cliSkills) {
          if (!skills.find((existing) => existing.key === s.key)) {
            skills.push({ key: s.key, name: s.name || s.key, description: s.description || "" });
          }
        }
      }
    } catch {
      // CLI not available or returned non-JSON
    }

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json({ skills: [], error: error instanceof Error ? error.message : "Failed to load skills" }, { status: 200 });
  }
}
