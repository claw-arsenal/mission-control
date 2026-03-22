insert into workspaces (id, name, slug)
values (gen_random_uuid(), 'OpenClaw', 'openclaw')
on conflict (slug) do update set name = excluded.name, updated_at = now();

insert into profiles (workspace_id, email, name, role)
select id, null, 'OpenClaw User', 'owner'
from workspaces
where slug = 'openclaw'
on conflict do nothing;

insert into app_settings (id, gateway_token, setup_completed)
values (1, '', false)
on conflict (id) do nothing;

insert into boards (workspace_id, name, description)
select id, 'Main Board', 'Default workspace board'
from workspaces
where slug = 'openclaw'
on conflict do nothing;

with main_board as (
  select b.id as board_id
  from boards b
  join workspaces w on w.id = b.workspace_id
  where w.slug = 'openclaw' and b.name = 'Main Board'
  order by b.created_at asc
  limit 1
)
insert into columns (board_id, title, color_key, is_default, position)
select board_id, title, color_key, is_default, position
from main_board
cross join (values
  ('Backlog', 'slate', true, 0),
  ('In Progress', 'blue', false, 1),
  ('Review', 'amber', false, 2),
  ('Done', 'emerald', false, 3)
) as v(title, color_key, is_default, position)
on conflict do nothing;
