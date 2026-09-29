-- Run once in your own Supabase project's SQL Editor.
-- No passwords, tokens or service-role keys are required in this file.
begin;
create table if not exists public.teaching_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8388608),
  updated_at timestamptz not null default now()
);
alter table public.teaching_workspaces enable row level security;
revoke all on public.teaching_workspaces from public, anon, authenticated;
grant select, insert, update on public.teaching_workspaces to authenticated;
drop policy if exists teaching_select_self on public.teaching_workspaces;
drop policy if exists teaching_insert_self on public.teaching_workspaces;
drop policy if exists teaching_update_self on public.teaching_workspaces;
create policy teaching_select_self on public.teaching_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);
create policy teaching_insert_self on public.teaching_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy teaching_update_self on public.teaching_workspaces for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- SECURITY INVOKER: the function cannot bypass the user's table grants or RLS.
-- Conditional UPDATE/INSERT performs an atomic compare-and-swap. A stale
-- revision returns a conflict instead of silently overwriting another device.
create or replace function public.save_teaching_workspace(p_expected_revision bigint, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved_revision bigint;
  saved_at timestamptz;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Invalid revision'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_payload->'courses') is distinct from 'array'
    or jsonb_typeof(p_payload->'records') is distinct from 'array'
    or jsonb_typeof(p_payload->'notes') is distinct from 'array'
    or jsonb_typeof(p_payload->'services') is distinct from 'array'
    or jsonb_typeof(p_payload->'buses') is distinct from 'array'
    or octet_length(p_payload::text) > 8388608 then
    raise exception 'Invalid workspace payload';
  end if;
  if p_expected_revision = 0 then
    insert into public.teaching_workspaces(user_id, revision, payload, updated_at)
      values (owner_id, 1, p_payload, clock_timestamp())
      on conflict (user_id) do nothing
      returning revision, updated_at into saved_revision, saved_at;
  else
    update public.teaching_workspaces
      set payload = p_payload, revision = revision + 1, updated_at = clock_timestamp()
      where user_id = owner_id and revision = p_expected_revision
      returning revision, updated_at into saved_revision, saved_at;
  end if;
  if saved_revision is null then return jsonb_build_object('ok', false, 'conflict', true); end if;
  return jsonb_build_object('ok', true, 'revision', saved_revision, 'updated_at', saved_at);
end;
$$;
revoke all on function public.save_teaching_workspace(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_teaching_workspace(bigint,jsonb) to authenticated;
commit;
