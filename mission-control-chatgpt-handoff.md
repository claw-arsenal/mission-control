# Mission Control ChatGPT Handoff

Date: 2026-03-19

This file is meant to be a compact but complete handoff for ChatGPT or any other assistant that needs to understand the current Mission Control state quickly.

---

## 1) What Mission Control is

Mission Control is the OpenClaw dashboard app.

It is intended to be:
- local-first
- Docker-based for the packaged stack
- backed by local Postgres
- connected to the local OpenClaw runtime
- optionally enriched by gateway-sync for higher-fidelity logs
- free of Supabase and systemd dependencies

The repo contains:
- dashboard UI
- local DB schema and seeds
- runtime collector utilities
- logs/agent/board pages
- scripts for install, update, sync, and repair

---

## 2) Current architecture summary

### Main components

- **Local Postgres**: source of truth for boards, tickets, agents, logs, settings
- **Runtime collector**: reads local OpenClaw session/runtime metadata and identity files
- **Gateway sync**: imports session-store metadata and emits event rows into Postgres
- **Logs API**: unified event ingestion/read API
- **Logs UI**: live explorer with chips, search, modal details, and polling badge
- **Dashboard**: boards/tasks overview, agent overview, log/activity surfaces

### Live feed concept

The logs system is designed to behave like a single live feed for:
- runtime events
- memory events
- Qdrant/vector events
- chat events
- tool events
- system events
- gateway sync events
- attribution repair events

### Notable design choice

The dashboard should prefer a unified event stream over fragmented views.

---

## 3) Current working state

### Verified backend state

- `workspaces` table exists and has 1 row.
- `app_settings` exists and setup is complete.
- `agents` table currently has 5 rows.
- `agent_logs` currently has 14 rows.
- `gateway-sync` was run successfully.
- `gateway-sync` reported:
  - `importedAgents: 5`
  - `importedEvents: 9`

### Seeded agents

The standard roster now exists:
- `main`
- `research-agent`
- `developer-agent`
- `writer-agent`
- `test-agent`

### Recent log event types observed

- `system.sync`
- `system.startup`
- runtime snapshot events

---

## 4) The main user problem still being debugged

The user still reports not seeing logs in the UI even though the backend now has rows.

This means the remaining issue is likely one of:
- browser cache / stale UI
- client wiring on the logs page
- log filtering or page state
- browser not fetching the latest API response

It is **not** currently a lack-of-data problem in the database.

---

## 5) What has already been fixed

1. **Gateway sync repaired** so it runs again.
2. **Gateway sync now seeds agents** from runtime/session data.
3. **Gateway sync now imports session-derived events** into `agent_logs`.
4. **Runtime collector emits snapshot events** into `agent_logs`.
5. **Startup event hook added** to the app shell so the session can emit a `system.startup` record.
6. **Unified logs API created** for read/insert/delete.
7. **Logs UI upgraded** with:
   - filter chips
   - search
   - modal detail view
   - colored level/channel chips
   - live badge
8. **README updated** with unified live feed architecture notes.
9. **A status file was created** for operational handoff.

---

## 6) Important file map

### App pages

- `app/dashboard/page.tsx`
- `app/boards/page.tsx`
- `app/agents/page.tsx`
- `app/agents/[agentId]/page.tsx`
- `app/logs/page.tsx`
- `app/setup/page.tsx`
- `app/settings/page.tsx`

### API routes

- `app/api/setup/route.ts`
- `app/api/notifications/route.ts`
- `app/api/agent/logs/route.ts`

### UI components

- `components/agents/logs-explorer.tsx`
- `components/agents/logs-live-refresh.tsx`
- `components/agents/clear-logs-button.tsx`
- `components/agents/agent-debug-overlay.tsx`
- `components/agents/agent-ui.tsx`
- `components/layout/app-sidebar.tsx`
- `components/layout/page-header.tsx`

### Runtime + DB logic

- `lib/runtime/collector.ts`
- `lib/runtime/merge.ts`
- `lib/runtime/types.ts`
- `lib/db/server-data.ts`
- `lib/agent-log-utils.ts`
- `lib/local-db.ts`

### Scripts

- `scripts/gateway-sync.mjs`
- `scripts/db-setup.mjs`
- `scripts/repair-agent-log-attribution.mjs`

### Docs / state files

- `README.md`
- `mission-control-status.md`
- `mission-control-chatgpt-handoff.md`
- `mission-control-status.md`

---

## 7) Important current behaviors

### Logs API

`app/api/agent/logs/route.ts`
- GET returns logs from `agent_logs`
- POST inserts a log row
- DELETE clears logs

### Logs UI

`components/agents/logs-explorer.tsx`
- search
- chip filters instead of dropdowns
- log cards
- modal full-log details
- live badge with polling

### Startup hook

`app/providers.tsx`
- client-side effect posts a `system.startup` log once per browser session
- uses sessionStorage to avoid repeated firing

### Runtime collector

`lib/runtime/collector.ts`
- reads OpenClaw runtime/session information
- resolves identity names from `IDENTITY.md`
- emits runtime snapshot logs

### Gateway sync

`scripts/gateway-sync.mjs`
- seeds the 5 standard agents
- imports session events
- writes `system.sync` logs
- ensures workspace exists
- ensures app settings exists

---

## 8) Known hiccups and debugging history

### Fixed hiccup: broken newline/regex in gateway-sync

One edit temporarily broke `gateway-sync.mjs` because `loadEnvFile` had a malformed regex/newline split.

That was corrected and the script now runs successfully.

### Current remaining hiccup

The backend is populated, but the browser UI still may not immediately show the logs the user expects.

This could be due to:
- old browser cache
- stale client state
- page wiring needing a refetch
- filter state hiding the feed

---

## 9) Commands that were used to verify the backend

### Check counts and sample rows

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

### Run gateway sync

```bash
cd /home/clawdbot/.openclaw/workspace/mission-control && node scripts/gateway-sync.mjs
```

### Example result from gateway sync

```json
{
  "ok": true,
  "importedAgents": 5,
  "importedEvents": 9
}
```

---

## 10) What the user wants

The user wants:
- the logs feed to show real-time data
- no dropdown clutter; use buttons/chips
- all relevant event types in one view:
  - runtime
  - memory
  - Qdrant
  - chat
  - system
  - tool
  - sync
- the feed to stay alive
- the UI to be slick and polished
- a complete markdown handoff file for ChatGPT / future assistants

---

## 11) Best next step

If continuing implementation, the next sensible steps are:
1. verify the browser sees the latest `/api/agent/logs` output
2. confirm the logs page renders the returned rows
3. wire additional producers for:
   - chat bridge messages
   - memory writes
   - Qdrant operations
   - tool executions
4. optionally add socket/SSE or stronger live refresh if polling is not enough

---

## 12) Concise summary for ChatGPT

Mission Control is now a local-first OpenClaw dashboard with a live logs architecture.
The backend now has seeded agents and actual log rows, but the remaining issue the user reports is that the UI still isn’t visibly showing logs yet.
The most likely next fix is browser/UI refresh or client wiring, not DB absence.

End of handoff.
