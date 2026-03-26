# OpenClaw Mission Control v1.4.0

Local-first dashboard for OpenClaw — boards, agent scheduling, real-time logs, and execution management.

## Quick Start

```bash
# 1. Install (clone + DB + build)
bash scripts/install.sh

# 2. Development
npm run dev            # Start DB + all services + Next.js dev server
npm run dev:stop       # Stop DB + services (graceful)
npm run dev:kill       # Force-kill everything (zombie processes, stuck ports)

# 3. Production
npm run build
bash scripts/mc-services.sh start    # Starts all services including Next.js
```

Open **http://localhost:3000**

## Requirements

| Dependency | Version |
|---|---|
| Node.js | 24+ |
| Docker + Compose v2 | For PostgreSQL |
| Redis | For BullMQ job queues (runs on host or Docker) |
| OpenClaw | Installed with gateway running |

## npm Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts Docker DB + all host services + `next dev` |
| `npm run dev:stop` | Graceful stop of Docker DB + host services |
| `npm run dev:kill` | **Force-kill** all MC processes, free port 3000 |
| `npm run dev:db` | Start only Docker DB containers |
| `npm run dev:services` | Start only host services (no Next.js dev) |
| `npm run build` | Production Next.js build |
| `npm start` | Start Next.js production server only |
| `npm run db:setup` | Run DB migrations + seed |
| `npm run db:reset` | Wipe and recreate DB schema |
| `npm run db:migrate` | Run pending migrations |
| `npm run worker:tasks` | Run task-worker standalone |
| `npm run bridge:logger` | Run bridge-logger standalone |

## Pages

| Page | What it does |
|---|---|
| `/dashboard` | Stats overview — boards, tickets, events, processes, logs |
| `/boards` | Kanban boards with drag-and-drop, live activity feed, ticket modals |
| `/agenda` | Calendar scheduler — one-time or recurring agent tasks |
| `/processes` | Reusable step-by-step execution blueprints |
| `/agents` | Agent status cards with model, heartbeat, detail pages |
| `/logs` | Live log explorer, job queues, and service management |
| `/approvals` | Pending plan approval queue |
| `/settings` | Theme, system updates, clean reset, uninstall |

## Architecture

```
Browser (SSE) ──→ Next.js (port 3000) ──→ PostgreSQL (Docker, port 5432)
                       ↕                        ↕
                  API Routes ←──→ pg_notify ←──→ Workers (host)
                                                    ↕
                                             OpenClaw Gateway (ws://127.0.0.1:18789)
                                                    ↕
                                             Agent Sessions (~/.openclaw/agents/)
```

### Host Services

All services run natively on the host, managed by `scripts/mc-services.sh`. Docker only runs PostgreSQL.

| Service | Script | Purpose |
|---|---|---|
| **task-worker** | `task-worker.mjs` | BullMQ worker — picks up queued tickets, runs agents, auto-attaches output files |
| **bridge-logger** | `bridge-logger.mjs` | Watches OpenClaw gateway websocket, ingests agent logs → DB, auto-discovers agents |
| **gateway-sync** | `gateway-sync.mjs` | One-shot: imports agents + sessions from gateway on startup, then exits |
| **agenda-scheduler** | `agenda-scheduler.mjs` | Expands RRULE occurrences, enqueues due agenda jobs |
| **agenda-worker** | `agenda-worker.mjs` | Executes scheduled agenda jobs, captures file artifacts to `/storage/mission-control/artifacts/` |
| **nextjs** | `npm start` | Production Next.js server (skipped with `--dev` flag) |

```bash
bash scripts/mc-services.sh status               # Check what's running
bash scripts/mc-services.sh start                # Start all services
bash scripts/mc-services.sh stop                 # Stop all services
bash scripts/mc-services.sh restart              # Restart all
bash scripts/mc-services.sh restart agenda-worker # Restart single service
bash scripts/mc-services.sh start task-worker    # Start single service
bash scripts/mc-services.sh stop nextjs          # Stop single service
```

### Agent Discovery

Agents appear in Mission Control through two paths:
1. **gateway-sync** — imports all agents from the OpenClaw gateway on startup
2. **bridge-logger** — creates agents on-the-fly when it sees new log entries from unknown agents

Agent data (name, model, emoji, status) is read from each agent's `IDENTITY.md` file in `~/.openclaw/agents/<id>/`.

### Telegram Notifications

The task-worker and agenda-worker send Telegram notifications for lifecycle events (start, completion, failure, retry, long-running alerts). Chat ID is discovered from OpenClaw's session files — no manual config needed.

## Key Features

### Boards (Trello-style)
- Kanban / List / Grid views with drag-and-drop
- Two-column ticket modal: main content (title, description, checklist, attachments, comments, activity) + sidebar (agent, processes, priority, due date, labels, execution controls)
- Assign OpenClaw agents for automated execution
- Attach reusable processes (step-by-step blueprints)
- Live activity feed with color-coded entries and relative timestamps
- Agent output rendered as markdown in the Activity section
- **File auto-attach**: agent-created files referenced in responses are auto-detected and attached as downloadable files
- Execution modes: Direct (immediate) or Planned (plan → approve/reject → execute)
- Retry with backoff (30s / 120s / 480s, up to 3 attempts)
- **Execution windows**: configurable per-ticket window (default 60 min) — tickets that miss the window are marked `expired`
- **Fallback models**: if primary model hits rate limits (429/quota), worker auto-retries with configured fallback model
- **Postgres claim locks**: prevents duplicate ticket execution across workers
- **Ticket locking**: cannot edit a ticket while it's executing
- **Failed tickets bucket**: collapsible UI section showing failed/needs_retry/expired tickets with retry buttons
- **Telegram notifications**: automatic alerts for needs_retry, failed, and expired tickets
- **Confirmation dialogs**: delete and copy board actions require explicit confirmation
- New statuses: `needs_retry` (manual intervention required after max retries), `expired` (missed execution window)

### Agenda (Calendar Scheduler)
- Month / Week / Day views with event pills
- **Real-time updates via SSE**: PostgreSQL LISTEN/NOTIFY → Server-Sent Events (no polling)
- **Timezone-aware rendering**: events display on the correct day in the user's timezone (CET/CEST, not GMT+1)
- **Date-range-per-view**: month/week/day views each fetch their exact visible range (with ±1 day buffer for timezone edge cases)
- Multi-step creation wizard: Type → Details → Schedule → Review
- One-time (date + time) or Repeatable (daily/weekly with RRULE)
- Free prompt and/or attached processes per event
- Agent + model override per event
- **Copy/duplicate events**: opens the create modal pre-filled with the original event's data
- **Per-occurrence data isolation**: clicking a recurring event on a specific date shows only that date's schedule, runs, and output — never cross-pollinated from other dates
- **Per-occurrence status**: each day of a recurring event shows its own run status (succeeded/running/failed), not the global latest
- **Run duration display**: calendar pills show how long each run took (e.g., "✓ Done · 2m 15s") or how long it's been running
- **Duration card in overview**: shows total run time with start/finish timestamps and in-progress indicator
- **Output tab**: view agent responses with markdown rendering per run step, with step metadata (process, skill, agent, description, time)
- **Runs → Output navigation**: clicking a run card auto-switches to the Output tab with a "View output →" hover hint
- **Artifact capture**: agent-generated files saved to disk and downloadable from event details
- **Cumulative step context**: each process step receives previous step outputs
- Recurring edit scope: "Only this occurrence" or "This and all upcoming"
- **Three-option delete for recurring events**: "Only this occurrence" / "This and all future" / "Stop entire series"
- **3-dot action menu**: Edit, Duplicate, Force Retry, Delete in a single dropdown (with disabled states and tooltips)
- **Color-coded status badges**: green (active/succeeded), amber (running), red (failed/needs_retry), blue (scheduled/recurring), with Radix tooltips explaining each status
- Stale lock recovery (occurrences stuck >15min auto-reset)
- **Now indicator**: current time line in week/day views (behind events, not overlapping)

### Resilient Job Orchestration (v1.4.0)
- **Execution windows**: each event has a configurable window (default 30 minutes) — jobs that miss the window are marked `expired` with Telegram notification
- **Auto-retry**: first failure auto-retries immediately; second failure sets `needs_retry` for manual intervention
- **Fallback models**: if the primary model hits a rate limit (429/quota), the worker automatically retries with the configured fallback model
- **Postgres-level claim locks**: prevents duplicate execution — only one worker can claim an occurrence
- **Force retry**: can force-retry a stuck/running occurrence — marks the current attempt as failed and re-queues with correct attempt numbering
- **Long-running alert**: if an agenda event runs for more than 5 minutes, sends a Telegram notification with event details and link to Mission Control
- **Event locking**: cannot edit an event while any of its occurrences are running (tooltip explains why)
- **Failed bucket**: dedicated UI card showing failed/needs_retry/expired occurrences with retry buttons
- **Telegram notifications**: automatic alerts for needs_retry, failed, expired, and long-running events
- **Correct attempt numbering**: retries always get the next sequential attempt number, even after force retries
- New statuses: `needs_retry` (manual intervention required), `expired` (missed execution window)

### Service Health Monitoring
- All workers report heartbeats to the `service_health` table every 30 seconds
- **Services tab** in the Logs page with per-service status cards, PID monitoring, start/stop/restart controls, and log viewer
- **Per-service management**: `mc-services start agenda-worker`, `mc-services restart task-worker`, etc.
- Notification provider polls for service status changes
- API endpoint (`/api/services`) for service management and log access

### Processes
- Card grid layout with create, edit, duplicate, delete
- Multi-step editor wizard: Info → Steps → Review
- Per-step: instruction, skill, agent, model override
- Version tracking with labels
- Clicking a process card opens edit with existing data pre-filled

### Agents
- Status cards with gradient accents, emoji avatars, pulse indicators
- Stat cards: Total agents, Running, Responses (1h), Memory ops (1h)
- Agent detail pages with full log history (`/agents/[agentId]`)

### Settings
- Theme: Light / Dark / System
- System Updates: check for git updates, one-click update
- Danger Zone: Clean Reset (type "RESET") and Uninstall (type "UNINSTALL")

## Ticket Lifecycle

```
open → [start] → queued → executing → done
open → [planned] → planning → awaiting_approval → [approve] → queued → executing → done
                                                 → [reject] → draft
failed → [auto-retry up to 3x with backoff] → needs_retry → [manual retry] → queued → executing → done
expired (missed execution window) → [manual retry] → queued → executing → done
```

No agent assigned = manual ticket (never auto-queued).

## Agenda Event Lifecycle

```
draft → [activate] → active
active → [scheduler] → occurrence created (scheduled)
scheduled → [worker claims] → running → succeeded
                                      → failed → [auto-retry] → running → succeeded
                                                               → needs_retry → [manual retry] → scheduled → ...
                                      → [>5 min] → Telegram alert sent
running → [force retry] → current attempt marked failed → scheduled → running → ...
scheduled → [missed window] → expired → [manual retry] → scheduled → ...
```

Recurring events: each date gets its own independent occurrence and run history.

### Edge Cases & Failsafes

| Scenario | Behavior |
|---|---|
| Worker restarts during execution | Occurrence stays "running" — use Force Retry to recover |
| Event runs >5 minutes | Telegram alert sent to main session with event details |
| Duplicate attempt numbers after force retry | Fixed: retry reads max(attempt_no) from DB before creating new attempt |
| Click recurring event on future date (no occurrence yet) | Shows correct date in schedule, empty runs/output (no cross-pollination) |
| Recurring event at 23:04 UTC in CET timezone | RRULE expanded with ±1 day buffer; client renders on correct CET day |
| All retries exhausted | Status set to `needs_retry`, Telegram notification sent, retry button shown |
| Edit while running | Edit button disabled with tooltip explaining why |
| Delete recurring event | Three options: this occurrence / this + future / entire series |
| SSE connection drops | Auto-reconnect after 5 seconds with exponential backoff |

## File Serving

Agent-created files are served via `/api/files?path=<absolute-path>`. Allowed directories:
- `/home/clawdbot/.openclaw/workspace`
- `/home/clawdbot/.openclaw`
- `/storage`
- `/tmp`

Agenda artifacts are served via `/api/agenda/artifacts/[stepId]/[filename]`.

## Environment

Key env vars in `.env`:

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `POSTGRES_PASSWORD` | DB password (used by Docker) | Required |
| `REDIS_HOST` | Redis host | `127.0.0.1` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | none |

OpenClaw config is auto-discovered from `~/.openclaw/openclaw.json`. No OpenClaw-specific env vars needed.

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/tasks` | POST | Board/ticket CRUD, execution, attachments, activity |
| `/api/files` | GET | Serve local files by path (for ticket attachments) |
| `/api/agenda/events` | GET/POST | Agenda event CRUD |
| `/api/agenda/events/stream` | GET | SSE stream for real-time agenda updates (via pg_notify) |
| `/api/agenda/events/[id]` | GET/PATCH/DELETE | Single event operations |
| `/api/agenda/events/[id]/occurrences/[occId]` | POST/DELETE | Retry or dismiss an occurrence |
| `/api/agenda/events/[id]/occurrences/[occId]/runs` | GET | Run attempts + steps for an occurrence |
| `/api/agenda/artifacts/[stepId]/[filename]` | GET | Download agent-generated artifacts |
| `/api/agenda/failed` | GET | Failed/needs_retry/expired occurrences |
| `/api/agenda/stats` | GET | Agenda statistics |
| `/api/processes` | GET/POST | Process CRUD |
| `/api/processes/[id]` | GET/PATCH/DELETE | Single process operations |
| `/api/services` | GET/POST | Service health monitoring and management |
| `/api/agents` | GET | Agent discovery (reads from DB + runtime) |
| `/api/skills` | GET | Workspace skills list |
| `/api/system` | POST | System management (update, reset, uninstall) |
| `/api/events` | GET | SSE stream (ticket activity, worker ticks) |
| `/api/agent/logs/stream` | GET | SSE stream (agent logs) |

## Scripts Reference

| Script | Purpose |
|---|---|
| `scripts/mc-services.sh` | Service supervisor — start/stop/restart/status for all host daemons |
| `scripts/install.sh` | Full install: clone, .env setup, Docker DB, npm install, build |
| `scripts/clean.sh` | Wipe DB + Docker volumes, rebuild from scratch |
| `scripts/uninstall.sh` | Stop everything, remove Docker volumes, remove project |
| `scripts/dev.sh` | Dev mode with Ctrl+C trap cleanup |
| `scripts/db-init.sh` | Run by Docker db-init container to apply schema |
| `scripts/db-setup.mjs` | DB migrations, seed, reset commands |
| `scripts/gateway-sync.mjs` | One-shot gateway import |
| `scripts/bridge-logger.mjs` | Persistent log ingestion daemon |
| `scripts/task-worker.mjs` | BullMQ ticket execution worker |
| `scripts/agenda-scheduler.mjs` | RRULE expansion + job enqueue |
| `scripts/agenda-worker.mjs` | Agenda job execution + artifact capture |

## Troubleshooting

| Issue | Fix |
|---|---|
| Port 3000 stuck after closing terminal | `npm run dev:kill` |
| DB connection refused | `docker compose up -d db` or `npm run dev:db` |
| Password auth failed | Check `POSTGRES_PASSWORD` in `.env` matches `DATABASE_URL` |
| Agents not showing | Ensure OpenClaw gateway is running; try hard refresh |
| Worker can't reach gateway | Set `gateway.bind: "lan"` in `openclaw.json` |
| Occurrence stuck as "running" | Use Force Retry button in event details (3-dot menu) |
| Events on wrong calendar day | Timezone edge case — fixed with ±1 day RRULE buffer (v1.4.0) |
| All recurring days show same status | Fixed in v1.4.0 — per-occurrence status matching |
| Duplicate attempt numbers | Fixed in v1.4.0 — retry reads max(attempt_no) from DB |
| Agenda output tab crashes | Fixed in v1.2.1 — `output_payload` jsonb handling |
| Ticket file attachments missing | Worker auto-attaches files from agent response (v1.2.1+) |
| Zombie processes after Ctrl+C | `npm run dev:kill` cleans up everything |
| Double scrollbar on agenda page | Fixed in v1.4.0 — controlled max-height on time grids |
| Tooltips not showing | Fixed in v1.4.0 — uses Radix Tooltip instead of native title attribute |

## Database

Schema managed by `scripts/db-init.sh` (Docker) and `scripts/db-setup.mjs` (Node).

Key tables: `workspaces`, `boards`, `columns`, `tickets`, `ticket_attachments`, `ticket_subtasks`, `ticket_comments`, `ticket_activity`, `agents`, `agent_logs`, `agenda_events`, `agenda_occurrences`, `agenda_run_attempts`, `agenda_run_steps`, `processes`, `process_versions`, `process_steps`, `worker_settings`, `service_health`.

Reset everything: `npm run db:reset` or `bash scripts/clean.sh`.

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
