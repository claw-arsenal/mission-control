# Mission Control Flow (Current)

Date: 2026-03-19

This file explains how Mission Control currently works, end-to-end, in a "follow the request" style.
It is intended to be cat-able in a terminal and readable by ChatGPT or other assistants.

---

## 1) High-level flow

User opens Mission Control
→ Next.js app loads
→ SetupGuard checks whether setup is complete
→ Providers mount
→ startup hook posts a startup log once per browser session
→ server-side loader reads data from local Postgres + runtime snapshots
→ dashboard pages render boards / agents / logs
→ gateway-sync can later enrich the database with session-store metadata
→ the logs page renders the combined event history

---

## 2) Startup and setup flow

### Files involved
- `app/layout.tsx`
- `components/setup-guard.tsx`
- `app/providers.tsx`
- `app/api/setup/route.ts`
- `lib/db/server-data.ts`

### Flow

1. `app/layout.tsx` mounts the global providers.
2. `SetupGuard` checks setup state.
3. `Providers` mounts the theme provider and the startup event hook.
4. On first browser session load, the startup hook POSTs a `system.startup` log into `/api/agent/logs`.
5. `app/api/setup/route.ts` stores and reads setup data from `app_settings`.
6. `lib/db/server-data.ts` reads the setup status and decides whether to show the setup UI.

### Startup hook snippet

```tsx
function StartupEventHook() {
  useEffect(() => {
    const fired = sessionStorage.getItem("mission-control-startup-event-fired");
    if (fired) return;
    sessionStorage.setItem("mission-control-startup-event-fired", "1");

    void fetch("/api/agent/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runtimeAgentId: "main",
        agentId: "main",
        level: "info",
        type: "system",
        eventType: "system.startup",
        message: "Mission Control session startup",
        channelType: "internal",
      }),
    });
  }, []);
  return null;
}
```

### Result

- one startup event per browser session
- stored as a log row
- visible to the logs feed if the UI is reading live data correctly

---

## 3) Setup API flow

### File
- `app/api/setup/route.ts`

### Flow

Request → `/api/setup`
→ checks `app_settings`
→ if missing, returns defaults
→ if saving, inserts or updates the gateway token and setup flag
→ dashboard setup state becomes complete

### Core behavior

- `GET` reads `setup_completed` and `gateway_token`
- `POST` writes them
- setup is now local DB-backed

### Example shape

```json
{
  "setupCompleted": true,
  "settings": {
    "gatewayToken": "..."
  }
}
```

---

## 4) Runtime collector flow

### File
- `lib/runtime/collector.ts`

### What it does

The runtime collector reads local OpenClaw session/runtime data and resolves agent identities.

It then builds snapshots like:
- agent id
- display name
- model
- heartbeat time
- queue depth
- status

It also emits runtime snapshot events into the logs table.

### Flow

OpenClaw sessions data
→ runtime collector
→ per-agent snapshot object
→ merged into dashboard agent view
→ snapshot event inserted into `agent_logs`

### Example emitted event

```json
{
  "event_type": "runtime.snapshot",
  "runtime_agent_id": "main",
  "level": "info",
  "type": "system",
  "message": "Runtime snapshot collected for main"
}
```

### Snapshot payload example

```json
{
  "model": "openai/gpt-5.4-mini",
  "heartbeatAt": "2026-03-19T23:24:23.574Z",
  "activeRuns": 1,
  "queueDepth": 1
}
```

### Result

- the dashboard can show live-ish agent state
- the logs table gets snapshot rows automatically

---

## 5) Gateway sync flow

### File
- `scripts/gateway-sync.mjs`

### Purpose

This worker enriches the DB by importing session metadata and agent/runtime information.

### Flow

`openclaw sessions --all-agents --json`
→ parse sessions/stores
→ ensure workspace exists
→ ensure app settings exists
→ seed standard agents
→ upsert agent rows
→ insert `system.sync` log rows
→ print summary

### Current behavior

- creates workspace if missing
- seeds these agents:
  - `main`
  - `research-agent`
  - `developer-agent`
  - `writer-agent`
  - `test-agent`
- imports session events into `agent_logs`

### Example output

```json
{
  "ok": true,
  "importedAgents": 5,
  "importedEvents": 9
}
```

### Result

- agents table now has real rows
- agent logs are populated
- the logs feed has backend data to render

---

## 6) Logs API flow

### File
- `app/api/agent/logs/route.ts`

### Purpose

This is the unified event endpoint.
It is both a read API and an ingest API.

### GET flow

Request → `/api/agent/logs?limit=...`
→ reads rows from `agent_logs`
→ returns JSON

### POST flow

Request → `/api/agent/logs`
→ validates body
→ looks up workspace
→ looks up agent row if possible
→ inserts into `agent_logs`
→ returns inserted row

### DELETE flow

Request → `/api/agent/logs`
→ deletes all rows from `agent_logs`
→ returns ok

### Current simplified read behavior

The GET route currently returns logs in descending time order and accepts a `limit` parameter.

### Example GET response shape

```json
{
  "logs": [
    {
      "runtime_agent_id": "main",
      "level": "info",
      "type": "system",
      "event_type": "runtime.snapshot",
      "message": "Runtime snapshot collected for main"
    }
  ]
}
```

### Result

- logs can be viewed from the UI
- logs can be written by runtime, sync, startup, or future producers

---

## 7) Logs UI flow

### Files
- `app/logs/page.tsx`
- `components/agents/logs-explorer.tsx`
- `components/agents/logs-live-refresh.tsx`
- `components/agents/clear-logs-button.tsx`

### Flow

Logs page loads
→ server reads agents + logs
→ `LogsExplorer` receives rows
→ UI renders cards with chips and filters
→ full-log modal opens per row

### Logs explorer behavior

- search input
- filter chips
- agent chips
- live badge
- log cards
- full-log modal
- colored level/channel tags

### Current notes

- the live badge is intentionally lightweight
- the main logs page should render the full log array
- `limit=1` was only meant for live connection checking, not the main feed

### UI rendering model

```tsx
<LogsExplorer agents={agents} logs={logs} />
```

### Filtering model

Logs are filtered by:
- search query
- selected agent
- selected channel
- quick filter category
- level/event type heuristics

### Result

- a slick live log explorer
- full details in a modal
- no dropdown-heavy filter clutter

---

## 8) Agent detail flow

### File
- `app/agents/[agentId]/page.tsx`

### Flow

Request `/agents/<agentId>`
→ server loads agent details data
→ resolves runtime snapshot
→ resolves identity name
→ renders status/model/heartbeat/queue info

### Result

- each agent has a detail page
- it shows live snapshot-style data where available

---

## 9) Boards and tasks flow

### Files
- `app/boards/page.tsx`
- `components/tasks/boards/...`
- `lib/db/server-data.ts`
- `types/tasks.ts`

### Flow

Workspace boards and tickets are stored in Postgres.

Agents are now treated ID-first where possible:
- ticket assignment stores stable IDs
- UI resolves runtime display names when available
- less stale label data in DB

### Result

- stable assignment model
- better compatibility with runtime-resolved names

---

## 10) Memory / Qdrant / chat / tool event model

### Files involved
- `lib/agent-log-utils.ts`
- `app/api/agent/logs/route.ts`
- future emitters in memory/chat/tool/Qdrant paths

### Classification model already recognizes

- memory read / write / search / upsert
- qdrant / vector / embedding
- chat inbound / outbound / reaction
- tool start / success / error
- system startup / shutdown / warning / error
- heartbeat events

### Example classification logic

```ts
if (type === "memory" || hasMemoryHints(normalized)) {
  return classifyMemoryEventFromText(level, normalized);
}

if (type === "tool") {
  if (level === "error") return "tool.error";
  if (normalized.includes("(started)")) return "tool.start";
  if (normalized.includes("(failed)")) return "tool.error";
  return "tool.success";
}
```

### Result

- the feed is already prepared to understand memory/chat/tool/Qdrant events
- the remaining work is wiring the actual emitters into those producer paths

---

## 11) Current backend state recap

### Known-good counts

- `workspaces`: 1
- `agents`: 5
- `agent_logs`: 21 at last verification

### Recent real log rows observed

- `runtime.snapshot`
- `system.sync`
- `system.startup`

### Verified command output

```json
{
  "ok": true,
  "importedAgents": 5,
  "importedEvents": 9
}
```

---

## 12) Known hiccups

### Turbopack HMR issues

During development, Next/Turbopack sometimes produced an HMR message error:
- `Invalid message: {"isTrusted":true}`
- `Cannot convert undefined or null to object`

This is a dev-server hot reload issue, not a backend data problem.

### Fix behavior

A clean restart of the dev server and hard browser refresh is usually the right first response.

---

## 13) What the user wants now

The user wants:
- logs that visibly work in the UI
- real-time or near-real-time updates
- no dropdown-heavy filter UX
- full log details in a modal
- memory/Qdrant/chat/tool/system events in the same stream
- a clean handoff file for ChatGPT
- no generic guessing — actual end-to-end behavior

---

## 14) If you need to debug from here

Best checks:
1. confirm `/api/agent/logs` returns rows
2. confirm `LogsExplorer` receives those rows
3. confirm the browser is not serving stale HMR state
4. confirm filters aren’t hiding everything
5. wire remaining emitters for chat/memory/Qdrant/tool events

---

## 15) Tiny cheatsheet

### Main data flow

Request → page loader → runtime snapshots + DB rows → UI render

### Log write flow

Producer → `/api/agent/logs` POST → `agent_logs`

### Log read flow

`/api/agent/logs` GET → rows → `LogsExplorer`

### Runtime flow

OpenClaw sessions → runtime collector → agent snapshot + runtime.snapshot log

### Sync flow

Gateway/session JSON → gateway-sync → agents + logs rows

---

End of flow doc.
