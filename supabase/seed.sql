do $$
declare
  seed_user_id uuid;
  seed_workspace_id uuid;
begin
  if not exists (select 1 from public.profiles limit 1) then
    insert into public.profiles (id, email, name)
    select
      user_row.id,
      user_row.email,
      coalesce(nullif(split_part(user_row.email, '@', 1), ''), 'Openclaw User')
    from auth.users user_row
    order by user_row.created_at asc
    limit 1
    on conflict (id) do nothing;
  end if;

  select id
  into seed_user_id
  from public.profiles
  order by created_at asc
  limit 1;

  if seed_user_id is null then
    raise exception 'No auth user/profile found. Create a user in Authentication > Users, then run seed again.';
  end if;

  select id
  into seed_workspace_id
  from public.workspaces
  where owner_id = seed_user_id
    and name = 'Demo Workspace'
  limit 1;

  if seed_workspace_id is null then
    insert into public.workspaces (owner_id, name)
    values (seed_user_id, 'Demo Workspace')
    returning id into seed_workspace_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (seed_workspace_id, seed_user_id, 'owner')
  on conflict (workspace_id, user_id) do update
  set role = excluded.role;
end
$$;
