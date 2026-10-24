-- RIVET V2 · 1700 · CO viewers, sending back (DE to school, CO to RO), and the DPO's school access
-- (Ada, 24 Oct 2026).

-- ── CO viewers: every SDO, read only ───────────────────────────────────────────────────────
-- A CO account sees what the Regional Office sees. Every step function names the roles that may
-- record it, so a CO account records nothing except its own notes to the RO (below).

do $$
declare p record;
begin
  for p in select * from pg_policies
           where schemaname = 'public' and qual like '%''admin''::app_role]%' and qual not like '%''co''::app_role%'
  loop
    execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename,
                   replace(p.qual, '''admin''::app_role]', '''admin''::app_role, ''co''::app_role]'));
  end loop;
end $$;

create or replace function can_see_sdo(p_sdo text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('ro', 'admin', 'co') or current_sdo() = p_sdo, false)
$$;

create or replace function can_see_school(p_sdo text, p_school text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('ro', 'admin', 'co')
                  or (current_sdo() = p_sdo and (current_school() is null or current_school() = p_school)), false)
$$;

-- ── Sending back ───────────────────────────────────────────────────────────────────────────
-- de_to_school: the DE (or DPO) returns a school's records to the school with notes; the school
--   updates them and answers; the DE closes it.
-- co_to_ro: a CO viewer flags an SDO or a school to the Regional Office; the RO answers; CO closes.

create table returns (
  id        bigint generated always as identity primary key,
  cycle_id  text not null references cycles(id),
  kind      text not null check (kind in ('de_to_school', 'co_to_ro')),
  sdo_code  text not null references sdos(code),
  school_id text,
  note      text not null,
  items     jsonb not null default '[]',   -- [{"kind": "building"|"room"|"table", "id": ..., "label": ..., "note": ...}]
  raised_by uuid not null references profiles(id),
  raised_at timestamptz not null default clock_timestamp(),
  check (kind <> 'de_to_school' or school_id is not null)
);
create table return_events (
  id        bigint generated always as identity primary key,
  return_id bigint not null references returns(id),
  event     text not null check (event in ('answered', 'closed')),
  note      text,
  by_user   uuid not null references profiles(id),
  at        timestamptz not null default clock_timestamp()
);
create trigger returns_locked       before update or delete on returns       for each row execute function forbid_change();
create trigger return_events_locked before update or delete on return_events for each row execute function forbid_change();

-- A person's name for the screens; a school account cannot read SDO profiles, but sees who wrote to it.
create or replace function profile_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name from profiles where id = p_id
$$;
revoke execute on function profile_name(uuid) from public, anon;
grant execute on function profile_name(uuid) to authenticated;

create view return_status with (security_invoker = true) as
select r.*, profile_name(r.raised_by) as raised_by_name,
       coalesce(e.event, 'open') as status,
       case e.event when 'answered' then 'answered' when 'closed' then 'closed' else 'open' end as state,
       e.note as last_note, e.at as last_at, profile_name(e.by_user) as last_by_name
from returns r
left join lateral (select * from return_events x where x.return_id = r.id order by x.id desc limit 1) e on true;

create or replace function send_back_to_school(p_cycle text, p_school text, p_note text, p_items jsonb default '[]')
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s cycle_schools;
  v_me uuid;
  v_id bigint;
begin
  select * into s from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if s.school_id is null then perform refuse('That school is not in this cycle''s NSBI data', 'no_data_found'); end if;
  v_me := assert_can_edit(p_cycle, s.sdo_code, p_school);
  if current_app_role() not in ('de', 'dpo') then
    perform refuse('Only the Division Engineer or Planning Officer sends records back', 'insufficient_privilege');
  end if;
  if nullif(trim(p_note), '') is null then perform refuse('Say what the school should check or correct'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' then perform refuse('Items must be a list'); end if;
  if exists (select 1 from return_status where kind = 'de_to_school' and cycle_id = p_cycle and school_id = p_school and state <> 'closed') then
    perform refuse('This school already has records sent back: close that first, or add to it after the school answers');
  end if;
  insert into returns (cycle_id, kind, sdo_code, school_id, note, items, raised_by)
  values (p_cycle, 'de_to_school', s.sdo_code, p_school, trim(p_note), p_items, v_me) returning id into v_id;
  return v_id;
end $$;

create or replace function poke_ro(p_cycle text, p_sdo text, p_school text, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles;
  v_id bigint;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'co' then perform refuse('Only a Central Office account sends a note to the RO', 'insufficient_privilege'); end if;
  if not exists (select 1 from sdos where code = p_sdo) then perform refuse('No such SDO', 'no_data_found'); end if;
  if p_school is not null and not exists (select 1 from cycle_schools where cycle_id = p_cycle and school_id = p_school and sdo_code = p_sdo) then
    perform refuse('That school is not in this SDO', 'no_data_found');
  end if;
  if nullif(trim(p_note), '') is null then perform refuse('Write the note for the Regional Office'); end if;
  insert into returns (cycle_id, kind, sdo_code, school_id, note, raised_by)
  values (p_cycle, 'co_to_ro', p_sdo, p_school, trim(p_note), v_me.id) returning id into v_id;
  return v_id;
end $$;

-- The school (or the RO, for a CO note) answers; the one who raised it, or their office, closes it.
create or replace function answer_return(p_return bigint, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  r return_status;
  v_me profiles;
  v_id bigint;
begin
  select * into r from return_status where id = p_return;
  if r.id is null then perform refuse('No such item', 'no_data_found'); end if;
  v_me := current_profile();
  if r.kind = 'de_to_school' and (v_me.role is distinct from 'school' or v_me.school_id is distinct from r.school_id) then
    perform refuse('Only the school answers this', 'insufficient_privilege');
  end if;
  if r.kind = 'co_to_ro' and v_me.role is distinct from 'ro' then
    perform refuse('Only the Regional Office answers this', 'insufficient_privilege');
  end if;
  if r.state = 'closed' then perform refuse('This is already closed'); end if;
  if nullif(trim(p_note), '') is null then perform refuse('Write your answer'); end if;
  insert into return_events (return_id, event, note, by_user) values (p_return, 'answered', trim(p_note), v_me.id) returning id into v_id;
  return v_id;
end $$;

create or replace function close_return(p_return bigint, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  r return_status;
  v_me profiles;
  v_id bigint;
begin
  select * into r from return_status where id = p_return;
  if r.id is null then perform refuse('No such item', 'no_data_found'); end if;
  v_me := current_profile();
  if r.kind = 'de_to_school' and not (v_me.role in ('de', 'dpo') and v_me.sdo_code = r.sdo_code) then
    perform refuse('Only the SDO closes this', 'insufficient_privilege');
  end if;
  if r.kind = 'co_to_ro' and v_me.role is distinct from 'co' then
    perform refuse('Only the Central Office closes this', 'insufficient_privilege');
  end if;
  if r.state = 'closed' then perform refuse('This is already closed'); end if;
  insert into return_events (return_id, event, note, by_user) values (p_return, 'closed', nullif(trim(p_note), ''), v_me.id) returning id into v_id;
  return v_id;
end $$;

alter table returns enable row level security;
alter table return_events enable row level security;
create policy read_scoped on returns for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (kind = 'de_to_school' and sdo_code = (select current_sdo())
      and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on return_events for select to authenticated using (
  exists (select 1 from returns r where r.id = return_id));
revoke all on returns, return_events, return_status from anon;
revoke insert, update, delete, truncate on returns, return_events from authenticated;
grant select on returns, return_events, return_status to authenticated;

-- ── School access, managed by the DPO ──────────────────────────────────────────────────────
-- The DPO creates a school account: a DepEd email, one School ID, and a starting password the DPO
-- gives the person directly (no email is sent, for now). The DPO can set a new password, and
-- removing access turns the account off; the school's records stay with the School ID.

alter table profiles add column position text;

create table school_access_grants (
  id         bigint generated always as identity primary key,
  email      text not null check (email = lower(trim(email)) and email like '%_@_%'),
  full_name  text not null,
  position   text,
  sdo_code   text not null references sdos(code),
  school_id  text not null,
  granted_by uuid not null references profiles(id),
  granted_at timestamptz not null default clock_timestamp()
);
create table school_access_removals (
  grant_id   bigint primary key references school_access_grants(id),
  reason     text not null,
  removed_by uuid not null references profiles(id),
  removed_at timestamptz not null default clock_timestamp()
);
create trigger school_access_grants_locked   before update or delete on school_access_grants   for each row execute function forbid_change();
create trigger school_access_removals_locked before update or delete on school_access_removals for each row execute function forbid_change();

create view school_access_active with (security_invoker = true) as
select g.* from school_access_grants g
where not exists (select 1 from school_access_removals x where x.grant_id = g.id);

-- Give (or refresh) the school account of a signed-in user from their active grant.
create or replace function apply_school_grant(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g school_access_grants;
begin
  select * into g from school_access_grants x
  where x.email = lower(p_email) and not exists (select 1 from school_access_removals r where r.grant_id = x.id)
  order by x.id desc limit 1;
  if g.id is null then return; end if;
  insert into profiles (id, email, full_name, role, sdo_code, school_id, position, active)
  values (p_user, g.email, g.full_name, 'school', g.sdo_code, g.school_id, g.position, true)
  on conflict (id) do update set full_name = excluded.full_name, role = 'school', sdo_code = excluded.sdo_code,
    school_id = excluded.school_id, position = excluded.position, active = true
  where profiles.role = 'school';
end $$;
revoke execute on function apply_school_grant(uuid, text) from public, anon, authenticated;

-- The sign-in itself, made the way Supabase Auth makes an email-and-password user.
create or replace function set_school_sign_in(p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid;
begin
  if length(p_password) < 8 or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    perform refuse('The password needs at least 8 characters, with letters and numbers');
  end if;
  select id into v_user from auth.users where lower(email) = p_email;
  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', p_email,
      crypt(p_password, gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
      '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user, v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', p_email, 'email_verified', true), 'email', null, now(), now());
  else
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = v_user;
  end if;
  return v_user;
end $$;
revoke execute on function set_school_sign_in(text, text) from public, anon, authenticated;

create or replace function assert_dpo_of(p_sdo text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_me profiles;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'dpo' or v_me.sdo_code is distinct from p_sdo then
    perform refuse('Only the Division Planning Officer of this SDO manages school access', 'insufficient_privilege');
  end if;
  return v_me.id;
end $$;

create or replace function grant_school_access(p_school text, p_email text, p_full_name text, p_password text,
                                               p_position text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_sdo text;
  v_me uuid;
  v_id bigint;
  v_user uuid;
begin
  select sdo_code into v_sdo from cycle_schools where school_id = p_school order by cycle_id desc limit 1;
  if v_sdo is null then perform refuse('No such School ID in the NSBI', 'no_data_found'); end if;
  v_me := assert_dpo_of(v_sdo);
  if v_email !~ '^[^@\s]+@deped\.gov\.ph$' then perform refuse('Use the person''s DepEd email (@deped.gov.ph)'); end if;
  if nullif(trim(p_full_name), '') is null then perform refuse('Give the person''s name'); end if;
  if exists (select 1 from profiles where email = v_email and role <> 'school') then
    perform refuse('This email belongs to an SDO or Regional Office account');
  end if;
  if exists (select 1 from school_access_active where email = v_email) then
    perform refuse('This email already has school access: remove it first (for example after a transfer)');
  end if;
  insert into school_access_grants (email, full_name, position, sdo_code, school_id, granted_by)
  values (v_email, trim(p_full_name), nullif(trim(p_position), ''), v_sdo, p_school, v_me) returning id into v_id;
  v_user := set_school_sign_in(v_email, p_password);
  perform apply_school_grant(v_user, v_email);
  return v_id;
end $$;

create or replace function remove_school_access(p_grant bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g school_access_grants;
  v_me uuid;
begin
  select * into g from school_access_grants where id = p_grant;
  if g.id is null then perform refuse('No such access', 'no_data_found'); end if;
  v_me := assert_dpo_of(g.sdo_code);
  if exists (select 1 from school_access_removals where grant_id = p_grant) then perform refuse('This access is already removed'); end if;
  if nullif(trim(p_reason), '') is null then perform refuse('Say why (for example: transferred, retired)'); end if;
  insert into school_access_removals (grant_id, reason, removed_by) values (p_grant, trim(p_reason), v_me);
  update profiles set active = false where email = g.email and role = 'school';
end $$;

create or replace function reset_school_password(p_grant bigint, p_password text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g school_access_grants;
begin
  select * into g from school_access_grants where id = p_grant;
  if g.id is null then perform refuse('No such access', 'no_data_found'); end if;
  perform assert_dpo_of(g.sdo_code);
  if exists (select 1 from school_access_removals where grant_id = p_grant) then perform refuse('This access was removed'); end if;
  perform set_school_sign_in(g.email, p_password);
end $$;

-- The DPO's list: every grant in their SDO with its state and the person's last sign-in.
create or replace function school_access_list(p_sdo text)
returns table (grant_id bigint, email text, full_name text, "position" text, school_id text, school_name text,
               granted_at timestamptz, granted_by_name text, removed_at timestamptz, removal_reason text,
               last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.email, g.full_name, g.position, g.school_id,
         (select s.school_name from cycle_schools s where s.school_id = g.school_id order by s.cycle_id desc limit 1),
         g.granted_at, gp.full_name, x.removed_at, x.reason,
         u.last_sign_in_at
  from school_access_grants g
  join profiles gp on gp.id = g.granted_by
  left join school_access_removals x on x.grant_id = g.id
  left join auth.users u on lower(u.email) = g.email
  where g.sdo_code = p_sdo and can_see_sdo(p_sdo) and current_app_role() in ('dpo', 'de', 'ro', 'admin', 'co')
  order by x.removed_at nulls first, g.school_id, g.full_name
$$;

alter table school_access_grants enable row level security;
alter table school_access_removals enable row level security;
create policy read_scoped on school_access_grants for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and (select current_school()) is null));
create policy read_scoped on school_access_removals for select to authenticated using (
  exists (select 1 from school_access_grants g where g.id = grant_id));
revoke all on school_access_grants, school_access_removals, school_access_active from anon;
revoke insert, update, delete, truncate on school_access_grants, school_access_removals from authenticated;
grant select on school_access_grants, school_access_removals, school_access_active to authenticated;
revoke execute on function school_access_list(text) from public, anon;
grant execute on function school_access_list(text) to authenticated;
