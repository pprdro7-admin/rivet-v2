-- RIVET V2 · 0400 · Tally, RO flags, DPO check, RO sign-off and the validated baseline.
--
-- Everything here is computed from the CO data and the validation steps; nothing is typed.
-- The tally flows from Table 2 to Table 1: a building's validated room count is its rooms not
-- for deletion plus its new rooms.

-- ── Each record with its latest step and final values ───────────────────────────────────────

create view room_status with (security_invoker = true) as
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
         and rl.status is distinct from 'for_deletion'       as needs_room_decision
from co_rooms r
left join room_latest rl on rl.room_id = r.id
left join building_latest bl on bl.building_id = r.building_id;

create view building_status with (security_invoker = true) as
with listed as (
  select building_id,
         count(*) as listed_rooms,
         count(*) filter (where rl.status is distinct from 'for_deletion') as kept_rooms
  from co_rooms r left join room_latest rl on rl.room_id = r.id
  where building_id is not null
  group by building_id
), added as (
  select building_id, count(*) as new_rooms from live_new_rooms where building_id is not null group by building_id
)
select b.id as building_id, b.cycle_id, b.sdo_code, b.school_id, b.building_code, b.building_no,
       b.building_type, b.building_condition, b.number_of_rooms, b.longitude, b.latitude,
       bl.id as last_validation_id, bl.status, bl.deletion_reason, bl.remarks,
       bl.recorded_by, bl.recorded_at,
       coalesce(bl.validated_condition, b.building_condition) as final_condition,
       coalesce(bl.correct_longitude, b.longitude)            as final_longitude,
       coalesce(bl.correct_latitude, b.latitude)              as final_latitude,
       coalesce(l.listed_rooms, 0)                            as listed_rooms,
       coalesce(l.kept_rooms, 0) + coalesce(a.new_rooms, 0)   as validated_rooms,
       case
         when bl.status = 'for_deletion' then 'Building for deletion'
         when coalesce(l.kept_rooms, 0) + coalesce(a.new_rooms, 0) = coalesce(b.number_of_rooms, 0)
           then format('Same as CO (%s)', coalesce(b.number_of_rooms, 0))
         else format('Changed: CO %s -> now %s', coalesce(b.number_of_rooms, 0),
                     coalesce(l.kept_rooms, 0) + coalesce(a.new_rooms, 0))
       end as tally_check
from co_buildings b
left join building_latest bl on bl.building_id = b.id
left join listed l on l.building_id = b.id
left join added a on a.building_id = b.id;

-- ── RO auto-flags: where to start, not the only records to validate ─────────────────────────
-- Same checks and wording as the v5 workbook, computed from the CO values.

create view room_flags with (security_invoker = true) as
with r as (
  select cr.*,
         'Not Currently Used' = any (cr.actual_usages) as not_used,
         exists (select 1 from unnest(cr.actual_usages) u join actual_usages a on a.name = u where a.kind = 'classroom') as has_classroom,
         cardinality(cr.actual_usages) > 0
           and not exists (select 1 from unnest(cr.actual_usages) u
                           left join actual_usages a on a.name = u
                           where coalesce(a.kind, 'neutral') <> 'non_instructional') as non_instructional_only,
         coalesce(bc.is_condemned, false) as in_condemned_building,
         coalesce(rc.is_condemned, false) as room_condemned
  from co_rooms cr
  left join building_conditions bc on bc.name = cr.building_condition
  left join room_conditions rc on rc.name = cr.room_condition
), repeated as (
  select cycle_id, room_code from co_rooms where room_code is not null
  group by cycle_id, room_code having count(*) > 1
)
select r.id as room_id, r.cycle_id, r.sdo_code, r.school_id, f.who, f.flag
from r
cross join lateral (values
  ('DE', case when r.room_usage = 'Instructional' and r.not_used and cardinality(r.actual_usages) = 1
              then 'Usage: Instructional but actual usage is ''Not Currently Used''' end),
  ('DE', case when r.not_used and cardinality(r.actual_usages) > 1
              then 'Usage: ''Not Currently Used'' together with other usage' end),
  ('DE', case when r.room_usage = 'Instructional' and r.non_instructional_only
              then 'Usage: Instructional but actual usage is non-instructional only' end),
  ('DE', case when r.room_usage = 'Non-Instructional' and r.has_classroom
              then 'Usage: Non-Instructional but actual usage includes a classroom' end),
  ('DE', case when r.room_usage is null or cardinality(r.actual_usages) = 0
              then 'Usage: Room Usage or Actual Usage/s blank' end),
  ('DE', case when r.room_usage = 'Instructional' and r.in_condemned_building
              then 'Status: Instructional room in a building tagged ' || r.building_condition end),
  ('DE', case when r.room_usage = 'Instructional' and r.room_condemned and not r.in_condemned_building
              then 'Status: Instructional room tagged ' || r.room_condition end),
  ('DE', case when r.room_condition = 'Good Condition' and r.in_condemned_building
              then 'Status: Good room condition in a condemned/demolished building' end),
  ('DE', case when r.room_condition is null then 'Status: room condition blank' end),
  ('DPO', case when r.room_code is null then 'Room code blank' end),
  ('DPO', case when exists (select 1 from repeated x where x.cycle_id = r.cycle_id and x.room_code = r.room_code)
               then 'Room code repeated' end),
  ('DPO', case when r.room_code is not null and r.building_code is not null
                and left(r.room_code, length(r.building_code)) <> r.building_code
               then 'Room code does not start with building code' end)
) as f(who, flag)
where f.flag is not null;

create view building_flags with (security_invoker = true) as
with rooms as (
  select building_id, count(*) as listed,
         count(*) filter (where room_usage = 'Instructional') as instructional
  from co_rooms where building_id is not null group by building_id
)
select b.id as building_id, b.cycle_id, b.sdo_code, b.school_id, f.who, f.flag
from co_buildings b
left join rooms r on r.building_id = b.id
left join building_conditions bc on bc.name = b.building_condition
cross join lateral (values
  ('DE', case when coalesce(b.number_of_rooms, 0) = 0 then 'Tally: building has 0 rooms' end),
  ('DE', case when coalesce(b.number_of_rooms, 0) > 0 and b.number_of_rooms <> coalesce(r.listed, 0)
              then format('Tally: Number of Rooms %s but %s room(s) listed in T2', b.number_of_rooms, coalesce(r.listed, 0)) end),
  ('DE', case when bc.is_condemned and coalesce(r.instructional, 0) > 0
              then format('Status: %s but %s room(s) still Instructional in T2', b.building_condition, r.instructional) end),
  ('DE', case when b.building_condition is null then 'Status: building condition blank' end)
) as f(who, flag)
where f.flag is not null;

-- ── Per school: counts, progress and the DPO check ─────────────────────────────────────────

create view school_tally with (security_invoker = true) as
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
         count(*) filter (where status is distinct from 'for_deletion' and final_usage = 'Instructional') as kept_instructional,
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

-- What still stops a school from being complete (the DPO's final checks 1 and 4).
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
$$;

create or replace function record_dpo_check(p_cycle text, p_school text, p_result text, p_remarks text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s cycle_schools;
  v_me uuid;
  v_open text;
  v_id bigint;
begin
  select * into s from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if s.school_id is null then perform refuse('No such school in this cycle', 'no_data_found'); end if;
  if not can_see_sdo(s.sdo_code) then perform refuse('This school is not in your SDO', 'insufficient_privilege'); end if;
  v_me := assert_open_for(p_cycle, s.sdo_code, 'dpo');
  if p_result not in ('complete', 'returned') then perform refuse('Complete or Returned to DE'); end if;
  if p_result = 'returned' and nullif(trim(p_remarks), '') is null then
    perform refuse('Say in DPO remarks what the DE should fix');
  end if;
  if p_result = 'complete' then
    select string_agg(format('%s: %s', item, n), '; ') into v_open
    from school_open_items(p_cycle, p_school) where n > 0;
    if v_open is not null then perform refuse('Not complete yet. ' || v_open); end if;
  end if;
  insert into dpo_checks (cycle_id, school_id, result, remarks, recorded_by)
  values (p_cycle, p_school, p_result, nullif(trim(p_remarks), ''), v_me)
  returning id into v_id;
  return v_id;
end $$;

-- The RO signs off an SDO once every one of its schools is complete. Nothing more is recorded for it.
create or replace function sign_off_sdo(p_cycle text, p_sdo text, p_remarks text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles;
  v_left bigint;
  v_id bigint;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'ro' then perform refuse('Only the Regional Office signs off an SDO', 'insufficient_privilege'); end if;
  if not exists (select 1 from cycles where id = p_cycle and role = 'current' and frozen_at is null) then
    perform refuse(format('%s is not open for validation', p_cycle));
  end if;
  select count(*) into v_left from school_tally where cycle_id = p_cycle and sdo_code = p_sdo and not dpo_complete;
  if v_left > 0 then perform refuse(format('%s school(s) of this SDO are not yet complete', v_left)); end if;
  insert into sdo_signoffs (cycle_id, sdo_code, remarks, signed_by)
  values (p_cycle, p_sdo, nullif(trim(p_remarks), ''), v_me.id) returning id into v_id;
  return v_id;
end $$;

-- Once every SDO is signed off, the RO freezes the cycle: its validated baseline becomes the
-- reference for later NSBI reporting.
create or replace function freeze_cycle(p_cycle text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles;
  v_left text;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'ro' then perform refuse('Only the Regional Office freezes a cycle', 'insufficient_privilege'); end if;
  select string_agg(distinct s.sdo_code, ', ') into v_left
  from cycle_schools s
  where s.cycle_id = p_cycle
    and not exists (select 1 from sdo_signoffs o where o.cycle_id = p_cycle and o.sdo_code = s.sdo_code);
  if v_left is not null then perform refuse('Not yet signed off: ' || v_left); end if;
  update cycles set frozen_at = now(), frozen_by = v_me.id where id = p_cycle and frozen_at is null;
end $$;

-- ── The validated baseline ──────────────────────────────────────────────────────────────────
-- CO records not for deletion, with corrections applied, plus the new records. Records for
-- deletion stay in the CO tables and their validation history; they are only left out here.

create view baseline_buildings with (security_invoker = true) as
select cycle_id, sdo_code, school_id, 'CO' as origin, building_id, null::bigint as new_building_id,
       building_code, building_no, building_type, final_condition as building_condition,
       validated_rooms as number_of_rooms, final_longitude as longitude, final_latitude as latitude
from building_status where status is distinct from 'for_deletion'
union all
select nb.cycle_id, nb.sdo_code, nb.school_id, 'New', null, nb.id,
       null, nb.building_no, nb.building_type, nb.building_condition,
       (select count(*) from live_new_rooms nr where nr.new_building_id = nb.id),
       nb.longitude, nb.latitude
from live_new_buildings nb;

create view baseline_rooms with (security_invoker = true) as
select cycle_id, sdo_code, school_id, 'CO' as origin, room_id, null::bigint as new_room_id,
       building_id, null::bigint as new_building_id, room_code, room_no,
       final_condition as room_condition, final_usage as room_usage, final_actual_usages as actual_usages
from room_status where status is distinct from 'for_deletion'
union all
select cycle_id, sdo_code, school_id, 'New', null, id, building_id, new_building_id, null, room_no,
       room_condition, room_usage, actual_usages
from live_new_rooms;
