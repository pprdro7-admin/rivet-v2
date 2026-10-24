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

-- The columns Supabase Auth keeps for an email-and-password user, and its identities table, so a
-- school account created by the DPO (migration 1700) is made the same way here. pgcrypto lives in
-- the `extensions` schema on Supabase.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
alter table auth.users
  add column if not exists instance_id uuid,
  add column if not exists aud text,
  add column if not exists role text,
  add column if not exists encrypted_password text,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists raw_app_meta_data jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists confirmation_token text,
  add column if not exists recovery_token text,
  add column if not exists email_change_token_new text,
  add column if not exists email_change text;
create table if not exists auth.identities (
  id              uuid primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider_id     text not null,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  unique (provider_id, provider)
);
