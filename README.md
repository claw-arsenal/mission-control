# OpenClaw Mission Control

Local-first dashboard for OpenClaw — boards, agent scheduling, real-time logs, and execution management.

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/claw-arsenal/mission-control/main/install.sh | bash

# Development
npm run dev          # Start everything (DB + Redis + services + Next.js dev)
npm run dev:stop     # Stop everything

# Production
npm run build && mc-services start
```

Open http://localhost:3000

## Requirements

- Node.js 24+, Docker + Compose v2
- OpenClaw installed with gateway running
- Redis (for BullMQ job queues)

## Pages

| Page | What it does |
|---|---|
| `/dashboard` | Stats overview — tickets, events, logs, agents |
| `/boards` | Kanban boards with Trello-style tickets, drag-and-drop, live activity feed |
| `/agenda` | Calendar scheduler — one-time or recurring agent tasks with artifact downloads |
| `/processes` | Reusable step-by-step execution blueprints (card grid with versioning) |
| `/agents` | Agent status cards — model, heartbeat, queue depth |
| `/logs` | Live log explorer with SSE streaming and filters |
| `/approvals` | Pending plan approval queue |
| `/settings` | Theme switcher, system updates, clean reset, uninstall |

## Architecture

```
Browser (SSE) → Next.js (port 3000) → PostgreSQL (Docker)
                    ↕                       ↕
              API Routes ←→ pg_notify ←→ Workers (host)
                                            ↕
                                     OpenClaw Gateway
```

**Services** (managed by `mc-services.sh`):

| Service | Purpose |
|---|---|
| Next.js | UI + API + SSE streams |
| PostgreSQL | All persistent data (Docker) |
| Redis | BullMQ job queue (Docker) |
| task-worker | Ticket execution via BullMQ — picks up queued tickets, runs agents |
| bridge-logger | Ingests agent log files → DB |
| gateway-sync | One-shot agent/session import on startup |
| agenda-scheduler | Expands RRULE occurrences, enqueues due jobs |
| agenda-worker | Executes scheduled agenda jobs, captures file artifacts |

## Key Features

### Boards (Trello-style)
- Kanban / List / Grid views with drag-and-drop
- Two-column ticket modal: main content (title, description, checklist, attachments, comments) + sidebar (agent, processes, priority, due date, labels, execution controls)
- Assign OpenClaw agents to tickets for automated execution
- Attach reusable processes (step-by-step blueprints)
- Live activity feed with animated entries, relative timestamps, color-coded levels
- Execution: Direct (immediate) or Planned (generates plan → approve/reject → execute)
- Retry with backoff (30s/120s/480s, up to 3 attempts)

### Agenda (Calendar Scheduler)
- Month / Week / Day views with event pills and drag-to-reschedule
- Multi-step event creation wizard: Type → Details → Schedule → Review
- One-time tasks (date + time) or Repeatable (daily/weekly with start/end modes)
- Free prompt and/or attached processes per event
- Agent + model override per event
- **Recurring edit scope**: editing a recurring event asks "Only this occurrence" or "This and all upcoming"
- **Artifact capture**: agent-generated files (images, PDFs) saved to disk and downloadable from the event details
- **Cumulative step context**: each process step gets previous step outputs as context
- Stale lock recovery (occurrences stuck >15min auto-reset)

### Processes
- Card grid layout with create, edit, duplicate, delete
- Multi-step editor wizard: Info → Steps → Review
- Per-step: instruction, skill, agent, model override (33% each)
- Version tracking with labels
- Skills dropdown reads from workspace skills directory

### Settings
- Theme: Light / Dark / System (persisted to localStorage)
- System Updates: check for git updates, one-click update (pull + build + restart)
- Danger Zone: Clean Reset (type "RESET") and Uninstall (type "UNINSTALL") with confirmation

## Ticket Lifecycle

```
open → [start] → queued → executing → done
open → [planned] → planning → awaiting_approval → [approve] → queued → executing → done
                                                 → [reject] → draft
failed → [retry] → queued (up to 3x with backoff)
```

No agent assigned = manual ticket (never queued).

## Scripts

| Script | Use |
|---|---|
| `npm run dev` | Full dev environment (Docker + services + Next.js) |
| `mc-services start/stop/status` | Manage host daemons |
| `scripts/install.sh` | Bootstrap install |
| `scripts/clean.sh` | Wipe DB and start fresh |
| `scripts/uninstall.sh` | Stop everything and remove |
| `scripts/dev.sh` | Dev mode with Ctrl+C cleanup |

## Environment

Copy `.env.example` → `.env`. Key vars:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | DB password |
| `OPENCLAW_GATEWAY_URL` | Gateway WebSocket URL |
| `REDIS_HOST` | Redis host (default: 127.0.0.1) |

## Database

Schema: `db/schema.sql`. Reset: `npm run db:reset`.

## API Routes

| Route | Purpose |
|---|---|
| `/api/tasks` | Board/ticket CRUD + execution actions |
| `/api/agenda/events` | Agenda event CRUD |
| `/api/agenda/artifacts/[stepId]/[filename]` | Download agent-generated files |
| `/api/processes` | Process CRUD |
| `/api/agents` | Agent discovery |
| `/api/skills` | Workspace skills list |
| `/api/system` | System management (update, reset, uninstall) |
| `/api/events` | SSE stream (ticket activity + worker ticks) |
| `/api/agent/logs/stream` | SSE stream (agent logs) |

## Troubleshooting

| Issue | Fix |
|---|---|
| DB connection refused | `docker compose up -d db` |
| Password auth failed | Sync `POSTGRES_PASSWORD` in `.env` and `DATABASE_URL` |
| Agents not showing | Ensure gateway is running; agents discovered via `/api/agents` |
| Worker can't reach gateway | Set `gateway.bind: "lan"` in `openclaw.json` |
| Delete event not working | Ensure event details sheet opens; delete button is red "Delete" in header |

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
