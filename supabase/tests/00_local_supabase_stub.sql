-- LOCAL TESTING ONLY. Never applied to Supabase.
--
-- Supabase already provides the `auth` schema, `auth.uid()`, and the `anon` / `authenticated`
-- roles. A plain Postgres (on a laptop or in GitHub Actions) does not, so this file recreates the
-- minimum the migrations and tests rely on, with the same names and behaviour.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique not null,
  raw_user_meta_data jsonb not null default '{}'
);

-- Supabase reads the signed-in user from the request's JWT claims: tests set the single-claim
-- setting, the local web server (PostgREST) sets the whole claims object. Same as Supabase.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Supabase grants every new public table to these roles by default and relies on row-level
-- security to restrict them. Mirror that here, so the tests prove RLS (not missing grants) is
-- what keeps people out.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
