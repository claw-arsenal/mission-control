import { getSql } from "@/lib/local-db";

/**
 * Operational numbers for the dashboard's stat strip and attention panel.
 *
 * Every block is queried independently and becomes `null` when its query
 * fails, so the UI can say "unavailable" instead of rendering a misleading 0.
 */

export type TicketPulse = {
  open: number;
  overdue: number;
  dueToday: number;
  completed7d: number;
  completedPrev7d: number;
  created7d: number;
  createdPrev7d: number;
};

export type AgendaPulse = {
  upcoming24h: number;
  active: number;
  failed7d: number;
};

export type ServicePulse = {
  total: number;
  running: number;
  error: number;
  stopped: number;
};

export type AttentionKind = "service" | "agenda" | "ticket";
export type AttentionSeverity = "danger" | "warning";

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  /** ISO timestamp the item relates to (due date, scheduled time, heartbeat). */
  at: string | null;
  href: string;
};

export type DashboardPulse = {
  tickets: TicketPulse | null;
  agenda: AgendaPulse | null;
  services: ServicePulse | null;
  attention: AttentionItem[];
  /** Server time (ms) when these numbers were read. */
  loadedAt: number;
};

async function safe<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.warn("[dashboard-pulse] block unavailable", error);
    return null;
  }
}

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function ticketPulse(wid: string): Promise<TicketPulse> {
  const sql = getSql();
  const rows = await sql<Record<string, number>[]>`
    select
      count(*) filter (where execution_state <> 'done')::int as open,
      count(*) filter (where execution_state <> 'done' and due_date < current_date)::int as overdue,
      count(*) filter (where execution_state <> 'done' and due_date = current_date)::int as due_today,
      count(*) filter (where execution_state = 'done' and updated_at >= now() - interval '7 days')::int as completed_7d,
      count(*) filter (where execution_state = 'done' and updated_at >= now() - interval '14 days' and updated_at < now() - interval '7 days')::int as completed_prev_7d,
      count(*) filter (where created_at >= now() - interval '7 days')::int as created_7d,
      count(*) filter (where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days')::int as created_prev_7d
    from tickets
    where workspace_id = ${wid}
  `;
  const r = rows[0] ?? {};
  return {
    open: n(r.open),
    overdue: n(r.overdue),
    dueToday: n(r.due_today),
    completed7d: n(r.completed_7d),
    completedPrev7d: n(r.completed_prev_7d),
    created7d: n(r.created_7d),
    createdPrev7d: n(r.created_prev_7d),
  };
}

async function agendaPulse(wid: string): Promise<AgendaPulse> {
  const sql = getSql();
  const rows = await sql<Record<string, number>[]>`
    select
      count(*) filter (where o.status = 'scheduled' and o.scheduled_for >= now() and o.scheduled_for < now() + interval '24 hours')::int as upcoming_24h,
      count(*) filter (where o.status in ('queued', 'running'))::int as active,
      count(*) filter (where o.status = 'failed' and o.scheduled_for >= now() - interval '7 days')::int as failed_7d
    from agenda_occurrences o
    join agenda_events e on e.id = o.agenda_event_id
    where e.workspace_id = ${wid}
  `;
  const r = rows[0] ?? {};
  return { upcoming24h: n(r.upcoming_24h), active: n(r.active), failed7d: n(r.failed_7d) };
}

async function servicePulse(): Promise<ServicePulse> {
  const sql = getSql();
  const rows = await sql<Record<string, number>[]>`
    select
      count(*)::int as total,
      count(*) filter (where status = 'running')::int as running,
      count(*) filter (where status = 'error')::int as error,
      count(*) filter (where status = 'stopped')::int as stopped
    from service_health
  `;
  const r = rows[0] ?? {};
  return { total: n(r.total), running: n(r.running), error: n(r.error), stopped: n(r.stopped) };
}

const ATTENTION_LIMIT = 6;

async function attentionItems(wid: string): Promise<AttentionItem[]> {
  const sql = getSql();
  const [services, agenda, tickets] = await Promise.all([
    safe(() => sql<{ name: string; status: string; last_error: string | null; updated_at: string }[]>`
      select name, status, last_error, updated_at::text as updated_at
      from service_health
      where status in ('error', 'stopped')
      order by (status = 'error') desc, updated_at desc
      limit 4
    `),
    safe(() => sql<{ id: string; title: string; scheduled_for: string; attempts: number }[]>`
      select o.id, e.title, o.scheduled_for::text as scheduled_for, o.latest_attempt_no as attempts
      from agenda_occurrences o
      join agenda_events e on e.id = o.agenda_event_id
      where e.workspace_id = ${wid}
        and o.status = 'failed'
        and o.scheduled_for >= now() - interval '7 days'
      order by o.scheduled_for desc
      limit 4
    `),
    safe(() => sql<{ id: string; title: string; due_date: string; board_id: string; board_name: string }[]>`
      select t.id, t.title, t.due_date::text as due_date, b.id as board_id, b.name as board_name
      from tickets t
      join boards b on b.id = t.board_id
      where t.workspace_id = ${wid}
        and t.execution_state <> 'done'
        and t.due_date < current_date
      order by t.due_date asc
      limit 4
    `),
  ]);

  const items: AttentionItem[] = [];
  for (const s of services ?? []) {
    items.push({
      id: `service:${s.name}`,
      kind: "service",
      severity: s.status === "error" ? "danger" : "warning",
      title: s.name,
      detail: s.status === "error" ? (s.last_error?.trim() || "Service reported an error") : "Service is stopped",
      at: s.updated_at,
      href: "/logs",
    });
  }
  for (const a of agenda ?? []) {
    items.push({
      id: `agenda:${a.id}`,
      kind: "agenda",
      severity: "danger",
      title: a.title,
      detail: a.attempts > 1 ? `Failed after ${a.attempts} attempts` : "Run failed",
      at: a.scheduled_for,
      href: "/agenda",
    });
  }
  for (const t of tickets ?? []) {
    items.push({
      id: `ticket:${t.id}`,
      kind: "ticket",
      severity: "warning",
      title: t.title,
      detail: `Overdue · ${t.board_name}`,
      at: t.due_date,
      href: `/boards?board=${t.board_id}&ticket=${t.id}`,
    });
  }
  return items.slice(0, ATTENTION_LIMIT);
}

export async function getDashboardPulse(): Promise<DashboardPulse> {
  const empty: DashboardPulse = { tickets: null, agenda: null, services: null, attention: [], loadedAt: Date.now() };
  const wid = await safe(async () => {
    const sql = getSql();
    const rows = await sql<{ id: string }[]>`select id from workspaces order by created_at asc limit 1`;
    return rows[0]?.id ?? null;
  });
  if (!wid) return empty;

  const [tickets, agenda, services, attention] = await Promise.all([
    safe(() => ticketPulse(wid)),
    safe(() => agendaPulse(wid)),
    safe(() => servicePulse()),
    safe(() => attentionItems(wid)),
  ]);

  return { tickets, agenda, services, attention: attention ?? [], loadedAt: Date.now() };
}
