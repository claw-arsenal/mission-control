import type { getSql } from "@/lib/local-db";
import { ensureMobileAppsSchema } from "./ensure-schema";
import { DEFAULT_REVIEW_ALERT_CONFIG } from "./review-alert-config";

type Sql = ReturnType<typeof getSql>;
const schemas = new WeakMap<Sql, Promise<void>>();

export async function ensureReviewAlertSchema(sql: Sql) {
  let pending = schemas.get(sql);
  if (!pending) {
    pending = createSchema(sql).catch(error => { schemas.delete(sql); throw error; });
    schemas.set(sql, pending);
  }
  await pending;
  await sql`insert into mobile_review_settings (workspace_id, config)
    select id, ${JSON.stringify(DEFAULT_REVIEW_ALERT_CONFIG)}::text::jsonb from workspaces
    on conflict (workspace_id) do nothing`;
}

async function createSchema(sql: Sql) {
  await ensureMobileAppsSchema(sql);
  await sql`create table if not exists mobile_review_settings (
    workspace_id uuid primary key references workspaces(id) on delete cascade,
    config jsonb not null, generation uuid not null default gen_random_uuid(),
    alerts_since timestamptz not null default now(), updated_at timestamptz not null default now(),
    updated_by text, heartbeat_at timestamptz, last_checked_at timestamptz,
    next_poll_at timestamptz not null default now(), last_error text
  )`;
  await sql`create table if not exists mobile_review_deliveries (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    review_id uuid not null references app_reviews(id) on delete cascade,
    generation uuid not null, channel text not null check (channel in ('email','telegram')),
    recipient text not null, payload jsonb not null,
    status text not null default 'pending' check (status in ('pending','sending','sent','failed','uncertain','cancelled')),
    attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), error text,
    unique(review_id, channel, recipient)
  )`;
  await sql`create index if not exists mobile_review_deliveries_pending_idx on mobile_review_deliveries(status, next_attempt_at)`;
  // Queue in the same transaction as insertion, including inserts from the report worker.
  await sql`create or replace function queue_mobile_review_alert() returns trigger as $$
    declare app record; settings record; destination record; content jsonb;
    begin
      select a.id, a.name, a.workspace_id, l.store into app
        from mobile_app_listings l join mobile_apps a on a.id = l.mobile_app_id where l.id = new.listing_id;
      perform pg_notify('mobile_apps_change', json_build_object('appId', app.id)::text);
      select * into settings from mobile_review_settings where workspace_id = app.workspace_id;
      if not found or not coalesce((settings.config->>'monitoring')::boolean, false)
        or new.submitted_at is null or new.submitted_at < settings.alerts_since
        or new.rating is null or new.rating > (settings.config->>'maxRating')::integer then return new; end if;
      content := jsonb_build_object('appId', app.id, 'appName', app.name, 'store', app.store,
        'rating', new.rating, 'author', new.author, 'title', new.title, 'body', new.body, 'submittedAt', new.submitted_at);
      for destination in
        select 'email' as channel, value as recipient from jsonb_array_elements_text(settings.config->'emailRecipients')
          where (settings.config->>'emailEnabled')::boolean
        union all
        select 'telegram', value from jsonb_array_elements_text(settings.config->'telegramChats')
          where (settings.config->>'telegramEnabled')::boolean
      loop
        insert into mobile_review_deliveries(workspace_id, review_id, generation, channel, recipient, payload)
        values(app.workspace_id, new.id, settings.generation, destination.channel, destination.recipient, content)
        on conflict (review_id, channel, recipient) do nothing;
      end loop;
      perform pg_notify('mobile_review_alerts', app.workspace_id::text);
      return new;
    end;
  $$ language plpgsql`;
  await sql`do $$ begin
    if not exists (select 1 from pg_trigger where tgname = 'mobile_review_alert_insert' and tgrelid = 'app_reviews'::regclass) then
      create trigger mobile_review_alert_insert after insert on app_reviews for each row execute function queue_mobile_review_alert();
    end if;
  end $$`;
}
