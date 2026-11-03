-- Ada, 2026-11-03:
-- 1. Every Table 1 building is answered in Table 4A: its counts, or "No WATSAN" (all 0). A building
--    not yet answered keeps the school from being marked Complete, so none is skipped.
--    (Schools already marked Complete stay Complete.)
-- 2. School heads may make the first placing of the site sketch; the Engineer checks it on site and
--    confirms it. A school's change after the last confirmation shows as not yet confirmed.

-- 1. Table 4A answered for every building -----------------------------------------------------------

create or replace function school_open_items(p_cycle text, p_school text)
returns table (item text, n bigint)
language sql stable security definer set search_path = public as $$
  select 'Buildings without a status', count(*) from building_status
   where cycle_id = p_cycle and school_id = p_school and status is null
  union all
  select 'Rooms without a status', count(*) from room_status
   where cycle_id = p_cycle and school_id = p_school and status is null
  union all
  select 'Rooms kept in a building for deletion', count(*) from room_status
   where cycle_id = p_cycle and school_id = p_school and needs_room_decision
  union all
  select 'Buildings not yet answered in Table 4A (WATSAN, or No WATSAN)', count(*) from (
    select building_no from building_status
     where cycle_id = p_cycle and school_id = p_school and status is distinct from 'for_deletion'
    union
    select building_no from live_new_buildings where cycle_id = p_cycle and school_id = p_school
  ) b
   where not exists (select 1 from building_watsan_status w
                      where w.cycle_id = p_cycle and w.school_id = p_school
                        and w.building_no = b.building_no and w.validated is not null)
$$;

-- A building answered "No WATSAN" (all 0) is not flagged for its condition: nothing is in use there.
create or replace view building_watsan_status with (security_invoker = true) as
with k as (
  select cycle_id, school_id, building_no, max(id) as last_step_id from building_watsan_entries group by 1, 2, 3
), v as (
  select distinct on (cycle_id, school_id, building_no) * from building_watsan_entries
  where not by_school order by cycle_id, school_id, building_no, id desc
), w as (
  select distinct on (cycle_id, school_id, building_no) * from building_watsan_entries
  order by cycle_id, school_id, building_no, id desc
)
select k.cycle_id, k.school_id, w.sdo_code, k.building_no, k.last_step_id,
       case when not coalesce(v.removed, true) then v.measures end as validated,
       v.remarks as validated_remarks, v.recorded_at as validated_at,
       case when w.by_school then w.measures end as school_update,
       case when w.by_school then w.removed end as school_update_removes,
       case when w.by_school then w.remarks end as school_update_remarks,
       building_condition_now(k.cycle_id, k.school_id, k.building_no) as building_condition,
       case
         when building_for_deletion_now(k.cycle_id, k.school_id, k.building_no) and not coalesce(v.removed, true)
           then 'The building is set for deletion: remove its WATSAN row or move it to the right building'
         when building_condition_now(k.cycle_id, k.school_id, k.building_no)
                in ('For Condemnation', 'Condemned / For Demolition', 'Demolished') and not coalesce(v.removed, true)
              and exists (select 1 from jsonb_each(v.measures) where (value #>> '{}')::numeric > 0)
           then format('The building is %s: check that this WATSAN is still in use', building_condition_now(k.cycle_id, k.school_id, k.building_no))
       end as flag
from k
left join v using (cycle_id, school_id, building_no)
join w using (cycle_id, school_id, building_no);

-- 2. The school's first placing of the sketch, confirmed by the Engineer ----------------------------

alter table sketch_items add column by_school boolean not null default made_by_school();
alter table school_sites add column by_school boolean not null default made_by_school();

create or replace function sketch_editor(p_cycle text, p_school text) returns record
language plpgsql security definer set search_path = public as $$
declare
  v_sdo text;
  v_me  uuid;
  r     record;
begin
  select sdo_code into v_sdo from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if v_sdo is null then perform refuse('No such school in this cycle', 'no_data_found'); end if;
  v_me := assert_can_edit(p_cycle, v_sdo, p_school);   -- DE, DPO, or the school's own account
  select v_sdo as sdo_code, v_me as me into r;
  return r;
end $$;
revoke execute on function sketch_editor(text, text) from public, anon, authenticated;

create table sketch_confirmations (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create trigger sketch_confirmations_append_only before update or delete on sketch_confirmations
  for each row execute function forbid_change();

create or replace function confirm_sketch(p_cycle text, p_school text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_id bigint;
begin
  select * into e from sketch_editor(p_cycle, p_school) as (sdo_code text, me uuid);
  if (select role from profiles where id = e.me) = 'school' then
    perform refuse('The Division Engineer confirms the sketch after checking it on site', 'insufficient_privilege');
  end if;
  if not exists (select 1 from sketch_items where cycle_id = p_cycle and school_id = p_school) then
    perform refuse('Nothing is placed on the sketch yet');
  end if;
  insert into sketch_confirmations (cycle_id, school_id, sdo_code, recorded_by)
  values (p_cycle, p_school, e.sdo_code, e.me) returning id into v_id;
  return v_id;
end $$;

-- Per school: who last changed the sketch, and whether a school's change waits for confirmation.
create view sketch_state with (security_invoker = true) as
with ch as (
  select cycle_id, school_id, recorded_at, by_school, recorded_by from sketch_items
  union all
  select cycle_id, school_id, recorded_at, by_school, recorded_by from school_sites
), last_school as (
  select cycle_id, school_id, max(recorded_at) as at from ch where by_school group by 1, 2
), last_any as (
  select distinct on (cycle_id, school_id) cycle_id, school_id, recorded_at as at, recorded_by from ch
  order by cycle_id, school_id, recorded_at desc
), conf as (
  select distinct on (cycle_id, school_id) cycle_id, school_id, recorded_at as at, recorded_by from sketch_confirmations
  order by cycle_id, school_id, recorded_at desc
)
select a.cycle_id, a.school_id, a.at as changed_at, ls.at as school_changed_at,
       c.at as confirmed_at, p.full_name as confirmed_by,
       (ls.at is not null and (c.at is null or ls.at > c.at)) as waits_for_engineer
from last_any a
left join last_school ls using (cycle_id, school_id)
left join conf c using (cycle_id, school_id)
left join profiles p on p.id = c.recorded_by;

alter table sketch_confirmations enable row level security;
create policy read_scoped on sketch_confirmations for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on sketch_confirmations, sketch_state from anon;
revoke insert, update, delete, truncate on sketch_confirmations from authenticated;
grant select on sketch_confirmations, sketch_state to authenticated;
revoke execute on function confirm_sketch(text, text) from public, anon;
grant execute on function confirm_sketch(text, text) to authenticated;
