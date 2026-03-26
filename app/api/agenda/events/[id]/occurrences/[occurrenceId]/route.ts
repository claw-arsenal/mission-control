import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { Queue } from "bullmq";

type Json = Record<string, unknown>;

const ok = (data: Json = {}): NextResponse => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>): Promise<string | null> {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id: eventId, occurrenceId } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [occurrence] = await sql`
      select ao.*, ae.workspace_id, ae.title, ae.free_prompt, ae.default_agent_id,
             ae.timezone, ae.execution_window_minutes, ae.fallback_model
      from agenda_occurrences ao
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
      limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    // Allow retry from needs_retry, expired, failed, or running (force retry)
    const retryableStatuses = ["needs_retry", "expired", "failed", "running"];
    if (!retryableStatuses.includes(occurrence.status)) {
      return fail(`Cannot retry occurrence with status "${occurrence.status}"`, 400);
    }

    // If force-retrying a running occurrence, mark current attempt as failed
    if (occurrence.status === "running") {
      await sql`
        update agenda_run_attempts
        set status = 'failed', finished_at = now(), error_message = 'Force retried by user'
        where occurrence_id = ${occurrenceId} and status = 'running'
      `;
    }

    // Get the actual max attempt number so the next run gets the right number
    const [maxAttempt] = await sql`
      select coalesce(max(attempt_no), 0) as max_no
      from agenda_run_attempts
      where occurrence_id = ${occurrenceId}
    `;

    // Reset status to scheduled, preserve the correct attempt count
    await sql`
      update agenda_occurrences
      set status = 'scheduled', locked_at = null, latest_attempt_no = ${maxAttempt.max_no}
      where id = ${occurrenceId}
    `;

    // Get attached processes
    const processes = await sql`
      select aep.process_version_id, aep.sort_order
      from agenda_event_processes aep
      where aep.agenda_event_id = ${eventId}
      order by aep.sort_order asc
    `;

    // Enqueue directly to BullMQ for immediate execution
    try {
      const agendaQueue = new Queue("agenda", {
        connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
      });

      await agendaQueue.add(
        "run-occurrence",
        {
          occurrenceId,
          eventId,
          title: occurrence.title,
          freePrompt: occurrence.free_prompt,
          agentId: occurrence.default_agent_id,
          timezone: occurrence.timezone,
          processes: processes.map((p: Record<string, unknown>) => ({
            process_version_id: p.process_version_id,
            sort_order: p.sort_order,
          })),
          scheduledFor: occurrence.scheduled_for,
          executionWindowMinutes: 999, // Don't expire on manual retry
          fallbackModel: occurrence.fallback_model || "",
        },
        {
          jobId: `agenda-retry-${occurrenceId}-${Date.now()}`,
          removeOnComplete: false,
        }
      );

      await agendaQueue.close();
    } catch (err) {
      // If BullMQ enqueue fails, the scheduler will pick it up next cycle
      console.warn("[occurrence-retry] BullMQ enqueue failed:", err);
    }

    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "retry" })})`;
    return ok({ occurrenceId, status: "scheduled" });
  } catch {
    return fail("Failed to retry occurrence", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { occurrenceId } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [occurrence] = await sql`
      select ao.id from agenda_occurrences ao
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
      limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    // Mark as cancelled (dismiss from failed list)
    await sql`
      update agenda_occurrences set status = 'cancelled' where id = ${occurrenceId}
    `;

    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "dismiss" })})`;
    return ok({ occurrenceId, status: "cancelled" });
  } catch {
    return fail("Failed to dismiss occurrence", 500);
  }
}
