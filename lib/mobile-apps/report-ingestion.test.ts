import { describe, expect, it, vi } from "vitest";
import { ingestReportFiles } from "./report-ingestion";
import type { getSql } from "@/lib/local-db";
import type { GoogleConfig } from "./config";
import type { ReportFile } from "./providers/google-play-reports";

const file: ReportFile = { path: "installs.csv", kind: "installs", dimension: "overview", yyyyMM: "202606", generation: "2", sizeBytes: 20, updated: null };
const config = { reportsMaxFileBytes: 100 } as GoogleConfig;

function database(cached?: { generation: string | null; status: string }) {
  let metrics = ["previous generation"];
  let record = cached;
  const events: string[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(" ");
    if (q.includes("select generation")) return record ? [record] : [];
    if (q.includes("delete from mobile_app_report_metrics")) metrics = [];
    if (q.includes("insert into mobile_app_report_files")) record = { generation: String(values[5]), status: String(values[9]) };
    return [];
  }) as unknown as ReturnType<typeof getSql>;
  sql.begin = (async (fn: (db: typeof sql) => Promise<unknown>) => {
    const before = { metrics: [...metrics], record };
    events.push("begin");
    try {
      const result = await fn(sql);
      events.push("commit");
      return result;
    } catch (error) {
      metrics = before.metrics;
      record = before.record;
      events.push("rollback");
      throw error;
    }
  }) as unknown as typeof sql.begin;
  return { sql, events, append: (value: string) => metrics.push(value), metrics: () => metrics, record: () => record };
}

describe("report-file ingestion", () => {
  it("rolls back a replacement that fails after a persisted batch", async () => {
    const db = database();
    const stats = await ingestReportFiles(db.sql, "L1", config, {
      files: [file], label: "installs", force: false,
      consume: async () => { db.append("incomplete new data"); throw new Error("Invalid CSV"); },
    });
    expect(db.metrics()).toEqual(["previous generation"]);
    expect(db.events).toEqual(["begin", "rollback"]);
    expect(db.record()?.status).toBe("failed");
    expect(stats.filesFailed).toBe(1);
  });

  it("replaces removed rows and commits the file index with the new data", async () => {
    const db = database();
    await ingestReportFiles(db.sql, "L1", config, {
      files: [file], label: "installs", force: false,
      consume: async () => { db.append("new generation"); return { rows: 1 }; },
    });
    expect(db.metrics()).toEqual(["new generation"]);
    expect(db.record()).toEqual({ generation: "2", status: "parsed" });
    expect(db.events).toEqual(["begin", "commit"]);
  });

  it.each(["parsed", "empty"])("skips unchanged %s generations", async status => {
    const db = database({ generation: "2", status });
    const consume = vi.fn(async () => ({ rows: 0 }));
    const result = await ingestReportFiles(db.sql, "L1", config, { files: [file], label: "installs", force: false, consume });
    expect(consume).not.toHaveBeenCalled();
    expect(result.filesSkipped).toBe(1);
  });

  it("retries missing generations and forces backfills through the same path", async () => {
    const db = database({ generation: null, status: "parsed" });
    const consume = vi.fn(async () => ({ rows: 0 }));
    await ingestReportFiles(db.sql, "L1", config, { files: [{ ...file, generation: null }], label: "installs", force: false, consume });
    await ingestReportFiles(db.sql, "L1", config, { files: [file], label: "installs", force: true, consume });
    expect(consume).toHaveBeenCalledTimes(2);
    expect(db.record()?.status).toBe("empty");
  });

  it("records oversized files without opening a transaction or consuming rows", async () => {
    const db = database();
    const consume = vi.fn(async () => ({ rows: 0 }));
    const result = await ingestReportFiles(db.sql, "L1", config, { files: [{ ...file, sizeBytes: 101 }], label: "installs", force: false, consume });
    expect(db.events).toEqual([]);
    expect(consume).not.toHaveBeenCalled();
    expect(result.filesFailed).toBe(1);
    expect(db.metrics()).toEqual(["previous generation"]);
  });
});
