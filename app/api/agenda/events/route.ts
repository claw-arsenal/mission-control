import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { RRule } from "rrule";

type Json = Record<string, unknown>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

// Timezone-aware helpers for DST-safe RRULE expansion
function extractLocalTime(utcDate: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(utcDate);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function localTimeToUTC(localDateStr: string, localTimeStr: string, timezone: string) {
  // Try multiple UTC offsets to find the one that renders correctly in the target timezone
  // This handles DST gaps (e.g. 02:08 CET doesn't exist on spring-forward day → use 02:08 CEST = 00:08 UTC)
  const targetLocal = `${localDateStr}T${localTimeStr}`;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const get = (parts: Intl.DateTimeFormatPart[]) => {
    const g = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  };

  // Try offsets from -12h to +14h in 1h steps to find a match
  const base = new Date(`${localDateStr}T${localTimeStr}:00Z`);
  for (let offsetH = -12; offsetH <= 14; offsetH++) {
    const candidate = new Date(base.getTime() - offsetH * 3600000);
    const rendered = get(fmt.formatToParts(candidate));
    if (rendered === targetLocal) return candidate;
  }
  // Fallback: if DST gap makes the time impossible, shift forward 1 hour (spring-forward)
  const fallback = new Date(base.getTime() - 3600000);
  return fallback;
}

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const wid = await workspaceId(sql);
    if (!wid) return ok({ events: [] });

    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    let events;
    if (start && end) {
      events = await sql`
        select
          ae.*,
          coalesce(
            (select json_agg(json_build_object(
              'id', aep.id,
              'process_version_id', aep.process_version_id,
              'sort_order', aep.sort_order,
              'process_name', p.name,
              'version_number', pv.version_number
            ) order by aep.sort_order)
            from agenda_event_processes aep
            join process_versions pv on pv.id = aep.process_version_id
            join processes p on p.id = pv.process_id
            where aep.agenda_event_id = ae.id),
            '[]'
          ) as processes
        from agenda_events ae
        where ae.workspace_id = ${wid}
          and (
            (${start}::timestamptz is not null and ae.starts_at <= ${end}::timestamptz)
            and (${end}::timestamptz is not null and (ae.ends_at is null or ae.ends_at >= ${start}::timestamptz))
          )
        order by ae.starts_at asc
      `;
    } else {
      events = await sql`
        select
          ae.*,
          coalesce(
            (select json_agg(json_build_object(
              'id', aep.id,
              'process_version_id', aep.process_version_id,
              'sort_order', aep.sort_order,
              'process_name', p.name,
              'version_number', pv.version_number
            ) order by aep.sort_order)
            from agenda_event_processes aep
            join process_versions pv on pv.id = aep.process_version_id
            join processes p on p.id = pv.process_id
            where aep.agenda_event_id = ae.id),
            '[]'
          ) as processes
        from agenda_events ae
        where ae.workspace_id = ${wid}
        order by ae.starts_at asc
      `;
    }

    // Expand recurring events using RRULE
    if (start && end) {
      const rangeStart = new Date(start);
      const rangeEnd = new Date(end);
      // Set rangeEnd to end of day so the last day is included
      rangeEnd.setHours(23, 59, 59, 999);

      // Add ±1 day buffer for RRULE expansion to handle timezone edge cases
      // (e.g. event at 23:04 UTC shows as next day in CET)
      const rruleStart = new Date(rangeStart.getTime() - 86_400_000);
      const rruleEnd = new Date(rangeEnd.getTime() + 86_400_000);

      const expanded: Array<Record<string, unknown>> = [];
      const recurringEventIds: string[] = [];

      for (const event of events) {
        if (!event.recurrence_rule || event.recurrence_rule === "null" || event.recurrence_rule === "none") {
          expanded.push(event);
          continue;
        }

        recurringEventIds.push(event.id);

        try {
          const eventStart = new Date(event.starts_at);
          const eventDuration = event.ends_at
            ? new Date(event.ends_at).getTime() - eventStart.getTime()
            : 0;

          const rruleOptions = RRule.parseString(event.recurrence_rule);
          rruleOptions.dtstart = eventStart;
          if (event.recurrence_until) {
            rruleOptions.until = new Date(event.recurrence_until);
          }
          const rule = new RRule(rruleOptions);

          // Use buffered range for RRULE — then re-anchor each to original local time
          // so DST changes don't shift the event (02:08 CET stays 02:08 CEST)
          const rawOccurrences = rule.between(rruleStart, rruleEnd, true);
          const tz = event.timezone || "UTC";
          const { time: localTime } = extractLocalTime(eventStart, tz);

          for (const rawOcc of rawOccurrences) {
            const { date: occLocalDate } = extractLocalTime(rawOcc, tz);
            const correctedOcc = localTimeToUTC(occLocalDate, localTime, tz);
            const endsAt = eventDuration
              ? new Date(correctedOcc.getTime() + eventDuration).toISOString()
              : event.ends_at;
            const { date: correctedDate } = extractLocalTime(correctedOcc, tz);
            expanded.push({
              ...event,
              starts_at: correctedOcc.toISOString(),
              ends_at: endsAt,
              _occurrenceDate: correctedDate,
            });
          }
        } catch {
          // If RRULE parsing fails, return event as-is
          expanded.push(event);
        }
      }

      // Attach per-occurrence status for recurring events
      // (each expanded day should show its own occurrence status, not the global latest)
      const expandedIds = expanded.map((e) => (e as Record<string, unknown>).id).filter(Boolean);
      if (expandedIds.length > 0) {
        if (recurringEventIds.length > 0) {
          // For recurring: fetch ALL occurrences with run timing and match by scheduled_for date
          const allOccRows = await sql`
            select ao.agenda_event_id, ao.scheduled_for, ao.status,
                   ra.started_at as run_started_at, ra.finished_at as run_finished_at
            from agenda_occurrences ao
            left join agenda_run_attempts ra
              on ra.occurrence_id = ao.id and ra.attempt_no = ao.latest_attempt_no
            where ao.agenda_event_id = ANY(${recurringEventIds})
          `;
          // Build maps: eventId+date → status, eventId+date → timing
          const occDateMap = new Map<string, string>();
          const occTimingMap = new Map<string, { run_started_at: string | null; run_finished_at: string | null }>();
          for (const r of allOccRows) {
            const dateKey = new Date(r.scheduled_for).toISOString().split("T")[0];
            const key = `${r.agenda_event_id}:${dateKey}`;
            occDateMap.set(key, r.status);
            occTimingMap.set(key, { run_started_at: r.run_started_at, run_finished_at: r.run_finished_at });
          }
          for (const e of expanded) {
            const eid = (e as Record<string, unknown>).id as string;
            if (recurringEventIds.includes(eid)) {
              const occDate = ((e as Record<string, unknown>)._occurrenceDate as string) ??
                new Date((e as Record<string, unknown>).starts_at as string).toISOString().split("T")[0];
              const key = `${eid}:${occDate}`;
              (e as Record<string, unknown>).latest_occurrence_status = occDateMap.get(key) ?? null;
              const timing = occTimingMap.get(key);
              if (timing) {
                (e as Record<string, unknown>).run_started_at = timing.run_started_at;
                (e as Record<string, unknown>).run_finished_at = timing.run_finished_at;
              }
            }
          }
        }

        // For non-recurring: use latest occurrence status + timing
        const nonRecurringIds = expandedIds.filter((id) => !recurringEventIds.includes(id as string));
        if (nonRecurringIds.length > 0) {
          const occRows = await sql`
            select distinct on (ao.agenda_event_id)
              ao.agenda_event_id, ao.status as latest_occurrence_status,
              ra.started_at as run_started_at, ra.finished_at as run_finished_at
            from agenda_occurrences ao
            left join agenda_run_attempts ra
              on ra.occurrence_id = ao.id and ra.attempt_no = ao.latest_attempt_no
            where ao.agenda_event_id = ANY(${nonRecurringIds as string[]})
            order by ao.agenda_event_id, ao.scheduled_for desc
          `;
          const statusMap = new Map<string, { status: string; run_started_at: string | null; run_finished_at: string | null }>();
          for (const r of occRows) statusMap.set(r.agenda_event_id, {
            status: r.latest_occurrence_status,
            run_started_at: r.run_started_at,
            run_finished_at: r.run_finished_at,
          });
          for (const e of expanded) {
            const eid = (e as Record<string, unknown>).id as string;
            if (!recurringEventIds.includes(eid)) {
              const info = statusMap.get(eid);
              (e as Record<string, unknown>).latest_occurrence_status = info?.status ?? null;
              if (info) {
                (e as Record<string, unknown>).run_started_at = info.run_started_at;
                (e as Record<string, unknown>).run_finished_at = info.run_finished_at;
              }
            }
          }
        }
      }
      return ok({ events: expanded });
    }

    // Attach latest occurrence status for non-range queries too
    const eventIds = events.map((e: Record<string, unknown>) => e.id).filter(Boolean);
    if (eventIds.length > 0) {
      const occRows = await sql`
        select distinct on (agenda_event_id)
          agenda_event_id, status as latest_occurrence_status
        from agenda_occurrences
        where agenda_event_id = ANY(${eventIds as string[]})
        order by agenda_event_id, scheduled_for desc
      `;
      const statusMap = new Map<string, string>();
      for (const r of occRows) statusMap.set(r.agenda_event_id, r.latest_occurrence_status);
      for (const e of events) {
        (e as Record<string, unknown>).latest_occurrence_status = statusMap.get((e as Record<string, unknown>).id as string) ?? null;
      }
    }

    return ok({ events });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load agenda events", 500);
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const body = (await request.json()) as Json;
    const action = String(body.action || "");

    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    if (action === "createEvent") {
      const title = String(body.title || "").trim();
      const freePrompt = body.freePrompt ? String(body.freePrompt) : null;
      const agentId = body.agentId && body.agentId !== 'null' ? String(body.agentId) : null;
      const timezone = String(body.timezone || "Europe/Amsterdam");
      const startsAt = body.startsAt ? new Date(String(body.startsAt)) : null;
      const endsAt = body.endsAt ? new Date(String(body.endsAt)) : null;
      const recurrenceRule = body.recurrenceRule && body.recurrenceRule !== "null" && body.recurrenceRule !== "none" ? String(body.recurrenceRule) : null;
      const recurrenceUntil = body.recurrenceUntil ? new Date(String(body.recurrenceUntil)) : null;
      const status = String(body.status || "draft");
      const modelOverride = body.modelOverride ? String(body.modelOverride) : "";
      const executionWindowMinutes = Number(body.executionWindowMinutes) || 30;
      const fallbackModel = body.fallbackModel ? String(body.fallbackModel) : "";
      const processVersionIds: string[] = Array.isArray(body.processVersionIds)
        ? body.processVersionIds.map(String)
        : [];

      if (!title) return fail("Title is required.");
      if (!startsAt || isNaN(startsAt.getTime())) return fail("Valid start date is required.");

      const [event] = await sql`
        insert into agenda_events (
          workspace_id, title, free_prompt, default_agent_id,
          timezone, starts_at, ends_at, recurrence_rule, recurrence_until, status,
          model_override, execution_window_minutes, fallback_model, created_by
        ) values (
          ${wid}, ${title}, ${freePrompt}, ${agentId},
          ${timezone}, ${startsAt}, ${endsAt}, ${recurrenceRule}, ${recurrenceUntil}, ${status},
          ${modelOverride}, ${executionWindowMinutes}, ${fallbackModel},
          ${body.createdBy ? String(body.createdBy) : null}
        )
        returning *
      `;

      // Attach processes
      for (let i = 0; i < processVersionIds.length; i++) {
        await sql`
          insert into agenda_event_processes (agenda_event_id, process_version_id, sort_order)
          values (${event.id}, ${processVersionIds[i]}, ${i})
        `;
      }

      // Notify SSE clients
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "create", eventId: event.id })})`;

      return ok({ event });
    }

    return fail(`Unsupported action: ${action}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Agenda event operation failed", 500);
  }
}
