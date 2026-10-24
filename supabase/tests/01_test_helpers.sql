-- LOCAL TESTING ONLY. Small assertion helpers for the SQL tests (pgTAP is not needed).

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Act as a sample account, the way Supabase does from the request's JWT.
create or replace function tests.login(p_name text) returns void
language sql as $$
  select set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-00000000000' || case p_name
    when 'de'      then '1'   -- Division Engineer, Bohol
    when 'dpo'     then '2'   -- Division Planning Officer, Bohol
    when 'de_cbu'  then '3'   -- Division Engineer, Cebu City
    when 'dpo_cbu' then '4'
    when 'ro'      then '5'   -- Regional Office (PPRD)
    when 'admin'   then '6'
    when 'school'  then '7'   -- the account of school 900001 (Bohol)
    when 'co'      then '8'   -- Central Office viewer
  end), false)
$$;

create or replace function tests.logout() returns void
language sql as $$ select set_config('request.jwt.claim.sub', '', false) $$;

create or replace function tests.ok(p_pass boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_pass is not true then
    raise exception 'FAIL: %', p_what;
  end if;
  raise notice 'ok - %', p_what;
end $$;

-- Run a statement and require it to fail with the given SQLSTATE.
create or replace function tests.fails(p_sql text, p_sqlstate text, p_what text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'ok - % (refused: %)', p_what, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % (expected %, got %: %)', p_what, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % (expected error %, but it succeeded)', p_what, p_sqlstate;
end $$;

-- Ids of fixture records, by CO code.
create or replace function tests.b(p_code text) returns bigint
language sql stable security definer set search_path = public as $$
  select id from co_buildings where cycle_id = 'SY2025-2026' and building_code = p_code
$$;

create or replace function tests.r(p_code text) returns bigint
language sql stable security definer set search_path = public as $$
  select min(id) from co_rooms where cycle_id = 'SY2025-2026' and room_code = p_code
$$;

-- The latest validation id of a building or room, for the "what my screen showed" argument.
create or replace function tests.seen_b(p_code text) returns bigint
language sql stable security definer set search_path = public as $$
  select max(id) from building_validations where building_id = tests.b(p_code)
$$;

create or replace function tests.seen_r(p_code text) returns bigint
language sql stable security definer set search_path = public as $$
  select max(id) from room_validations where room_id = tests.r(p_code)
$$;

grant execute on all functions in schema tests to anon, authenticated;
