create extension if not exists pgcrypto;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists app_settings (
  id integer primary key default 1,
  gateway_token text not null default '',
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);

insert into app_settings (id, gateway_token, setup_completed)
values (1, '', false)
on conflict (id) do nothing;

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  title text not null,
  color_key text not null default 'slate',
  is_default boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  board_id uuid not null references boards(id) on delete cascade,
  column_id uuid not null references columns(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium',
  due_date date,
  tags text[] not null default '{}'::text[],
  assignee_ids uuid[] not null default '{}'::uuid[],
  checklist_done integer not null default 0,
  checklist_total integer not null default 0,
  comments_count integer not null default 0,
  attachments_count integer not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  openclaw_agent_id text,
  status text not null default 'idle',
  model text,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, openclaw_agent_id)
);

create table if not exists agent_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  runtime_agent_id text,
  occurred_at timestamptz not null default now(),
  level text not null default 'info',
  type text not null default 'system',
  run_id text,
  message text,
  event_id text,
  event_type text,
  direction text,
  channel_type text,
  session_key text,
  source_message_id text,
  correlation_id text,
  status text,
  retry_count integer,
  message_preview text,
  is_json boolean,
  contains_pii boolean,
  memory_source text,
  memory_key text,
  collection text,
  query_text text,
  result_count integer,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  source text not null default 'System',
  event text not null,
  details text not null default '',
  level text not null default 'info',
  created_at timestamptz not null default now()
);

create table if not exists notification_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  provider text not null,
  target text not null,
  enabled boolean not null default false,
  events text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, provider, target)
);
