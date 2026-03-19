import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rootDir = process.cwd();
const envPath = resolve(rootDir, ".env.local");
const seedPath = resolve(rootDir, "supabase", "seed.sql");
const templateEnvPath =
  process.env.DASHBOARD_TEMPLATE_ENV?.trim() ||
  "/etc/clawd/template.env";

function loadEnvFile(pathname) {
  if (!existsSync(pathname)) {
    return;
  }

  const source = readFileSync(pathname, "utf8");
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) continue;

    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

function getDbUrl() {
  return (
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    ""
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: rootDir,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runDbPush(dbUrl, includeSeed = false) {
  const args = ["--yes", "supabase", "db", "push", "--db-url", dbUrl, "--yes"];
  if (includeSeed) {
    args.push("--include-seed");
  }
  run("npx", args);
}

function runMigrations(dbUrl) {
  runDbPush(dbUrl, false);
}

function runSeed(dbUrl) {
  if (!existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }
  runDbPush(dbUrl, true);
}

async function wipePublicSchema(dbUrl) {
  let postgres;

  try {
    ({ default: postgres } = await import("postgres"));
  } catch {
    console.error(
      'Missing dependency "postgres". Run "npm install -D postgres" and retry.',
    );
    process.exit(1);
  }

  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
  });

  try {
    await sql`set client_min_messages to warning`;

    await sql.unsafe(`
      do $$
      declare
        row record;
      begin
        for row in
          select table_name
          from information_schema.tables
          where table_schema = 'public'
            and table_type = 'BASE TABLE'
        loop
          execute format('drop table if exists public.%I cascade', row.table_name);
        end loop;

        for row in
          select table_name
          from information_schema.views
          where table_schema = 'public'
        loop
          execute format('drop view if exists public.%I cascade', row.table_name);
        end loop;

        for row in
          select matviewname
          from pg_matviews
          where schemaname = 'public'
        loop
          execute format('drop materialized view if exists public.%I cascade', row.matviewname);
        end loop;

        for row in
          select
            proc.proname as routine_name,
            pg_get_function_identity_arguments(proc.oid) as identity_arguments
          from pg_proc proc
          join pg_namespace namespace
            on namespace.oid = proc.pronamespace
          where namespace.nspname = 'public'
            and proc.prokind = 'f'
        loop
          execute format(
            'drop function if exists public.%I(%s) cascade',
            row.routine_name,
            row.identity_arguments
          );
        end loop;

        for row in
          select sequence_name
          from information_schema.sequences
          where sequence_schema = 'public'
        loop
          execute format('drop sequence if exists public.%I cascade', row.sequence_name);
        end loop;

        if exists (
          select 1
          from information_schema.tables
          where table_schema = 'supabase_migrations'
            and table_name = 'schema_migrations'
        ) then
          truncate table supabase_migrations.schema_migrations;
        end if;
      end
      $$;
    `);

    await sql`reset client_min_messages`;
  } finally {
    await sql.end();
  }
}

async function confirmReset() {
  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(
      "This will delete app tables/data in public (wipe only). Continue? (yes/no): ",
    );

    const normalized = answer.trim().toLowerCase();
    return normalized === "yes" || normalized === "y";
  } finally {
    rl.close();
  }
}

loadEnvFile(envPath);
loadEnvFile(templateEnvPath);

async function main() {
  const mode = process.argv[2] ?? "setup";
  const dbUrl = getDbUrl();

  if (!dbUrl) {
    console.error(
      "Missing SUPABASE_DB_URL (or DATABASE_URL). Add it to .env.local and retry.",
    );
    process.exit(1);
  }

  if (mode === "migrate") {
    runMigrations(dbUrl);
    process.exit(0);
  }

  if (mode === "seed") {
    runSeed(dbUrl);
    process.exit(0);
  }

  if (mode === "setup") {
    runSeed(dbUrl);
    process.exit(0);
  }

  if (mode === "reset") {
    const confirmed = await confirmReset();
    if (!confirmed) {
      console.log("Cancelled.");
      process.exit(0);
    }

    await wipePublicSchema(dbUrl);
    console.log("Wipe complete. Run `npm run db:setup` to recreate schema, or `npm run db:migrate` for migrations only.");
    process.exit(0);
  }

  console.error(`Unknown mode "${mode}". Use: migrate | seed | setup | reset`);
  process.exit(1);
}

await main();
