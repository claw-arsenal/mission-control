import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
describe("report worker CLI validation", () => {
  it.each([
    [["--app-id"], "Missing value for --app-id"],
    [["--listing-id", "invalid"], "IDs must be UUIDs"],
    [["--mode", "invalid"], "Mode must be incremental or backfill"],
    [["--unexpected"], "Unknown argument"],
  ])("rejects %j before loading the database", (args, error) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/mobile-reports-sync.ts", ...args], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      env: { ...process.env, DATABASE_URL: "", OPENCLAW_DATABASE_URL: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(error);
    expect(result.stdout).not.toContain("Missing DATABASE_URL");
  });
});
