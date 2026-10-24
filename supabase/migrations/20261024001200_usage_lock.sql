-- RIVET V2 · 1200 · Rooms that cannot be used take no usage entries (Ada, 24 Oct 2026; the old
-- RIVET's condemned and not-yet-usable conditions). A room that is On-going Construction or
-- condemned, or any room in a building that is For Completion, On-going Construction, condemned
-- or Demolished, is locked: Room Usage and Actual Usage/s cannot be entered or changed. The room still exists and stays in the room tally, but it is not counted
-- as an instructional room, and it is not turned into a Non-Instructional room either.

alter table building_conditions add column locks_usage boolean not null default false;
alter table room_conditions add column locks_usage boolean not null default false;
update building_conditions set locks_usage = true where is_condemned or name in ('For Completion', 'On-going Construction');
update room_conditions set locks_usage = true where is_condemned or name = 'On-going Construction';

-- The building's condition after validation (the DE's latest step, else the NSBI's).
create or replace function building_locks_usage(p_building bigint) returns boolean
language sql stable set search_path = public as $$
  select coalesce((
    select c.locks_usage
    from co_buildings b
    left join building_latest bl on bl.building_id = b.id
    join building_conditions c on c.name = coalesce(bl.validated_condition, b.building_condition)
    where b.id = p_building), false)
$$;

create or replace function room_condition_locks_usage(p_condition text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select locks_usage from room_conditions where name = p_condition), false)
$$;

revoke execute on function building_locks_usage(bigint) from public, anon;
grant execute on function building_locks_usage(bigint) to authenticated;
revoke execute on function room_condition_locks_usage(text) from public, anon;
grant execute on function room_condition_locks_usage(text) to authenticated;

-- A new room in a locked building, or with a locking condition, has no usage.
alter table new_rooms alter column room_usage drop not null;
alter table new_rooms alter column actual_usages set default '{}';

create or replace function record_room_validation(
  p_room          bigint,
  p_seen          bigint,
  p_status        validation_status,
  p_condition     text   default null,
  p_usage         text   default null,
  p_actual_usages text[] default null,
  p_reason        text   default null,
  p_remarks       text   default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  r co_rooms;
  v_me uuid;
  v_last bigint;
  v_id bigint;
  v_remarks text := nullif(trim(p_remarks), '');
  v_actual text[] := case when cardinality(p_actual_usages) > 0 then p_actual_usages end;
  v_unknown text;
  v_final_usage text;
  v_final_actual text[];
  v_locked boolean;
begin
  select * into r from co_rooms where id = p_room;
  if r.id is null then perform refuse('No such room', 'no_data_found'); end if;
  v_me := assert_can_edit(r.cycle_id, r.sdo_code, r.school_id);

  select max(id) into v_last from room_validations where room_id = p_room;
  if v_last is distinct from p_seen then
    perform refuse('This room was updated since your screen loaded: reload and try again', 'serialization_failure');
  end if;

  -- A room that cannot be used (condemned, under construction, or in such a building) takes no usage entries.
  v_locked := room_condition_locks_usage(coalesce(case when p_status = 'corrected' then p_condition end, r.room_condition))
              or building_locks_usage(r.building_id);
  if v_locked and p_status <> 'for_deletion' and (p_usage is not null or v_actual is not null) then
    perform refuse('Usage is locked: the room or its building is condemned or under construction. Leave Room Usage and Actual Usage/s as they are');
  end if;

  select string_agg(u, ', ') into v_unknown
  from unnest(coalesce(v_actual, '{}')) u where not exists (select 1 from actual_usages a where a.name = u);
  if v_unknown is not null then perform refuse('Not an Actual Usage value: ' || v_unknown); end if;

  if p_status = 'correct' then
    if coalesce(p_condition, p_usage, p_reason) is not null or v_actual is not null then
      perform refuse('Correct as is takes no corrections: choose With correction instead');
    end if;
    if r.room_condition is null then
      perform refuse('The NSBI left the room condition blank: give the validated condition (With correction)');
    end if;
    if not v_locked and (r.room_usage is null or cardinality(r.actual_usages) = 0) then
      perform refuse('The NSBI left Room Usage or Actual Usage/s blank: give the validated value (With correction)');
    end if;

  elsif p_status = 'corrected' then
    if p_reason is not null then perform refuse('A deletion reason goes with For deletion only'); end if;
    if p_condition is null and p_usage is null and v_actual is null then
      perform refuse('With correction needs the corrected value: condition, usage or actual usage');
    end if;
    if p_condition is not distinct from r.room_condition then
      perform refuse('Validated room condition is the same as in the NSBI: leave it blank');
    end if;
    if p_usage is not distinct from r.room_usage then
      perform refuse('Validated room usage is the same as in the NSBI: leave it blank');
    end if;
    if v_remarks is null then perform refuse('Give the reason for the correction in REMARKS'); end if;

  else -- for_deletion
    if coalesce(p_condition, p_usage) is not null or v_actual is not null then
      perform refuse('A room for deletion takes no corrections');
    end if;
    if p_reason is null then perform refuse('Choose the reason for deletion'); end if;
    if (select needs_remarks from deletion_reasons where code = p_reason) and v_remarks is null then
      perform refuse('Specify the reason in REMARKS');
    end if;
  end if;

  -- A room that exists but is not used stays in the tally and leaves the instructional count.
  if p_status <> 'for_deletion' and not v_locked then
    v_final_usage  := coalesce(p_usage, r.room_usage);
    v_final_actual := coalesce(v_actual, r.actual_usages);
    if v_final_usage = 'Instructional' and 'Not Currently Used' = any (v_final_actual) then
      perform refuse('A room not currently used is Non-Instructional: set Validated Room Usage to Non-Instructional, or give its real current use');
    end if;
  end if;

  insert into room_validations (room_id, status, validated_condition, validated_usage,
    validated_actual_usages, deletion_reason, remarks, recorded_by)
  values (p_room, p_status, p_condition, p_usage, v_actual, p_reason, v_remarks, v_me)
  returning id into v_id;
  return v_id;
end $$;

create or replace function add_new_room(
  p_building bigint, p_new_building bigint, p_condition text, p_usage text, p_actual_usages text[],
  p_remarks text, p_room_no int default null, p_width numeric default null, p_length numeric default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cycle text; v_school text; v_sdo text;
  v_me uuid;
  v_id bigint;
  v_locked boolean;
begin
  if (p_building is null) = (p_new_building is null) then
    perform refuse('Give either the existing building or the new building');
  end if;
  if p_building is not null then
    select cycle_id, school_id, sdo_code into v_cycle, v_school, v_sdo from co_buildings where id = p_building;
  else
    select cycle_id, school_id, sdo_code into v_cycle, v_school, v_sdo from live_new_buildings where id = p_new_building;
  end if;
  if v_school is null then perform refuse('No such building', 'no_data_found'); end if;
  v_me := assert_can_edit(v_cycle, v_sdo, v_school);
  if nullif(trim(p_remarks), '') is null then perform refuse('Say in REMARKS why this room is not in the NSBI'); end if;
  v_locked := room_condition_locks_usage(p_condition)
              or (p_building is not null and building_locks_usage(p_building))
              or (p_new_building is not null and exists (
                    select 1 from live_new_buildings nb join building_conditions c on c.name = nb.building_condition
                    where nb.id = p_new_building and c.locks_usage));
  if v_locked then
    if p_usage is not null or coalesce(cardinality(p_actual_usages), 0) > 0 then
      perform refuse('Usage is locked: the room or its building is condemned or under construction. Leave Room Usage and Actual Usage/s blank');
    end if;
  elsif p_usage is null then
    perform refuse('Give the room usage');
  elsif coalesce(cardinality(p_actual_usages), 0) = 0 then
    perform refuse('Give the room''s actual usage');
  end if;
  if exists (select 1 from unnest(p_actual_usages) u where not exists (select 1 from actual_usages a where a.name = u)) then
    perform refuse('Not an Actual Usage value');
  end if;
  if p_usage = 'Instructional' and 'Not Currently Used' = any (p_actual_usages) then
    perform refuse('A room not currently used is Non-Instructional');
  end if;
  insert into new_rooms (cycle_id, school_id, sdo_code, building_id, new_building_id, room_no, room_condition,
    room_usage, actual_usages, width_m, length_m, remarks, recorded_by)
  values (v_cycle, v_school, v_sdo, p_building, p_new_building, p_room_no, p_condition, p_usage,
    coalesce(p_actual_usages, '{}'), p_width, p_length, trim(p_remarks), v_me)
  returning id into v_id;
  return v_id;
end $$;

create or replace view room_status with (security_invoker = true) as
select r.id as room_id, r.cycle_id, r.sdo_code, r.school_id, r.building_id, r.building_code,
       r.room_code, r.room_no, r.room_condition, r.room_usage, r.actual_usages,
       rl.id as last_validation_id, rl.status, rl.deletion_reason, rl.remarks,
       rl.recorded_by, rl.recorded_at,
       coalesce(rl.validated_condition, r.room_condition)    as final_condition,
       coalesce(rl.validated_usage, r.room_usage)            as final_usage,
       coalesce(rl.validated_actual_usages, r.actual_usages) as final_actual_usages,
       coalesce(bl.status = 'for_deletion', false)           as building_for_deletion,
       -- "red" in the template: the building is for deletion but this room is still kept
       coalesce(bl.status = 'for_deletion', false)
         and rl.status is distinct from 'for_deletion'       as needs_room_decision,
       (select max(v.id) from room_validations v where v.room_id = r.id) as last_step_id,
       coalesce(rc.locks_usage, false) or coalesce(bc.locks_usage, false) as usage_locked
from co_rooms r
left join room_latest rl on rl.room_id = r.id
left join building_latest bl on bl.building_id = r.building_id
left join room_conditions rc on rc.name = coalesce(rl.validated_condition, r.room_condition)
left join co_buildings cb on cb.id = r.building_id
left join building_conditions bc on bc.name = coalesce(bl.validated_condition, cb.building_condition);

create or replace view school_tally with (security_invoker = true) as
with b as (
  select cycle_id, school_id,
         count(*) as co_buildings,
         count(*) filter (where status is distinct from 'for_deletion') as kept_buildings,
         count(*) filter (where status is not null) as buildings_with_status,
         max(recorded_at) as last_at
  from building_status group by cycle_id, school_id
), r as (
  select cycle_id, school_id,
         count(*) as co_rooms,
         count(*) filter (where room_usage = 'Instructional') as co_instructional,
         count(*) filter (where status is distinct from 'for_deletion') as kept_rooms,
         count(*) filter (where status is distinct from 'for_deletion' and final_usage = 'Instructional'
                          and not usage_locked) as kept_instructional,
         count(*) filter (where status = 'for_deletion') as rooms_for_deletion,
         count(*) filter (where status is not null) as rooms_with_status,
         count(*) filter (where needs_room_decision) as rooms_needing_decision,
         max(recorded_at) as last_at
  from room_status group by cycle_id, school_id
), nb as (
  select cycle_id, school_id, count(*) as n, max(recorded_at) as last_at from live_new_buildings group by 1, 2
), nr as (
  select cycle_id, school_id, count(*) as n,
         count(*) filter (where room_usage = 'Instructional') as instructional,
         max(recorded_at) as last_at
  from live_new_rooms group by 1, 2
), fb as (
  select cycle_id, school_id, count(distinct building_id) as n from building_flags group by 1, 2
), fr as (
  select cycle_id, school_id, count(distinct room_id) as n from room_flags group by 1, 2
), dc as (
  select distinct on (cycle_id, school_id) cycle_id, school_id, result, remarks, recorded_at
  from dpo_checks order by cycle_id, school_id, id desc
)
select s.cycle_id, s.sdo_code, s.district, s.school_id, s.school_name,
       coalesce(b.co_buildings, 0)       as co_buildings,
       coalesce(r.co_rooms, 0)           as co_rooms,
       coalesce(r.co_instructional, 0)   as co_instructional_rooms,
       coalesce(fb.n, 0)                 as flagged_buildings,
       coalesce(fr.n, 0)                 as flagged_rooms,
       coalesce(b.kept_buildings, 0) + coalesce(nb.n, 0)            as buildings_after,
       coalesce(r.kept_rooms, 0) + coalesce(nr.n, 0)                as rooms_after,
       coalesce(r.kept_instructional, 0) + coalesce(nr.instructional, 0) as instructional_rooms_after,
       coalesce(r.rooms_for_deletion, 0) as rooms_for_deletion,
       coalesce(b.buildings_with_status, 0) as buildings_with_status,
       coalesce(r.rooms_with_status, 0)     as rooms_with_status,
       coalesce(r.rooms_needing_decision, 0) as rooms_needing_decision,
       case when coalesce(b.co_buildings, 0) + coalesce(r.co_rooms, 0) = 0 then 0
            else round((coalesce(b.buildings_with_status, 0) + coalesce(r.rooms_with_status, 0))::numeric
                       / (coalesce(b.co_buildings, 0) + coalesce(r.co_rooms, 0)), 4) end as share_validated,
       dc.result as dpo_result, dc.remarks as dpo_remarks, dc.recorded_at as dpo_checked_at,
       -- a later step by the DE reopens the school until the DPO checks it again
       coalesce(dc.result = 'complete'
                and dc.recorded_at > coalesce(greatest(b.last_at, r.last_at, nb.last_at, nr.last_at), '-infinity'),
                false) as dpo_complete
from cycle_schools s
left join b  using (cycle_id, school_id)
left join r  using (cycle_id, school_id)
left join nb using (cycle_id, school_id)
left join nr using (cycle_id, school_id)
left join fb using (cycle_id, school_id)
left join fr using (cycle_id, school_id)
left join dc using (cycle_id, school_id);
