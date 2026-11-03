-- Table 4A per building (Ada, 2026-11-03): the WATSAN attached to a building is counted on that
-- building's row, its Building Number being the one in Table 1, so a school cannot over or under
-- declare. A building set for deletion carries none; one For Condemnation, Condemned / For Demolition
-- or Demolished is flagged for the Engineer. Table 4B (stand-alone) stays in school_table_entries.
-- The school's Table 4A total is the sum of its building rows.

create table building_watsan_entries (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  building_no int  not null,
  measures    jsonb,                        -- null with removed: the building has no WATSAN after all
  removed     boolean not null default false,
  remarks     text,
  by_school   boolean not null default made_by_school(),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create index on building_watsan_entries (cycle_id, school_id, building_no, id);
create trigger building_watsan_entries_append_only before update or delete on building_watsan_entries
  for each row execute function forbid_change();

-- The Table 4A items, as the memo numbers them (Cols. 2 to 12).
create or replace function watsan_keys() returns text[]
language sql immutable as $$
  select array['toilet_male', 'toilet_female', 'toilet_pwd', 'toilet_shared', 'nonfunc_toilet', 'sink',
               'urinal', 'urinal_trough', 'septic_tank', 'faucet_with_water', 'faucet_without_water']
$$;

-- Is the building set for deletion in the validated record?
create or replace function building_for_deletion_now(p_cycle text, p_school text, p_no int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select bl.status = 'for_deletion'
                     from co_buildings b join building_latest bl on bl.building_id = b.id
                    where b.cycle_id = p_cycle and b.school_id = p_school and b.building_no = p_no
                    order by b.id limit 1), false)
$$;

create or replace function record_building_watsan(
  p_cycle text, p_school text, p_building_no int, p_seen bigint, p_measures jsonb,
  p_removed boolean default false, p_remarks text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s cycle_schools;
  v_me uuid;
  v_last bigint;
  v_bad text;
  v_id bigint;
begin
  select * into s from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if s.school_id is null then perform refuse('That school is not in this cycle''s NSBI data', 'no_data_found'); end if;
  v_me := assert_can_edit(p_cycle, s.sdo_code, p_school);

  if not building_no_used(p_cycle, p_school, p_building_no) then
    perform refuse(format('Building %s is not in this school''s Table 1: add the building first', p_building_no));
  end if;
  if not p_removed and building_for_deletion_now(p_cycle, p_school, p_building_no) then
    perform refuse(format('Building %s is set for deletion, so it carries no WATSAN', p_building_no));
  end if;

  select max(id) into v_last from building_watsan_entries
   where cycle_id = p_cycle and school_id = p_school and building_no = p_building_no;
  if v_last is distinct from p_seen then
    perform refuse('This building''s WATSAN was updated since your screen loaded: reload and try again', 'serialization_failure');
  end if;

  if p_removed then
    if v_last is null then perform refuse('This building has no WATSAN entry to remove'); end if;
  else
    if jsonb_typeof(p_measures) is distinct from 'object' then perform refuse('Give the building''s WATSAN counts'); end if;
    select string_agg(key, ', ') into v_bad from jsonb_each(p_measures)
     where key <> all (watsan_keys())
        or not (jsonb_typeof(value) = 'null'
                or (jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric >= 0
                    and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
                    and (key <> 'septic_tank' or (value #>> '{}')::numeric in (0, 1))));
    if v_bad is not null then perform refuse('Give whole numbers, 0 or more (septic tank: Yes or No): ' || v_bad); end if;
    if not exists (select 1 from jsonb_each(p_measures) where jsonb_typeof(value) <> 'null') then
      perform refuse('Fill in at least one item');
    end if;
  end if;

  insert into building_watsan_entries (cycle_id, school_id, sdo_code, building_no, measures, removed, remarks, recorded_by)
  values (p_cycle, p_school, s.sdo_code, p_building_no, case when p_removed then null else p_measures end,
          p_removed, nullif(trim(p_remarks), ''), v_me)
  returning id into v_id;
  return v_id;
end $$;

-- Per building: the validated row (the SDO's latest), a school's update waiting after it, the latest
-- step id, and the flag when the building's condition means its WATSAN should be checked.
create view building_watsan_status with (security_invoker = true) as
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
           then format('The building is %s: check that this WATSAN is still in use', building_condition_now(k.cycle_id, k.school_id, k.building_no))
       end as flag
from k
left join v using (cycle_id, school_id, building_no)
join w using (cycle_id, school_id, building_no);

alter table building_watsan_entries enable row level security;
create policy read_scoped on building_watsan_entries for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on building_watsan_entries, building_watsan_status from anon;
revoke insert, update, delete, truncate on building_watsan_entries from authenticated;
grant select on building_watsan_entries, building_watsan_status to authenticated;
revoke execute on function record_building_watsan(text, text, int, bigint, jsonb, boolean, text) from public, anon;
grant execute on function record_building_watsan(text, text, int, bigint, jsonb, boolean, text) to authenticated;
revoke execute on function building_for_deletion_now(text, text, int) from public, anon;
grant execute on function building_for_deletion_now(text, text, int) to authenticated;
grant execute on function building_condition_now(text, text, int) to authenticated;
