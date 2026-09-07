import { NextResponse } from "next/server";
import { discoverSkills } from "@/lib/skills/discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const skills = discoverSkills().map(({ key, name, description, enabled, capabilities }) => ({ key, name, description, enabled, capabilities }));
    return NextResponse.json({ skills });
  } catch {
    return NextResponse.json({ skills: [], error: "Skill discovery failed. Check OpenClaw configuration and directory access." }, { status: 503 });
  }
}
