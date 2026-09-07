import type { getSql } from "@/lib/local-db";

/** Repair JSON serialized twice by postgres.js when strings were bound as jsonb. */
export async function repairMobileAppsJsonStorage(sql: ReturnType<typeof getSql>) {
  await sql`CREATE TABLE IF NOT EXISTS mobile_apps_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  await sql`
    DO $migration$
    DECLARE target record; repaired_rows bigint; rebuild_charts boolean := false;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('mobile_apps_json_storage_v1'));
      IF EXISTS (SELECT 1 FROM mobile_apps_migrations WHERE name = 'json_storage_v1') THEN RETURN; END IF;
      EXECUTE $function$
        CREATE OR REPLACE FUNCTION pg_temp.mc_decode_report_json(value jsonb) RETURNS jsonb
        LANGUAGE plpgsql AS $decode$
        DECLARE decoded jsonb;
        BEGIN
          decoded := (value #>> '{}')::jsonb;
          IF jsonb_typeof(decoded) IN ('object', 'array') THEN RETURN decoded; END IF;
          RETURN value;
        EXCEPTION WHEN invalid_text_representation THEN RETURN value;
        END
        $decode$;
      $function$;
      FOR target IN SELECT * FROM (VALUES
        ('mobile_app_listings', 'official_ratings'), ('mobile_app_listings', 'store_metadata'),
        ('app_reviews', 'raw_json'), ('app_rating_snapshots', 'histogram'), ('app_review_digests', 'top_themes'),
        ('app_review_sync_runs', 'report_warnings'),
        ('mobile_app_report_metrics', 'metrics'), ('mobile_app_report_metrics', 'dimensions'),
        ('mobile_app_report_sync_jobs', 'stats'), ('mobile_app_report_sync_jobs', 'warnings'),
        ('mobile_app_report_freshness', 'warnings'),
        ('mobile_app_report_daily_rollups', 'metrics'),
        ('mobile_app_report_latest_breakdowns', 'metrics'), ('mobile_app_report_latest_breakdowns', 'dimensions')
      ) AS columns_to_repair(table_name, column_name)
      LOOP
        EXECUTE format('UPDATE %I SET %I = pg_temp.mc_decode_report_json(%I) WHERE jsonb_typeof(%I) = ''string''',
          target.table_name, target.column_name, target.column_name, target.column_name);
        GET DIAGNOSTICS repaired_rows = ROW_COUNT;
        IF target.table_name = 'mobile_app_report_metrics' AND repaired_rows > 0 THEN rebuild_charts := true; END IF;
      END LOOP;
      IF rebuild_charts THEN
        UPDATE mobile_app_report_freshness SET status = 'stale', active_job_id = null, updated_at = now();
        INSERT INTO mobile_app_report_sync_jobs (store, mode, reason, status)
          VALUES ('google', 'incremental', 'json-storage-repair', 'queued') ON CONFLICT DO NOTHING;
      END IF;
      INSERT INTO mobile_apps_migrations (name) VALUES ('json_storage_v1');
    END
    $migration$;
  `;
}
