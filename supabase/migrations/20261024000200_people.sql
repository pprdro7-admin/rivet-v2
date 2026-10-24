-- RIVET V2 · 0200 · People and roles.
--
-- Roles follow template v3: the Division Engineer validates, the Division Planning Officer checks
-- and submits, the Regional Office signs off each SDO.

create type app_role as enum (
  'de',     -- Division Engineer: validates every building and room of their SDO
  'dpo',    -- Division Planning Officer: checks the DE's work, completes or returns each school
  'ro',     -- Regional Office (PPRD): sees every SDO, signs off an SDO when all its schools are complete
  'admin'   -- accounts only
);

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text not null,
  role       app_role not null,
  sdo_code   text references sdos(code),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check ((role in ('de', 'dpo')) = (sdo_code is not null))
);

-- The signed-in user's active profile, or nothing. Used by every access rule.
create or replace function current_profile() returns profiles
language sql stable security definer set search_path = public as $$
  select p from profiles p where p.id = auth.uid() and p.active
$$;

create or replace function current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function current_sdo() returns text
language sql stable security definer set search_path = public as $$
  select sdo_code from profiles where id = auth.uid() and active
$$;

-- Can the signed-in user see this SDO's records?
create or replace function can_see_sdo(p_sdo text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('ro', 'admin') or current_sdo() = p_sdo, false)
$$;
