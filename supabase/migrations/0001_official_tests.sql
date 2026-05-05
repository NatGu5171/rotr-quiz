-- Official Test Mode + Groups/Subgroups
-- One-time migration. Idempotent where possible (uses IF NOT EXISTS / OR REPLACE).

-- =============================================================================
-- TABLES
-- =============================================================================

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.subgroups (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (group_id, name)
);

create table if not exists public.user_memberships (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  subgroup_id  uuid references public.subgroups(id) on delete set null,
  joined_at    timestamptz not null default now()
);

create table if not exists public.admin_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  scope_type  text not null check (scope_type in ('group','subgroup')),
  scope_id    uuid not null,
  granted_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (user_id, scope_type, scope_id)
);

create index if not exists admin_grants_user_idx  on public.admin_grants(user_id);
create index if not exists admin_grants_scope_idx on public.admin_grants(scope_type, scope_id);

create table if not exists public.tests (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  password_hash  text not null,
  scope          text[] not null default '{}',
  rules          text[] not null default '{}',
  question_ids   int[]  not null,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

create table if not exists public.test_results (
  id             uuid primary key default gen_random_uuid(),
  test_id        uuid not null references public.tests(id) on delete cascade,
  test_name      text not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  taker_email    text not null,
  subgroup_id    uuid references public.subgroups(id) on delete set null,
  subgroup_name  text,
  group_id       uuid,
  group_name     text,
  correct        int  not null,
  total          int  not null,
  pct            numeric(5,2) not null,
  passed         boolean not null,
  created_at     timestamptz not null default now(),
  unique (test_id, user_id)  -- single attempt per user per test
);

create index if not exists test_results_subgroup_idx on public.test_results(subgroup_id);
create index if not exists test_results_group_idx    on public.test_results(group_id);
create index if not exists test_results_user_idx     on public.test_results(user_id);

-- =============================================================================
-- HELPER FUNCTIONS (security definer to read auth.jwt() correctly inside RLS)
-- =============================================================================

create or replace function public.is_global_admin() returns boolean
  language sql stable security definer set search_path = public, auth
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'global_admin'
$$;

create or replace function public.is_group_admin(g uuid) returns boolean
  language sql stable security definer set search_path = public, auth
as $$
  select public.is_global_admin()
      or exists (
        select 1 from public.admin_grants
         where user_id    = auth.uid()
           and scope_type = 'group'
           and scope_id   = g
      )
$$;

create or replace function public.is_subgroup_admin(s uuid) returns boolean
  language sql stable security definer set search_path = public, auth
as $$
  select public.is_global_admin()
      or exists (
        select 1
          from public.admin_grants ag
         where ag.user_id = auth.uid()
           and (
                 (ag.scope_type = 'subgroup' and ag.scope_id = s)
              or (ag.scope_type = 'group'
                  and ag.scope_id = (select group_id from public.subgroups where id = s))
           )
      )
$$;

grant execute on function public.is_global_admin()        to anon, authenticated;
grant execute on function public.is_group_admin(uuid)     to anon, authenticated;
grant execute on function public.is_subgroup_admin(uuid)  to anon, authenticated;

-- Keep scope-less admin_grants from lingering when an org unit is deleted.
create or replace function public.cleanup_admin_grants_for_deleted_group() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  delete from public.admin_grants
   where (scope_type = 'group' and scope_id = old.id)
      or (scope_type = 'subgroup'
          and scope_id in (select id from public.subgroups where group_id = old.id));
  return old;
end;
$$;

create or replace function public.cleanup_admin_grants_for_deleted_subgroup() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  delete from public.admin_grants
   where scope_type = 'subgroup'
     and scope_id = old.id;
  return old;
end;
$$;

drop trigger if exists cleanup_admin_grants_before_group_delete on public.groups;
create trigger cleanup_admin_grants_before_group_delete
  before delete on public.groups
  for each row execute function public.cleanup_admin_grants_for_deleted_group();

drop trigger if exists cleanup_admin_grants_before_subgroup_delete on public.subgroups;
create trigger cleanup_admin_grants_before_subgroup_delete
  before delete on public.subgroups
  for each row execute function public.cleanup_admin_grants_for_deleted_subgroup();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.groups            enable row level security;
alter table public.subgroups         enable row level security;
alter table public.user_memberships  enable row level security;
alter table public.admin_grants      enable row level security;
alter table public.tests             enable row level security;
alter table public.test_results      enable row level security;

-- ── groups ───────────────────────────────────────────────────────────────────
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select to authenticated using (true);

drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups
  for all to authenticated
  using      (public.is_global_admin())
  with check (public.is_global_admin());

-- ── subgroups ────────────────────────────────────────────────────────────────
drop policy if exists subgroups_select on public.subgroups;
create policy subgroups_select on public.subgroups
  for select to authenticated using (true);

drop policy if exists subgroups_write on public.subgroups;
create policy subgroups_write on public.subgroups
  for all to authenticated
  using      (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

-- ── user_memberships ─────────────────────────────────────────────────────────
drop policy if exists memberships_select on public.user_memberships;
create policy memberships_select on public.user_memberships
  for select to authenticated using (
    user_id = auth.uid()
    or (subgroup_id is not null and public.is_subgroup_admin(subgroup_id))
    or public.is_global_admin()
  );

drop policy if exists memberships_insert_self on public.user_memberships;
create policy memberships_insert_self on public.user_memberships
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_global_admin());

drop policy if exists memberships_update_self on public.user_memberships;
create policy memberships_update_self on public.user_memberships
  for update to authenticated
  using      (user_id = auth.uid() or public.is_global_admin())
  with check (user_id = auth.uid() or public.is_global_admin());

drop policy if exists memberships_delete_self on public.user_memberships;
create policy memberships_delete_self on public.user_memberships
  for delete to authenticated
  using (user_id = auth.uid() or public.is_global_admin());

-- ── admin_grants ─────────────────────────────────────────────────────────────
drop policy if exists grants_select on public.admin_grants;
create policy grants_select on public.admin_grants
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_global_admin()
    or (scope_type = 'subgroup' and public.is_group_admin(
          (select group_id from public.subgroups where id = scope_id)
       ))
    or (scope_type = 'group' and public.is_group_admin(scope_id))
  );

drop policy if exists grants_insert on public.admin_grants;
create policy grants_insert on public.admin_grants
  for insert to authenticated
  with check (
    -- global admin can grant anything
    public.is_global_admin()
    -- group admin can only grant subgroup admin within their own group
    or (scope_type = 'subgroup'
        and public.is_group_admin(
              (select group_id from public.subgroups where id = scope_id)
            ))
  );

drop policy if exists grants_delete on public.admin_grants;
create policy grants_delete on public.admin_grants
  for delete to authenticated using (
    public.is_global_admin()
    or (scope_type = 'subgroup'
        and public.is_group_admin(
              (select group_id from public.subgroups where id = scope_id)
            ))
  );

-- ── tests ────────────────────────────────────────────────────────────────────
-- Anyone authenticated can SELECT public test metadata. Column grants below
-- ensure password_hash/question_ids remain service-role only.
drop policy if exists tests_select on public.tests;
create policy tests_select on public.tests
  for select to authenticated using (true);

drop policy if exists tests_write on public.tests;
create policy tests_write on public.tests
  for all to authenticated
  using      (public.is_global_admin())
  with check (public.is_global_admin());

-- Column-level privileges prevent authenticated clients from reading
-- password_hash or question_ids even if they manually attempt select('*').
revoke select on table public.tests from anon, authenticated;
grant select (id, name, created_at) on table public.tests to authenticated;
grant delete on table public.tests to authenticated;

-- ── test_results ─────────────────────────────────────────────────────────────
drop policy if exists results_select on public.test_results;
create policy results_select on public.test_results
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_global_admin()
    or (subgroup_id is not null and public.is_subgroup_admin(subgroup_id))
    or (group_id    is not null and public.is_group_admin(group_id))
  );

-- No insert/update/delete from clients — Edge Functions use service role.
drop policy if exists results_no_client_write on public.test_results;
create policy results_no_client_write on public.test_results
  for all to authenticated
  using (false) with check (false);

-- =============================================================================
-- DONE
-- =============================================================================
