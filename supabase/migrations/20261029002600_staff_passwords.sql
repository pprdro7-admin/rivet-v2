-- RIVET V2 · 2600 · The Regional Office sets a new password for any account but RO and admin.
-- Supabase's dashboard cannot set a password for an existing user, and its reset email needs the
-- user to receive mail (Ada, 2026-10-29). PPRD (role ro) does it in RIVET instead, as the DPO does
-- for school accounts; PPRD can also do it for a school account (Ada: RO resets for all users). Each reset is kept on record; the password itself is never stored.

create table staff_password_resets (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id),
  reset_by   uuid not null references profiles(id),
  reset_at   timestamptz not null default now()
);
create trigger staff_password_resets_locked before update or delete on staff_password_resets
  for each row execute function forbid_change();
alter table staff_password_resets enable row level security;
create policy read_ro on staff_password_resets for select to authenticated
  using (current_app_role() in ('ro', 'admin'));
grant select on staff_password_resets to authenticated;

-- Every Engineer, Planning Officer, view-only and school account, for the RO's Accounts screen.
create or replace function staff_accounts()
returns table (id uuid, email text, full_name text, role app_role, sdo_code text, sdo_name text, office text, school_id text,
               active boolean, last_sign_in_at timestamptz, has_password boolean, last_reset_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_app_role() is distinct from 'ro' then
    perform refuse('Only the Regional Office sees the accounts', 'insufficient_privilege');
  end if;
  return query
  select p.id, p.email, p.full_name, p.role, p.sdo_code, s.name, p.office, p.school_id, p.active, u.last_sign_in_at,
         coalesce(u.encrypted_password, '') <> '',
         (select max(r.reset_at) from staff_password_resets r where r.user_id = p.id)
  from profiles p
  left join auth.users u on u.id = p.id
  left join sdos s on s.code = p.sdo_code
  where p.role in ('de', 'dpo', 'co', 'school') and p.active
  order by p.sdo_code nulls first, p.role = 'school', p.role, p.full_name;
end $$;
revoke execute on function staff_accounts() from public, anon;

-- Sets the password and makes sure the sign-in works: confirmed, with an email identity.
create or replace function reset_staff_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me profiles;
  v_target profiles;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'ro' then
    perform refuse('Only the Regional Office resets these passwords', 'insufficient_privilege');
  end if;
  select * into v_target from profiles where id = p_user;
  if v_target.id is null then perform refuse('No such account', 'no_data_found'); end if;
  if v_target.role not in ('de', 'dpo', 'co', 'school') then
    perform refuse('RO and administrator passwords are not reset here');
  end if;
  if length(p_password) < 8 or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    perform refuse('The password needs at least 8 characters, with letters and numbers');
  end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
  where id = p_user;
  if not found then perform refuse('This account has no sign-in in Supabase Authentication', 'no_data_found'); end if;
  if not exists (select 1 from auth.identities where user_id = p_user and provider = 'email') then
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), p_user, p_user::text,
      jsonb_build_object('sub', p_user::text, 'email', v_target.email, 'email_verified', true), 'email', null, now(), now());
  end if;
  insert into staff_password_resets (user_id, reset_by) values (p_user, v_me.id);
end $$;
revoke execute on function reset_staff_password(uuid, text) from public, anon;
