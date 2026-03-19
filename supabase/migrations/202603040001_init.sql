create extension if not exists pgcrypto;
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      null;
  end;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  primary key (workspace_id, user_id)
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

alter table public.boards
  drop column if exists color_key;

create table if not exists public.columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  color_key text,
  is_default boolean not null default false,
  position numeric not null,
  created_at timestamptz not null default now()
);

alter table public.columns
  add column if not exists is_default boolean not null default false;

-- Normalize default column ordering per board:
-- To-Do -> In progress -> Completed
with ranked_default_columns as (
  select
    c.id,
    case lower(trim(c.title))
      when 'planned' then 10
      when 'doing' then 20
      when 'on hold' then 30
      when 'completed' then 40
      else null
    end as target_pos
  from public.columns c
)
update public.columns c
set position = ranked_default_columns.target_pos
from ranked_default_columns
where c.id = ranked_default_columns.id
  and ranked_default_columns.target_pos is not null;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid not null references public.columns(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date timestamptz,
  tags text[] not null default '{}',
  assignee_ids uuid[] not null default '{}',
  checklist_done int not null default 0,
  checklist_total int not null default 0,
  attachments_count int not null default 0,
  comments_count int not null default 0,
  position numeric not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tickets
  add column if not exists priority text not null default 'medium',
  add column if not exists auto_approve boolean not null default false,
  add column if not exists assigned_agent_id text not null default '',
  add column if not exists scheduled_for timestamptz,
  add column if not exists execution_state text not null default 'pending'
    check (execution_state in ('pending', 'queued', 'picked_up', 'running', 'done', 'cancelled', 'failed')),
  add column if not exists picked_up_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  name text not null,
  url text not null,
  mime_type text not null default 'application/octet-stream',
  size bigint not null default 0,
  path text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_subtasks (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  position numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- OpenClaw runtime agent id/slug (examples: main, developer-agent)
  openclaw_agent_id text not null default '',
  status text not null default 'idle',
  model text not null default 'unknown',
  last_heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.agents
  add column if not exists openclaw_agent_id text not null default '',
  add column if not exists parent_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists is_main_agent boolean not null default false;

create index if not exists agents_workspace_id_parent_agent_id_idx on public.agents(workspace_id, parent_agent_id)
  where parent_agent_id is not null;

create index if not exists agents_workspace_id_is_main_idx on public.agents(workspace_id, is_main_agent)
  where is_main_agent = true;

alter table public.agents
  drop column if exists name,
  drop column if exists display_name,
  drop column if exists queue_depth,
  drop column if exists active_runs,
  drop column if exists role,
  drop column if exists description,
  drop column if exists temperature,
  drop column if exists max_tokens,
  drop column if exists context_window,
  drop column if exists memory_namespace,
  drop column if exists short_term_items,
  drop column if exists long_term_items,
  drop column if exists context_utilization,
  drop column if exists last_compaction_at,
  drop column if exists uptime_minutes,
  drop column if exists skills;

create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  -- Runtime agent identity at ingestion time (source-of-truth for per-agent log views)
  runtime_agent_id text not null default '',
  event_id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  level text not null default 'info',
  type text not null default 'system',
  run_id text not null default '',
  event_type text not null default 'system.warning'
    check (
      event_type in (
        'chat.user_in',
        'chat.assistant_out',
        'chat.reaction',
        'tool.start',
        'tool.success',
        'tool.error',
        'system.startup',
        'system.shutdown',
        'system.warning',
        'system.error',
        'heartbeat.tick',
        'heartbeat.status_change',
        'memory.read',
        'memory.write',
        'memory.search',
        'memory.upsert',
        'memory.error'
      )
    ),
  direction text not null default 'internal'
    check (direction in ('inbound', 'outbound', 'internal')),
  channel_type text not null default 'internal'
    check (channel_type in ('telegram', 'internal', 'gateway', 'qdrant')),
  session_key text not null default '',
  source_message_id text not null default '',
  correlation_id text not null default '',
  status text not null default '',
  retry_count int not null default 0
    check (retry_count >= 0),
  is_json boolean not null default false,
  message_preview text not null default '',
  raw_payload jsonb,
  memory_source text not null default ''
    check (
      memory_source in (
        '',
        'session',
        'daily_file',
        'long_term_file',
        'episodic_file',
        'qdrant_vector'
      )
    ),
  memory_key text not null default '',
  collection text not null default '',
  query_text text not null default '',
  result_count int
    check (result_count is null or result_count >= 0),
  contains_pii boolean not null default false,
  message text not null
);

alter table public.agent_logs
  add column if not exists runtime_agent_id text not null default '';

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  occurred_at timestamptz not null default now(),
  source text not null default 'System',
  event text not null,
  details text not null default '',
  level text not null default 'info'
);

alter table public.activity_logs
  add column if not exists ticket_id uuid references public.tickets(id) on delete set null;

create table if not exists public.user_workspace_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  setup_completed boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  target text not null,
  enabled boolean not null default true,
  events text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, provider, target)
);

create index if not exists columns_board_id_position_idx on public.columns(board_id, position);
create index if not exists tickets_board_id_column_id_position_idx on public.tickets(board_id, column_id, position);
create index if not exists tickets_board_id_idx on public.tickets(board_id);
create index if not exists tickets_execution_queue_idx on public.tickets(board_id, column_id, auto_approve, execution_state, scheduled_for, created_at);
create index if not exists tickets_assigned_agent_idx on public.tickets(assigned_agent_id);
create index if not exists ticket_attachments_ticket_id_created_at_idx on public.ticket_attachments(ticket_id, created_at);
create index if not exists ticket_subtasks_ticket_id_position_idx on public.ticket_subtasks(ticket_id, position);
create index if not exists ticket_comments_ticket_id_created_at_idx on public.ticket_comments(ticket_id, created_at);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists agents_workspace_id_created_at_idx on public.agents(workspace_id, created_at);
create unique index if not exists agents_workspace_id_openclaw_agent_id_idx on public.agents(workspace_id, openclaw_agent_id)
  where openclaw_agent_id <> '';
create index if not exists agent_logs_workspace_id_occurred_at_idx on public.agent_logs(workspace_id, occurred_at desc);
create index if not exists agent_logs_agent_id_occurred_at_idx on public.agent_logs(agent_id, occurred_at desc);
create index if not exists agent_logs_workspace_id_occurred_at_id_idx on public.agent_logs(workspace_id, occurred_at desc, id desc);
create index if not exists agent_logs_workspace_id_agent_id_occurred_at_id_idx on public.agent_logs(workspace_id, agent_id, occurred_at desc, id desc);
create index if not exists agent_logs_workspace_id_runtime_agent_id_occurred_at_idx on public.agent_logs(workspace_id, runtime_agent_id, occurred_at desc);
create unique index if not exists agent_logs_event_id_idx on public.agent_logs(event_id);
create index if not exists agent_logs_agent_id_event_type_occurred_at_idx on public.agent_logs(agent_id, event_type, occurred_at desc);
create index if not exists agent_logs_correlation_id_idx on public.agent_logs(correlation_id);
create index if not exists agent_logs_session_key_occurred_at_idx on public.agent_logs(session_key, occurred_at desc);
create index if not exists agent_logs_memory_source_occurred_at_idx on public.agent_logs(memory_source, occurred_at desc);
create index if not exists activity_logs_workspace_id_occurred_at_idx on public.activity_logs(workspace_id, occurred_at desc);
create index if not exists activity_logs_ticket_id_occurred_at_idx on public.activity_logs(ticket_id, occurred_at desc);
create index if not exists user_workspace_settings_workspace_user_idx on public.user_workspace_settings(workspace_id, user_id);
create index if not exists notification_channels_workspace_user_idx on public.notification_channels(workspace_id, user_id);

create or replace function public.purge_agent_logs_older_than(retention_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.agent_logs
  where occurred_at < now() - make_interval(days => greatest(retention_days, 1));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.configure_agent_logs_retention(
  retention_days int default 90,
  cron_schedule text default '15 3 * * 0'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  scheduled_job_id bigint;
  effective_days int := greatest(retention_days, 1);
begin
  if to_regclass('cron.job') is null then
    return 'pg_cron unavailable';
  end if;

  for scheduled_job_id in
    select jobid
    from cron.job
    where jobname in ('clawd_purge_agent_logs_daily', 'clawd_purge_agent_logs_weekly')
  loop
    perform cron.unschedule(scheduled_job_id);
  end loop;

  perform cron.schedule(
    'clawd_purge_agent_logs_weekly',
    cron_schedule,
    format('select public.purge_agent_logs_older_than(%s);', effective_days)
  );

  return format('scheduled weekly purge: retention_days=%s schedule=%s', effective_days, cron_schedule);
exception
  when others then
    return format('schedule failed: %s', sqlerrm);
end;
$$;

select public.configure_agent_logs_retention(90, '15 3 * * 0');

create or replace function public.set_ticket_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_ticket_attachment_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.tickets
    set attachments_count = coalesce(attachments_count, 0) + 1
    where id = new.ticket_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.tickets
    set attachments_count = greatest(coalesce(attachments_count, 0) - 1, 0)
    where id = old.ticket_id;
    return old;
  end if;

  return null;
end;
$$;

create or replace function public.set_ticket_subtask_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_ticket_checklist_count()
returns trigger
language plpgsql
as $$
declare
  target_ticket_id uuid;
begin
  target_ticket_id := case when tg_op = 'DELETE' then old.ticket_id else new.ticket_id end;

  update public.tickets
  set
    checklist_total = (
      select count(*)::int
      from public.ticket_subtasks
      where ticket_id = target_ticket_id
    ),
    checklist_done = (
      select count(*)::int
      from public.ticket_subtasks
      where ticket_id = target_ticket_id
        and completed = true
    )
  where id = target_ticket_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.sync_ticket_comment_count()
returns trigger
language plpgsql
as $$
declare
  target_ticket_id uuid;
begin
  target_ticket_id := case when tg_op = 'DELETE' then old.ticket_id else new.ticket_id end;

  update public.tickets
  set comments_count = (
    select count(*)::int
    from public.ticket_comments
    where ticket_id = target_ticket_id
  )
  where id = target_ticket_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
before update on public.tickets
for each row
execute function public.set_ticket_updated_at();

drop trigger if exists ticket_attachments_after_insert on public.ticket_attachments;
create trigger ticket_attachments_after_insert
after insert on public.ticket_attachments
for each row
execute function public.sync_ticket_attachment_count();

drop trigger if exists ticket_attachments_after_delete on public.ticket_attachments;
create trigger ticket_attachments_after_delete
after delete on public.ticket_attachments
for each row
execute function public.sync_ticket_attachment_count();

drop trigger if exists ticket_subtasks_set_updated_at on public.ticket_subtasks;
create trigger ticket_subtasks_set_updated_at
before update on public.ticket_subtasks
for each row
execute function public.set_ticket_subtask_updated_at();

drop trigger if exists ticket_subtasks_after_insert on public.ticket_subtasks;
create trigger ticket_subtasks_after_insert
after insert on public.ticket_subtasks
for each row
execute function public.sync_ticket_checklist_count();

drop trigger if exists ticket_subtasks_after_update on public.ticket_subtasks;
create trigger ticket_subtasks_after_update
after update of completed on public.ticket_subtasks
for each row
execute function public.sync_ticket_checklist_count();

drop trigger if exists ticket_subtasks_after_delete on public.ticket_subtasks;
create trigger ticket_subtasks_after_delete
after delete on public.ticket_subtasks
for each row
execute function public.sync_ticket_checklist_count();

drop trigger if exists ticket_comments_after_insert on public.ticket_comments;
create trigger ticket_comments_after_insert
after insert on public.ticket_comments
for each row
execute function public.sync_ticket_comment_count();

drop trigger if exists ticket_comments_after_delete on public.ticket_comments;
create trigger ticket_comments_after_delete
after delete on public.ticket_comments
for each row
execute function public.sync_ticket_comment_count();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_name text;
begin
  fallback_name := split_part(coalesce(new.email, ''), '@', 1);

  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    case
      when fallback_name <> '' then fallback_name
      else 'Openclaw User'
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.boards enable row level security;
alter table public.columns enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_subtasks enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.agents enable row level security;
alter table public.agent_logs enable row level security;
alter table public.activity_logs enable row level security;
alter table public.user_workspace_settings enable row level security;
alter table public.notification_channels enable row level security;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members member_row
    where member_row.workspace_id = target_workspace_id
      and member_row.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces workspace_row
    where workspace_row.id = target_workspace_id
      and workspace_row.owner_id = auth.uid()
  );
$$;

create or replace function public.can_access_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_profile_id = auth.uid()
    or exists (
      select 1
      from public.workspace_members self_member
      join public.workspace_members target_member
        on self_member.workspace_id = target_member.workspace_id
      where self_member.user_id = auth.uid()
        and target_member.user_id = target_profile_id
    );
$$;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.can_access_profile(uuid) to authenticated;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles
for select
using (public.can_access_profile(id));

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert"
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "workspaces_select" on public.workspaces;
create policy "workspaces_select"
on public.workspaces
for select
using (
  owner_id = auth.uid()
  or public.is_workspace_member(id)
);

drop policy if exists "workspaces_insert" on public.workspaces;
create policy "workspaces_insert"
on public.workspaces
for insert
with check (owner_id = auth.uid());

drop policy if exists "workspaces_update" on public.workspaces;
create policy "workspaces_update"
on public.workspaces
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "workspaces_delete" on public.workspaces;
create policy "workspaces_delete"
on public.workspaces
for delete
using (owner_id = auth.uid());

drop policy if exists "workspace_members_select" on public.workspace_members;
create policy "workspace_members_select"
on public.workspace_members
for select
using (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
);

drop policy if exists "workspace_members_manage" on public.workspace_members;
create policy "workspace_members_manage"
on public.workspace_members
for all
using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

drop policy if exists "boards_member_access" on public.boards;
create policy "boards_member_access"
on public.boards
for all
using (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
)
with check (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
);

drop policy if exists "columns_member_access" on public.columns;
create policy "columns_member_access"
on public.columns
for all
using (
  exists (
    select 1
    from public.boards board_row
    where board_row.id = columns.board_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.boards board_row
    where board_row.id = columns.board_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
);

drop policy if exists "tickets_member_access" on public.tickets;
create policy "tickets_member_access"
on public.tickets
for all
using (
  exists (
    select 1
    from public.boards board_row
    where board_row.id = tickets.board_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.boards board_row
    where board_row.id = tickets.board_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
);

drop policy if exists "ticket_attachments_member_access" on public.ticket_attachments;
create policy "ticket_attachments_member_access"
on public.ticket_attachments
for all
using (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
)
with check (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
);

drop policy if exists "ticket_subtasks_member_access" on public.ticket_subtasks;
create policy "ticket_subtasks_member_access"
on public.ticket_subtasks
for all
using (
  exists (
    select 1
    from public.tickets ticket_row
    join public.boards board_row on board_row.id = ticket_row.board_id
    where ticket_row.id = ticket_subtasks.ticket_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.tickets ticket_row
    join public.boards board_row on board_row.id = ticket_row.board_id
    where ticket_row.id = ticket_subtasks.ticket_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
);

drop policy if exists "ticket_comments_member_access" on public.ticket_comments;
create policy "ticket_comments_member_access"
on public.ticket_comments
for all
using (
  exists (
    select 1
    from public.tickets ticket_row
    join public.boards board_row on board_row.id = ticket_row.board_id
    where ticket_row.id = ticket_comments.ticket_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.tickets ticket_row
    join public.boards board_row on board_row.id = ticket_row.board_id
    where ticket_row.id = ticket_comments.ticket_id
      and (
        public.is_workspace_member(board_row.workspace_id)
        or public.is_workspace_owner(board_row.workspace_id)
      )
  )
);

drop policy if exists "agents_member_access" on public.agents;
create policy "agents_member_access"
on public.agents
for all
using (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
)
with check (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
);

drop policy if exists "agent_logs_member_access" on public.agent_logs;
create policy "agent_logs_member_access"
on public.agent_logs
for all
using (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
)
with check (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
);

drop policy if exists "activity_logs_member_access" on public.activity_logs;
create policy "activity_logs_member_access"
on public.activity_logs
for all
using (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
)
with check (
  public.is_workspace_member(workspace_id)
  or public.is_workspace_owner(workspace_id)
);

create or replace function public.set_user_workspace_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_workspace_settings_set_updated_at on public.user_workspace_settings;
create trigger user_workspace_settings_set_updated_at
before update on public.user_workspace_settings
for each row
execute function public.set_user_workspace_settings_updated_at();

drop trigger if exists notification_channels_set_updated_at on public.notification_channels;
create trigger notification_channels_set_updated_at
before update on public.notification_channels
for each row
execute function public.set_user_workspace_settings_updated_at();

drop policy if exists "user_workspace_settings_select" on public.user_workspace_settings;
create policy "user_workspace_settings_select"
on public.user_workspace_settings
for select
using (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
);

drop policy if exists "user_workspace_settings_insert" on public.user_workspace_settings;
create policy "user_workspace_settings_insert"
on public.user_workspace_settings
for insert
with check (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
);

drop policy if exists "user_workspace_settings_update" on public.user_workspace_settings;
create policy "user_workspace_settings_update"
on public.user_workspace_settings
for update
using (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
)
with check (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
);

drop policy if exists "notification_channels_select" on public.notification_channels;
create policy "notification_channels_select"
on public.notification_channels
for select
using (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
);

drop policy if exists "notification_channels_insert" on public.notification_channels;
create policy "notification_channels_insert"
on public.notification_channels
for insert
with check (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
);

drop policy if exists "notification_channels_update" on public.notification_channels;
create policy "notification_channels_update"
on public.notification_channels
for update
using (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
)
with check (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
);

drop policy if exists "notification_channels_delete" on public.notification_channels;
create policy "notification_channels_delete"
on public.notification_channels
for delete
using (
  user_id = auth.uid()
  and (
    public.is_workspace_member(workspace_id)
    or public.is_workspace_owner(workspace_id)
  )
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('ticket-attachments', 'ticket-attachments', false, 20971520)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "ticket_attachments_objects_select" on storage.objects;
create policy "ticket_attachments_objects_select"
on storage.objects
for select
using (
  bucket_id = 'ticket-attachments'
  and auth.role() = 'authenticated'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "ticket_attachments_objects_insert" on storage.objects;
create policy "ticket_attachments_objects_insert"
on storage.objects
for insert
with check (
  bucket_id = 'ticket-attachments'
  and auth.role() = 'authenticated'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "ticket_attachments_objects_update" on storage.objects;
create policy "ticket_attachments_objects_update"
on storage.objects
for update
using (
  bucket_id = 'ticket-attachments'
  and auth.role() = 'authenticated'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'ticket-attachments'
  and auth.role() = 'authenticated'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "ticket_attachments_objects_delete" on storage.objects;
create policy "ticket_attachments_objects_delete"
on storage.objects
for delete
using (
  bucket_id = 'ticket-attachments'
  and auth.role() = 'authenticated'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);
