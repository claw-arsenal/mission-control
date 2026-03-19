# Ticket Execution Flow (Canonical)

This is the canonical behavior for ticket pickup/execution in this dashboard.

## Standard board template order

Default columns for new boards are:

1. **To-Do**
2. **In progress**
3. **Completed**

Legacy names are still recognized for compatibility:
- `Planned` -> treated as **To-Do**
- `Doing` -> treated as **In progress**
- `Done` -> treated as **Completed**

## Pickup rules (strict)

A ticket is eligible for worker pickup only when all are true:

- ticket is in **In progress** (or legacy Doing)
- `execution_state` is `pending` or `queued`
- `assigned_agent_id` is set (non-empty runtime agent id, e.g. `main`)
- schedule gate passes (`scheduled_for` is now/past or null)

If `assigned_agent_id` is empty, the ticket is skipped.

## Auto-approve behavior

If a ticket is in **To-Do** and:
- `auto_approve = true`
- and schedule gate passes

then orchestrator automatically moves it to **In progress** and sets state to `queued`.

## State lifecycle

Typical successful path:

`pending -> queued -> picked_up -> running -> done -> (column move) Completed`

Failure/cancel paths:
- transient failure: `running -> queued` with retry backoff (`ticket.retry_scheduled`)
- max retries exhausted: `running -> failed`
- user/manual cancellation: `* -> cancelled`

## Moving tickets back to To-Do

If a queued/picked_up/running ticket leaves **In progress** (e.g. moved to To-Do), orchestrator:

- sets `execution_state = cancelled`
- records activity `ticket.cancelled`
- sends cancellation notification (if channel configured)
- actively interrupts running subprocess via `SIGTERM`

So moving out of In progress stops execution flow.

## Assignment semantics

- `assignee_ids` are human/DB assignees.
- `assigned_agent_id` is the runtime routing key used by orchestrator.

Retry actions now preserve/fallback assignment so tickets do not remain queued without a runtime target.

## Logging model

### `activity_logs`
Ticket-level timeline (visible in ticket activity tab):
- queued / picked_up / running / done / failed / retry_scheduled / cancelled / completed

### `agent_logs`
Agent-attributed operational events for the same execution lifecycle.

Both are intentionally written for observability.

## Notifications

Per-user notification channels are stored in `notification_channels`.
Telegram is implemented now; provider field is modular for future channels.

## Key files

- Orchestration: `scripts/task-orchestrator.js`
- Ticket UI details/retry controls: `components/tasks/modals/ticket-details-modal.tsx`, `hooks/use-tasks.ts`
- Board defaults: `hooks/use-tasks.ts`
- Queue summary stats: `lib/db/server-data.ts`
- Notifications API: `app/api/notifications/route.ts`
