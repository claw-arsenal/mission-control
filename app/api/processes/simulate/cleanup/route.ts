import { NextResponse } from "next/server";
import { unlink, stat } from "node:fs/promises";

const ALLOWED_PREFIXES = ["/home/clawdbot/", "/storage/", "/tmp/"];

export async function POST(request: Request) {
  const body = await request.json();
  const files: string[] = Array.isArray(body.files) ? body.files : [];
  const deleted: string[] = [];
  const errors: string[] = [];

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

  return NextResponse.json({ ok: true, deleted, errors });
}
