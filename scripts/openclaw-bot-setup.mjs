import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const envPath = resolve(rootDir, ".env.local");
const templateEnvPath =
  process.env.DASHBOARD_TEMPLATE_ENV?.trim() ||
  "/etc/clawd/template.env";

const allowedStatuses = new Set(["running", "idle", "degraded"]);
const defaultWorkspaceName = "My Workspace";
const defaultAgentModel = "unknown";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supportsColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

function red(text) {
  return supportsColor ? `\u001b[31m${text}\u001b[0m` : text;
}

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
  return process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  npm run bot:setup -- --email <login-email> [--status <running|idle|degraded>] [--workspace-id <uuid>] [--agent-id <uuid>] [--runtime-agent-id <id>] [--json]", 
      "",
      "Examples:",
      "  npm run bot:setup -- --email cem@example.com",
      "  npm run bot:setup -- --email cem@example.com --workspace-id <workspace-uuid> --agent-id <agent-uuid>",
      "  npm run bot:setup -- --email cem@example.com --json",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    email: "",
    workspaceId: "",
    agentId: "",
    runtimeAgentId: "",
    status: "",
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === "email") options.email = value.trim();
    else if (key === "workspace-id") options.workspaceId = value.trim();
    else if (key === "agent-id") options.agentId = value.trim();
    else if (key === "runtime-agent-id") options.runtimeAgentId = value.trim();
    else if (key === "status") options.status = value.trim();
    else throw new Error(`Unknown argument: --${key}`);

    index += 1;
  }

  return options;
}

function validateOptions(options) {
  if (!options.workspaceId && !options.email) {
    throw new Error("Provide --email or --workspace-id.");
  }

  if (options.workspaceId && !uuidPattern.test(options.workspaceId)) {
    throw new Error("--workspace-id must be a valid UUID.");
  }

  if (options.agentId && !uuidPattern.test(options.agentId)) {
    throw new Error("--agent-id must be a valid UUID.");
  }

  if (options.status && !allowedStatuses.has(options.status)) {
    throw new Error("--status must be one of: running, idle, degraded.");
  }

  if (options.runtimeAgentId && !/^[a-zA-Z0-9:_-]{1,100}$/.test(options.runtimeAgentId)) {
    throw new Error("--runtime-agent-id can include letters, numbers, :, _, - only.");
  }
}

async function resolveProfileByEmail(sql, email) {
  let profileRows = await sql`
    select id, email
    from public.profiles
    where lower(email) = lower(${email})
    limit 1
  `;

  if (profileRows.length === 0) {
    const authRows = await sql`
      select id, email
      from auth.users
      where lower(email) = lower(${email})
      limit 1
    `;

    if (authRows.length === 0) {
      throw new Error(`No auth user found for email: ${email}`);
    }

    const authUser = authRows[0];
    const fallbackName = authUser.email?.split("@")[0] || "Openclaw User";

    await sql`
      insert into public.profiles (id, email, name)
      values (${authUser.id}, ${authUser.email}, ${fallbackName})
      on conflict (id) do update
      set email = excluded.email
    `;

    profileRows = await sql`
      select id, email
      from public.profiles
      where id = ${authUser.id}
      limit 1
    `;
  }

  return profileRows[0];
}

async function resolveWorkspaceId(sql, options) {
  if (options.workspaceId) {
    const workspaceRows = await sql`
      select id
      from public.workspaces
      where id = ${options.workspaceId}
      limit 1
    `;

    if (workspaceRows.length > 0) {
      if (!options.email) {
        return {
          workspaceId: workspaceRows[0].id,
          email: null,
          userId: null,
        };
      }

      const profile = await resolveProfileByEmail(sql, options.email);
      await sql`
        insert into public.workspace_members (workspace_id, user_id, role)
        values (${workspaceRows[0].id}, ${profile.id}, 'member')
        on conflict (workspace_id, user_id) do nothing
      `;

      return {
        workspaceId: workspaceRows[0].id,
        email: profile.email,
        userId: profile.id,
      };
    }

    if (!options.email) {
      throw new Error(
        `Workspace not found: ${options.workspaceId}. Provide --email so bot:setup can create it.`,
      );
    }

    const profile = await resolveProfileByEmail(sql, options.email);
    await sql`
      insert into public.workspaces (id, owner_id, name)
      values (${options.workspaceId}, ${profile.id}, ${defaultWorkspaceName})
      on conflict (id) do nothing
    `;

    await sql`
      insert into public.workspace_members (workspace_id, user_id, role)
      values (${options.workspaceId}, ${profile.id}, 'owner')
      on conflict (workspace_id, user_id) do update
      set role = excluded.role
    `;

    return {
      workspaceId: options.workspaceId,
      email: profile.email,
      userId: profile.id,
    };
  }

  const profile = await resolveProfileByEmail(sql, options.email);
  const membershipRows = await sql`
    select workspace_id, role
    from public.workspace_members
    where user_id = ${profile.id}
    order by
      case when role = 'owner' then 0 else 1 end,
      workspace_id
    limit 1
  `;

  if (membershipRows.length === 0) {
    const workspaceRows = await sql`
      insert into public.workspaces (owner_id, name)
      values (${profile.id}, ${defaultWorkspaceName})
      returning id
    `;

    const workspaceId = workspaceRows[0].id;

    await sql`
      insert into public.workspace_members (workspace_id, user_id, role)
      values (${workspaceId}, ${profile.id}, 'owner')
      on conflict (workspace_id, user_id) do update
      set role = excluded.role
    `;

    return {
      workspaceId,
      email: profile.email,
      userId: profile.id,
    };
  }

  return {
    workspaceId: membershipRows[0].workspace_id,
    email: profile.email,
    userId: profile.id,
  };
}

async function upsertAgent(sql, workspaceId, options) {
  const createStatus = options.status || "idle";
  const runtimeAgentId = options.runtimeAgentId || "main";

  if (options.agentId) {
    const existingByIdRows = await sql`
      select id
      from public.agents
      where id = ${options.agentId}
      limit 1
    `;

    if (existingByIdRows.length > 0) {
      const updatedRows = await sql`
        update public.agents
        set
          workspace_id = ${workspaceId},
          status = coalesce(${options.status || null}, status),
          openclaw_agent_id = coalesce(${options.runtimeAgentId || null}, openclaw_agent_id),
          last_heartbeat_at = now()
        where id = ${options.agentId}
        returning id
      `;

      return {
        action: "updated",
        agentId: updatedRows[0].id,
      };
    }

    const insertedRows = await sql`
      insert into public.agents (
        id,
        workspace_id,
        openclaw_agent_id,
        status,
        model
      )
      values (
        ${options.agentId},
        ${workspaceId},
        ${runtimeAgentId},
        ${createStatus},
        ${defaultAgentModel}
      )
      returning id
    `;

    return {
      action: "created",
      agentId: insertedRows[0].id,
    };
  }

  const existingRows = await sql`
    select id
    from public.agents
    where workspace_id = ${workspaceId}
    order by created_at asc
    limit 1
  `;

  if (existingRows.length > 0) {
    const agentId = existingRows[0].id;
    const updatedRows = await sql`
      update public.agents
      set
        status = coalesce(${options.status || null}, status),
        openclaw_agent_id = coalesce(${options.runtimeAgentId || null}, openclaw_agent_id),
        last_heartbeat_at = now()
      where id = ${agentId}
      returning id
    `;

    return {
      action: "updated",
      agentId: updatedRows[0].id,
    };
  }

  const insertedRows = await sql`
    insert into public.agents (
      workspace_id,
      openclaw_agent_id,
      status,
      model
    )
    values (
      ${workspaceId},
      ${runtimeAgentId},
      ${createStatus},
      ${defaultAgentModel}
    )
    returning id
  `;

  return {
    action: "created",
    agentId: insertedRows[0].id,
  };
}

loadEnvFile(envPath);
loadEnvFile(templateEnvPath);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  validateOptions(options);

  const dbUrl = getDbUrl();
  if (!dbUrl) {
    throw new Error("Missing SUPABASE_DB_URL (or DATABASE_URL) in .env.local.");
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
  });

  try {
    const identity = await resolveWorkspaceId(sql, options);
    const result = await upsertAgent(sql, identity.workspaceId, options);

    const output = {
      action: result.action,
      email: identity.email,
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      agentId: result.agentId,
      runtimeAgentId: options.runtimeAgentId || "main",
      status: options.status || null,
      env: {
        OPENCLAW_WORKSPACE_ID: identity.workspaceId,
        OPENCLAW_AGENT_ID: result.agentId,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
      process.exit(0);
    }

    console.log("OpenClaw bot dashboard setup complete.");
    console.log(`Action: ${output.action}`);
    console.log(`Workspace ID: ${output.workspaceId}`);
    console.log(`Agent ID: ${output.agentId}`);
    if (output.runtimeAgentId) {
      console.log(`Runtime Agent ID: ${output.runtimeAgentId}`);
    }
    console.log("");
    console.log("Runtime default on create: model=unknown.");
    console.log("OpenClaw runtime should provide the displayed name and live runtime metrics after startup.");
    console.log("");
    console.log(red("COPY THESE INTO /etc/clawd/template.env:"));
    console.log(red(`OPENCLAW_WORKSPACE_ID=${output.env.OPENCLAW_WORKSPACE_ID}`));
    console.log(red(`OPENCLAW_AGENT_ID=${output.env.OPENCLAW_AGENT_ID}`));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`openclaw-bot-setup failed: ${message}`);
  printUsage();
  process.exit(1);
});
