import type { getSql } from "@/lib/local-db";
import type { GoogleConfig } from "./config";
import type { ReportFile, ReviewCsvFile } from "./providers/google-play-reports";

type Sql = ReturnType<typeof getSql>;
type CsvFile = ReportFile | ReviewCsvFile;
type FileResult = { rows: number; reviewsParsed?: number; reviewsInserted?: number };

export type ReportSyncStats = {
  warnings: string[];
  groupsAttempted: number;
  filesFound: number;
  filesDownloaded: number;
  filesSkipped: number;
  filesFailed: number;
  reviewsParsed: number;
  reviewsInserted: number;
};

/** One owner for generation caching, atomic replacement, and per-file outcomes. */
export async function ingestReportFiles<File extends CsvFile>(
  sql: Sql,
  listingId: string,
  cfg: GoogleConfig,
  input: {
    files: File[];
    label: string;
    force: boolean;
    warning?: string | null;
    consume: (sql: Sql, file: File) => Promise<FileResult>;
  },
): Promise<ReportSyncStats> {
  const stats: ReportSyncStats = {
    warnings: input.warning ? [input.warning] : [], groupsAttempted: 1,
    filesFound: input.files.length, filesDownloaded: 0, filesSkipped: 0,
    filesFailed: 0, reviewsParsed: 0, reviewsInserted: 0,
  };
  for (const file of input.files) {
    try {
      if (file.sizeBytes != null && file.sizeBytes > cfg.reportsMaxFileBytes) {
        throw new Error(`File exceeds the ${(cfg.reportsMaxFileBytes / 1024 / 1024).toFixed(1)}MB report limit.`);
      }
      const cached = (await sql`
        select generation, status from mobile_app_report_files
        where listing_id = ${listingId}::uuid and object_path = ${file.path}
      `)[0] as { generation: string | null; status: string } | undefined;
      if (!input.force && file.generation != null && cached?.generation === file.generation && (cached.status === "parsed" || cached.status === "empty")) {
        stats.filesSkipped++;
        continue;
      }
      const result = await sql.begin(async tx => {
        const db = tx as unknown as Sql;
        // A replacement CSV can remove rows as well as change values. Roll back
        // the whole file on parse failure so the prior generation remains usable.
        if (file.kind !== "reviews") {
          await db`
            delete from mobile_app_report_metrics
            where listing_id = ${listingId}::uuid and report = ${file.kind}
              and dimension = ${file.dimension} and report_month = ${file.yyyyMM}
          `;
        }
        const parsed = await input.consume(db, file);
        await markReportFile(db, listingId, file, parsed.rows ? "parsed" : "empty", parsed.rows, null);
        return parsed;
      });
      stats.filesDownloaded++;
      stats.reviewsParsed += result.reviewsParsed ?? 0;
      stats.reviewsInserted += result.reviewsInserted ?? 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.filesFailed++;
      stats.warnings.push(`${input.label} ${file.yyyyMM} ${file.dimension}: ${message}`);
      await markReportFile(sql, listingId, file, "failed", 0, message);
    }
  }
  return stats;
}

async function markReportFile(sql: Sql, listingId: string, file: CsvFile, status: string, rows: number, error: string | null) {
  await sql`
    insert into mobile_app_report_files (
      listing_id, report, dimension, object_path, yyyy_mm, generation, size_bytes,
      downloaded_at, parsed_at, rows_count, status, error_message, updated_at
    ) values (
      ${listingId}::uuid, ${file.kind}, ${file.dimension}, ${file.path}, ${file.yyyyMM}, ${file.generation}, ${file.sizeBytes},
      now(), ${status === "failed" ? null : new Date().toISOString()}::timestamptz, ${rows}, ${status}, ${error}, now()
    )
    on conflict (listing_id, object_path) do update set
      report = excluded.report, dimension = excluded.dimension, yyyy_mm = excluded.yyyy_mm,
      generation = excluded.generation, size_bytes = excluded.size_bytes,
      downloaded_at = excluded.downloaded_at, parsed_at = excluded.parsed_at,
      rows_count = excluded.rows_count, status = excluded.status,
      error_message = excluded.error_message, updated_at = now()
  `;
}
