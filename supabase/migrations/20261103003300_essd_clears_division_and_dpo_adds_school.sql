-- Ada, 2026-11-03:
-- 1. The ESSD Engineers of the Region (not PPRD) clear a Division once all its schools are Complete:
--    "Cleared by the Region" (the old "sign-off"). PPRD may undo a clearance, with a reason kept on
--    record. A Division can be cleared again after that.
-- 2. The Division Planning Officer adds a school that is new, or that did not submit its NSBI
--    SY 2025-2026, so it can be validated like the others.

-- 1. Clearing a Division ----------------------------------------------------------------------------

-- The table keeps every clearance; sdo_signoffs (the name every check already reads) becomes the
-- view of the clearances still standing.
alter table sdo_signoffs rename to sdo_clearances;
alter table sdo_clearances drop constraint if exists sdo_signoffs_cycle_id_sdo_code_key;

create table sdo_clearance_undos (
  id           bigint generated always as identity primary key,
  clearance_id bigint not null unique references sdo_clearances(id),
  cycle_id     text not null references cycles(id),
  sdo_code     text not null references sdos(code),
  reason       text not null check (length(btrim(reason)) >= 10),
  undone_by    uuid not null references profiles(id),
  undone_at    timestamptz not null default clock_timestamp()
);
create trigger sdo_clearance_undos_append_only before update or delete on sdo_clearance_undos
  for each row execute function forbid_change();

create view sdo_signoffs with (security_invoker = true) as
select c.id, c.cycle_id, c.sdo_code, c.remarks, c.signed_by, c.signed_at
from sdo_clearances c
where not exists (select 1 from sdo_clearance_undos u where u.clearance_id = c.id);

-- Every clearance and undo, for the history shown on the Region screen.
create view sdo_clearance_history with (security_invoker = true) as
select c.cycle_id, c.sdo_code, c.id as clearance_id, c.signed_at as cleared_at, profile_name(c.signed_by) as cleared_by,
       c.remarks, u.undone_at, profile_name(u.undone_by) as undone_by, u.reason as undo_reason
from sdo_clearances c left join sdo_clearance_undos u on u.clearance_id = c.id;

create or replace function is_essd() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'co' and office ilike 'ESSD%' from profiles where id = auth.uid() and active), false)
$$;

create or replace function sign_off_sdo(p_cycle text, p_sdo text, p_remarks text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles;
  v_left bigint;
  v_id bigint;
begin
  v_me := current_profile();
  if not is_essd() then
    perform refuse('The ESSD Engineers of the Region clear a Division', 'insufficient_privilege');
  end if;
  if not exists (select 1 from cycles where id = p_cycle and role = 'current' and frozen_at is null) then
    perform refuse(format('%s is not open for validation', p_cycle));
  end if;
  if exists (select 1 from sdo_signoffs where cycle_id = p_cycle and sdo_code = p_sdo) then
    perform refuse('This Division is already cleared');
  end if;
  select count(*) into v_left from school_tally where cycle_id = p_cycle and sdo_code = p_sdo and not dpo_complete;
  if v_left > 0 then perform refuse(format('%s school(s) of this Division are not yet complete', v_left)); end if;
  insert into sdo_clearances (cycle_id, sdo_code, remarks, signed_by)
  values (p_cycle, p_sdo, nullif(trim(p_remarks), ''), v_me.id) returning id into v_id;
  return v_id;
end $$;

create or replace function undo_sdo_clearance(p_cycle text, p_sdo text, p_reason text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles;
  v_c bigint;
  v_id bigint;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'ro' then perform refuse('PPRD undoes a clearance', 'insufficient_privilege'); end if;
  if exists (select 1 from cycles where id = p_cycle and frozen_at is not null) then
    perform refuse(format('%s is already closed', p_cycle));
  end if;
  select id into v_c from sdo_signoffs where cycle_id = p_cycle and sdo_code = p_sdo;
  if v_c is null then perform refuse('This Division is not cleared'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    perform refuse('Give the reason for undoing the clearance (at least 10 characters)');
  end if;
  insert into sdo_clearance_undos (clearance_id, cycle_id, sdo_code, reason, undone_by)
  values (v_c, p_cycle, p_sdo, btrim(p_reason), v_me.id) returning id into v_id;
  return v_id;
end $$;

-- Plain words in the refusal once a Division is cleared.
create or replace function assert_can_edit(p_cycle text, p_sdo text, p_school text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_me profiles;
  v_cycle cycles;
begin
  v_me := current_profile();
  if v_me.id is null then
    perform refuse('Sign in first', 'insufficient_privilege');
  end if;
  if v_me.role not in ('de', 'dpo', 'school') then
    perform refuse('Only the SDO (Division Engineer or Planning Officer) or the school records this step', 'insufficient_privilege');
  end if;
  if v_me.sdo_code is distinct from p_sdo then
    perform refuse('This school is not in your SDO', 'insufficient_privilege');
  end if;
  if v_me.role = 'school' and v_me.school_id is distinct from p_school then
    perform refuse('You can update only your own school', 'insufficient_privilege');
  end if;
  select * into v_cycle from cycles where id = p_cycle;
  if v_cycle.role <> 'current' or v_cycle.frozen_at is not null then
    perform refuse(format('%s is not open for validation', p_cycle));
  end if;
  if exists (select 1 from sdo_signoffs where cycle_id = p_cycle and sdo_code = p_sdo) then
    perform refuse('This Division is already cleared by the Region: nothing more is recorded unless PPRD undoes the clearance');
  end if;
  return v_me.id;
end $$;


-- sdo_progress followed the table when it was renamed: point it back at the standing clearances.
create or replace view sdo_progress with (security_invoker = true) as
select t.cycle_id, t.sdo_code, s.name as sdo_name,
       count(*)                         as schools,
       sum(t.co_buildings)              as co_buildings,
       sum(t.co_rooms)                  as co_rooms,
       sum(t.flagged_buildings)         as flagged_buildings,
       sum(t.flagged_rooms)             as flagged_rooms,
       sum(t.buildings_with_status)     as buildings_with_status,
       sum(t.rooms_with_status)         as rooms_with_status,
       sum(t.rooms_for_deletion)        as rooms_for_deletion,
       count(*) filter (where t.dpo_complete)            as schools_complete,
       count(*) filter (where t.dpo_result = 'returned') as schools_returned,
       case when sum(t.co_buildings + t.co_rooms) = 0 then 0
            else round(sum(t.buildings_with_status + t.rooms_with_status)::numeric / sum(t.co_buildings + t.co_rooms), 4) end
         as share_validated,
       o.signed_at, o.remarks as signoff_remarks
from school_tally t
join sdos s on s.code = t.sdo_code
left join sdo_signoffs o on o.cycle_id = t.cycle_id and o.sdo_code = t.sdo_code
group by t.cycle_id, t.sdo_code, s.name, o.signed_at, o.remarks;

alter table sdo_clearance_undos enable row level security;
create policy read_scoped on sdo_clearance_undos for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co') or sdo_code = (select current_sdo()));
revoke all on sdo_clearances, sdo_clearance_undos, sdo_signoffs, sdo_clearance_history from anon;
revoke insert, update, delete, truncate on sdo_clearances, sdo_clearance_undos from authenticated;
grant select on sdo_clearances, sdo_clearance_undos, sdo_signoffs, sdo_clearance_history, sdo_progress to authenticated;
revoke execute on function undo_sdo_clearance(text, text, text), is_essd() from public, anon;
grant execute on function undo_sdo_clearance(text, text, text), is_essd() to authenticated;

-- 2. The DPO adds a school ---------------------------------------------------------------------------

create table school_additions (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null check (school_id ~ '^[0-9]{6}$'),
  sdo_code    text not null references sdos(code),
  reason      text not null check (reason in ('new_school', 'no_nsbi_report')),
  remarks     text,
  added_by    uuid not null references profiles(id),
  added_at    timestamptz not null default clock_timestamp(),
  unique (cycle_id, school_id),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create trigger school_additions_append_only before update or delete on school_additions
  for each row execute function forbid_change();

create or replace function add_school(p_cycle text, p_school_id text, p_name text, p_reason text,
                                      p_district text default null, p_municipality text default null,
                                      p_province text default null, p_remarks text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles;
  v_name text;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'dpo' then
    perform refuse('The Division Planning Officer adds a school', 'insufficient_privilege');
  end if;
  if not exists (select 1 from cycles where id = p_cycle and role = 'current' and frozen_at is null) then
    perform refuse(format('%s is not open for validation', p_cycle));
  end if;
  if exists (select 1 from sdo_signoffs where cycle_id = p_cycle and sdo_code = v_me.sdo_code) then
    perform refuse('Your Division is already cleared by the Region');
  end if;
  if coalesce(p_school_id, '') !~ '^[0-9]{6}$' then perform refuse('Give the 6-digit School ID'); end if;
  select school_name into v_name from cycle_schools where cycle_id = p_cycle and school_id = p_school_id;
  if v_name is not null then
    perform refuse(format('School ID %s is already in the list (%s)', p_school_id, v_name));
  end if;
  if nullif(btrim(p_name), '') is null then perform refuse('Give the school name'); end if;
  if p_reason not in ('new_school', 'no_nsbi_report') then
    perform refuse('Say why: a new school, or one that did not submit its NSBI');
  end if;
  insert into cycle_schools (cycle_id, school_id, school_name, sdo_code, district, municipality, province)
  values (p_cycle, p_school_id, btrim(p_name), v_me.sdo_code, nullif(btrim(p_district), ''),
          nullif(btrim(p_municipality), ''), nullif(btrim(p_province), ''));
  insert into school_additions (cycle_id, school_id, sdo_code, reason, remarks, added_by)
  values (p_cycle, p_school_id, v_me.sdo_code, p_reason, nullif(btrim(p_remarks), ''), v_me.id);
  return p_school_id;
end $$;

alter table school_additions enable row level security;
create policy read_scoped on school_additions for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on school_additions from anon;
revoke insert, update, delete, truncate on school_additions from authenticated;
grant select on school_additions to authenticated;
revoke execute on function add_school(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function add_school(text, text, text, text, text, text, text, text) to authenticated;
