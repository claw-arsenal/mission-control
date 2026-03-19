#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const defaultEnvPath =
  process.env.DASHBOARD_TEMPLATE_ENV?.trim() ||
  "/etc/clawd/template.env";
const defaultLoggerPath = join(homedir(), ".openclaw", "bridge-logger.js");

function parseArgs(argv) {
  const options = {
    env: defaultEnvPath,
    logger: defaultLoggerPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--env" || arg === "-e") && next) {
      options.env = next;
      index += 1;
      continue;
    }
    if ((arg === "--logger" || arg === "-l") && next) {
      options.logger = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

function loadEnvFile(pathname) {
  const env = {};
  const lines = readFileSync(pathname, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

function assertEnvKey(env, key) {
  const value = env[key];
  if (!value) throw new Error(`Missing required env key in file: ${key}`);
  return value;
}

function resolveSupabaseUrl(env) {
  const value = env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!value) {
    throw new Error("Missing required env key in file: NEXT_PUBLIC_SUPABASE_URL");
  }
  return value;
}

function checkNodeSyntax(loggerPath) {
  const result = spawnSync("node", ["--check", loggerPath], { stdio: "pipe" });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8")?.trim() || "Unknown syntax error";
    throw new Error(`Logger syntax check failed: ${stderr}`);
  }
}

async function validateSupabase(env) {
  const supabaseUrl = resolveSupabaseUrl(env);
  const serviceRoleKey = assertEnvKey(env, "SUPABASE_SERVICE_ROLE_KEY");
  const workspaceId = assertEnvKey(env, "OPENCLAW_WORKSPACE_ID");
  const agentId = assertEnvKey(env, "OPENCLAW_AGENT_ID");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: agents, error: agentError } = await supabase
    .from("agents")
    .select("id, workspace_id")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (agentError) throw new Error(`Supabase connectivity check failed: ${agentError.message}`);
  if (!agents || agents.length === 0) {
    throw new Error(`Agent not found for OPENCLAW_AGENT_ID=${agentId} in workspace ${workspaceId}`);
  }

  const { error: schemaError } = await supabase
    .from("agent_logs")
    .select("id,event_type,direction,channel_type,message_preview")
    .limit(1);

  if (schemaError) throw new Error(`Schema check failed: ${schemaError.message}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(options.logger)) {
    throw new Error(`Logger file not found: ${options.logger}`);
  }
  if (!existsSync(options.env)) {
    throw new Error(`Env file not found: ${options.env}`);
  }

  checkNodeSyntax(options.logger);
  const env = loadEnvFile(options.env);
  await validateSupabase(env);

  console.log("Bridge validation passed.");
  console.log(`- logger: ${options.logger}`);
  console.log(`- env: ${options.env}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Bridge validation failed: ${message}`);
  process.exit(1);
});
