# Mission Control Status

Date: 2026-03-19

## Current State

The dashboard and runtime bridge are now in a functional baseline state, but the user reported not seeing logs in the UI immediately after sync.

### Verified backend state

- `workspaces` table exists and has 1 row.
- `app_settings` exists and setup is complete.
- `agents` table now has 5 rows.
- `agent_logs` now has 14 rows.
- `gateway-sync` was run successfully and reported:
  - `importedAgents: 5`
  - `importedEvents: 9`

### Seeded agents

- `main`
- `research-agent`
- `developer-agent`
- `writer-agent`
- `test-agent`

### Recent log event types observed

- `system.sync`
- `system.startup`
- runtime snapshot events

## What was fixed

1. Repaired `scripts/gateway-sync.mjs` so it can run and seed agents/events.
2. Seeded the 5 standard agents into Postgres.
3. Imported session-derived events into `agent_logs`.
4. Added a startup POST hook from the app shell to write a `system.startup` event once per browser session.
5. Added logs UI improvements and a live badge that polls the logs API.
6. Added a unified logs API that can both read and insert events.
7. Updated README to describe the unified live feed architecture.

## Current problem reported by user

The user still reports not seeing logs in the UI, even though the backend now contains rows.

Likely causes to verify next:

- The browser session may need a hard refresh after the new startup hook.
- The logs page may still need a direct API fetch/refresh in the client UI.
- The browser may be loading a cached build or old page state.
- The visible logs may be filtered out or not wired to the current log source in the page component.

## Known code paths involved

### Logs API

- `app/api/agent/logs/route.ts`

Current behavior:
- GET returns rows from `agent_logs`
- POST inserts events into `agent_logs`
- DELETE clears `agent_logs`

### Logs UI

- `app/logs/page.tsx`
- `components/agents/logs-explorer.tsx`
- `components/agents/logs-live-refresh.tsx`

### Runtime ingestion

- `lib/runtime/collector.ts`
- `scripts/gateway-sync.mjs`

### Startup hook

- `app/providers.tsx`

## Notes on the hickups

There were a few implementation hiccups while wiring the system:

- One edited script (`gateway-sync.mjs`) temporarily broke due to a malformed newline/regex in `loadEnvFile`; this was corrected and the script now runs successfully.
- Several UI and data loader changes were made incrementally to get the logs feed, runtime collectors, and agent seeding working together.
- The main remaining gap is user-visible log rendering/refresh in the browser, not backend data availability.

## Recommended next actions

1. Have the user hard refresh `/logs` and `/agents`.
2. If still empty, inspect the browser network response for `/api/agent/logs?limit=...`.
3. If the API returns rows but UI shows none, fix the logs page wiring/client state.
4. If the API returns no rows in browser but DB has rows, verify the app is pointed at the same DB connection.

## Quick verification commands

Run these from the mission-control repo:

```bash
node - <<'NODE'
const postgres = require('postgres');
(async()=>{
  const sql = postgres(process.env.DATABASE_URL || process.env.OPENCLAW_DATABASE_URL || 'postgresql://openclaw:openclaw@localhost:5432/mission_control', {max:1, prepare:false});
  try {
    const logs = await sql`select count(*)::int as count from agent_logs`;
    const agents = await sql`select count(*)::int as count from agents`;
    const sample = await sql`select runtime_agent_id, level, type, event_type, message from agent_logs order by occurred_at desc limit 5`;
    console.log({logs: logs[0].count, agents: agents[0].count, sample});
  } finally { await sql.end(); }
})();
NODE
```

```bash
cd /home/clawdbot/.openclaw/workspace/mission-control && node scripts/gateway-sync.mjs
```

## Summary

Backend event ingestion is now working. The remaining issue is likely UI refresh or client wiring rather than lack of data.
