import { NextResponse } from "next/server";
import { unlink, stat, truncate } from "node:fs/promises";

const ALLOWED_PREFIXES = ["/home/clawdbot/", "/storage/", "/tmp/"];

type SessionSnapshot = {
  agentId: string;
  sessionFilePath: string;
  byteOffset: number;
};

export async function POST(request: Request): Promise<ReturnType<typeof NextResponse.json>> {
  const body = await request.json();
  const files: string[] = Array.isArray(body.files) ? body.files : [];
  const snapshots: SessionSnapshot[] = Array.isArray(body.sessionSnapshots)
    ? body.sessionSnapshots
    : [];

  const deleted: string[] = [];
  const errors: string[] = [];
  let sessionsRestored = 0;

  // ── 1. Delete simulation-created files ──
  for (const f of files) {
    if (!ALLOWED_PREFIXES.some((p) => f.startsWith(p))) {
      errors.push(`${f}: outside allowed paths`);
      continue;
    }
    try {
      const s = await stat(f);
      if (!s.isFile()) {
        errors.push(`${f}: not a file`);
        continue;
      }
      await unlink(f);
      deleted.push(f);
    } catch (err) {
      errors.push(`${f}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  // ── 2. Restore agent session files to pre-simulation state ──
  // JSONL is append-only — simulation messages were appended at the end.
  // Truncating back to the pre-simulation byte offset removes exactly
  // those messages and nothing else.
  for (const snap of snapshots) {
    const { agentId, sessionFilePath, byteOffset } = snap;
    if (!sessionFilePath || typeof byteOffset !== "number" || byteOffset < 0) {
      errors.push(`${agentId}: invalid snapshot data`);
      continue;
    }
    // Safety: only allow session files under the agents directory
    if (!sessionFilePath.includes("/.openclaw/agents/") || !sessionFilePath.endsWith(".jsonl")) {
      errors.push(`${agentId}: path rejected (safety check)`);
      continue;
    }
    if (sessionFilePath.includes("..")) {
      errors.push(`${agentId}: path traversal rejected`);
      continue;
    }
    try {
      const s = await stat(sessionFilePath);
      if (!s.isFile()) {
        errors.push(`${agentId}: session file not found`);
        continue;
      }
      // Only truncate if the file grew (i.e. simulation added messages)
      if (s.size > byteOffset) {
        await truncate(sessionFilePath, byteOffset);
        sessionsRestored++;
      }
    } catch (err) {
      errors.push(`${agentId}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return NextResponse.json({ ok: true, deleted, sessionsRestored, errors });
}
