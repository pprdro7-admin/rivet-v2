-- RIVET V2 · 1100 · Pilot: schools update their own records, the DPO edits beside the DE, and the
-- screens speak of the NSBI instead of CO.
--
-- For the pilot (SDO Lapu-Lapu City, Toledo City and City of Naga, Cebu), the DPO may record the
-- same steps as the DE. A school account sees and updates only its own School ID. A school's step
-- is kept as a school update: it does not count as validated until the DE or DPO accepts it or
-- records their own step, so the validation stays with the SDO.

-- ── School accounts ─────────────────────────────────────────────────────────────────────────

alter table profiles add column school_id text;
alter table profiles drop constraint profiles_check;
alter table profiles add constraint profiles_scope_check check (
  (role in ('de', 'dpo', 'school')) = (sdo_code is not null)
  and (role = 'school') = (school_id is not null));

create or replace function current_school() returns text
language sql stable security definer set search_path = public as $$
  select school_id from profiles where id = auth.uid() and active
$$;

-- Who made a step: kept on each step, so a school's update is told apart from the SDO's validation.
create or replace function made_by_school() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'school' from profiles where id = auth.uid()), false)
$$;
alter table building_validations add column by_school boolean not null default made_by_school();
alter table room_validations     add column by_school boolean not null default made_by_school();
alter table new_buildings        add column by_school boolean not null default made_by_school();
alter table new_rooms            add column by_school boolean not null default made_by_school();

-- ── Who may record a step ───────────────────────────────────────────────────────────────────

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
    perform refuse('This SDO is already signed off by the Regional Office');
  end if;
  return v_me.id;
end $$;

create or replace function record_building_validation(
  p_building  bigint,
  p_seen      bigint,
  p_status    validation_status,
  p_condition text    default null,
  p_longitude numeric default null,
  p_latitude  numeric default null,
  p_reason    text    default null,
  p_remarks   text    default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  b co_buildings;
  v_me uuid;
  v_last bigint;
  v_id bigint;
  v_remarks text := nullif(trim(p_remarks), '');
begin
  select * into b from co_buildings where id = p_building;
  if b.id is null then perform refuse('No such building', 'no_data_found'); end if;
  v_me := assert_can_edit(b.cycle_id, b.sdo_code, b.school_id);

  select max(id) into v_last from building_validations where building_id = p_building;
  if v_last is distinct from p_seen then
    perform refuse('This building was updated since your screen loaded: reload and try again', 'serialization_failure');
  end if;

  if p_status = 'correct' then
    if coalesce(p_condition, p_reason) is not null or p_longitude is not null or p_latitude is not null then
      perform refuse('Correct as is takes no corrections: choose With correction instead');
    end if;
    if b.building_condition is null then
      perform refuse('The NSBI left the building condition blank: give the validated condition (With correction)');
    end if;

  elsif p_status = 'corrected' then
    if p_reason is not null then perform refuse('A deletion reason goes with For deletion only'); end if;
    if p_condition is null and p_longitude is null and p_latitude is null then
      perform refuse('With correction needs the corrected value: condition or coordinates');
    end if;
    if p_condition is not distinct from b.building_condition then
      perform refuse('Validated condition is the same as in the NSBI: leave it blank');
    end if;
    if (p_longitude is null) <> (p_latitude is null) then
      perform refuse('Give both the correct longitude and latitude');
    end if;
    if p_longitude is not null and not in_region_vii(p_longitude, p_latitude) then
      perform refuse('Those coordinates are outside Region VII: check longitude (about 123-125) and latitude (about 9-11)');
    end if;
    if v_remarks is null then perform refuse('Give the reason for the correction in REMARKS'); end if;

  else -- for_deletion
    if p_condition is not null or p_longitude is not null or p_latitude is not null then
      perform refuse('A building for deletion takes no corrections');
    end if;
    if b.building_condition = 'Demolished' then
      perform refuse('Demolished buildings are kept, not deleted: their condition already records it');
    end if;
    if p_reason is null then perform refuse('Choose the reason for deletion'); end if;
    if (select needs_remarks from deletion_reasons where code = p_reason) and v_remarks is null then
      perform refuse('Specify the reason in REMARKS');
    end if;
  end if;

  insert into building_validations (building_id, status, validated_condition, correct_longitude,
    correct_latitude, deletion_reason, remarks, recorded_by)
  values (p_building, p_status, p_condition, p_longitude, p_latitude, p_reason, v_remarks, v_me)
  returning id into v_id;
  return v_id;
end $$;

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
begin
  select * into r from co_rooms where id = p_room;
  if r.id is null then perform refuse('No such room', 'no_data_found'); end if;
  v_me := assert_can_edit(r.cycle_id, r.sdo_code, r.school_id);

  select max(id) into v_last from room_validations where room_id = p_room;
  if v_last is distinct from p_seen then
    perform refuse('This room was updated since your screen loaded: reload and try again', 'serialization_failure');
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
    if r.room_usage is null or cardinality(r.actual_usages) = 0 then
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
  if p_status <> 'for_deletion' then
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

create or replace function add_new_building(
  p_cycle text, p_school text, p_building_no int, p_condition text, p_remarks text,
  p_type text default null, p_storeys int default null, p_year text default null,
  p_longitude numeric default null, p_latitude numeric default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s cycle_schools;
  v_me uuid;
  v_id bigint;
begin
  select * into s from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if s.school_id is null then
    perform refuse('That school is not in this cycle''s NSBI data', 'no_data_found');
  end if;
  v_me := assert_can_edit(p_cycle, s.sdo_code, p_school);
  if nullif(trim(p_remarks), '') is null then perform refuse('Say in REMARKS why this building is not in the NSBI'); end if;
  if (p_longitude is null) <> (p_latitude is null) then perform refuse('Give both longitude and latitude'); end if;
  if p_longitude is not null and not in_region_vii(p_longitude, p_latitude) then
    perform refuse('Those coordinates are outside Region VII');
  end if;
  insert into new_buildings (cycle_id, school_id, sdo_code, building_no, building_type, building_condition,
    storeys, year_completed, longitude, latitude, remarks, recorded_by)
  values (p_cycle, p_school, s.sdo_code, p_building_no, p_type, p_condition, p_storeys, p_year,
    p_longitude, p_latitude, trim(p_remarks), v_me)
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
  if coalesce(cardinality(p_actual_usages), 0) = 0 then
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
    p_actual_usages, p_width, p_length, trim(p_remarks), v_me)
  returning id into v_id;
  return v_id;
end $$;

create or replace function withdraw_new_record(p_new_building bigint, p_new_room bigint, p_remarks text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cycle text; v_sdo text; v_school text;
  v_me uuid;
  v_id bigint;
begin
  if (p_new_building is null) = (p_new_room is null) then
    perform refuse('Give either the new building or the new room');
  end if;
  if p_new_building is not null then
    select cycle_id, sdo_code, school_id into v_cycle, v_sdo, v_school from new_buildings where id = p_new_building;
  else
    select cycle_id, sdo_code, school_id into v_cycle, v_sdo, v_school from new_rooms where id = p_new_room;
  end if;
  if v_sdo is null then perform refuse('No such record', 'no_data_found'); end if;
  v_me := assert_can_edit(v_cycle, v_sdo, v_school);
  if nullif(trim(p_remarks), '') is null then perform refuse('Say why it is withdrawn'); end if;
  insert into new_record_withdrawals (new_building_id, new_room_id, remarks, recorded_by)
  values (p_new_building, p_new_room, trim(p_remarks), v_me)
  returning id into v_id;
  return v_id;
end $$;

-- ── Validated means the SDO's step; a school's newer step waits beside it ───────────────────

create or replace view building_latest with (security_invoker = true) as
  select distinct on (building_id) * from building_validations where not by_school order by building_id, id desc;

create or replace view room_latest with (security_invoker = true) as
  select distinct on (room_id) * from room_validations where not by_school order by room_id, id desc;

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
       (select max(v.id) from room_validations v where v.room_id = r.id) as last_step_id
from co_rooms r
left join room_latest rl on rl.room_id = r.id
left join building_latest bl on bl.building_id = r.building_id;

create or replace view building_status with (security_invoker = true) as
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
           then format('Same as NSBI (%s)', coalesce(b.number_of_rooms, 0))
         else format('Changed: NSBI %s, validated %s', coalesce(b.number_of_rooms, 0),
                     coalesce(l.kept_rooms, 0) + coalesce(a.new_rooms, 0))
       end as tally_check,
       (select max(v.id) from building_validations v where v.building_id = b.id) as last_step_id
from co_buildings b
left join building_latest bl on bl.building_id = b.id
left join listed l on l.building_id = b.id
left join added a on a.building_id = b.id;

-- A school's latest update on a record, when newer than the SDO's latest step: for the DE or DPO
-- to accept (by recording the same step) or answer with their own.
create view school_updates with (security_invoker = true) as
select 'building' as kind, v.building_id as record_id, null::bigint as room_id, b.cycle_id, b.school_id,
       v.id as step_id, v.status, v.validated_condition, null::text as validated_usage,
       null::text[] as validated_actual_usages, v.correct_longitude, v.correct_latitude,
       v.deletion_reason, v.remarks, v.recorded_at
from (select distinct on (building_id) * from building_validations order by building_id, id desc) v
join co_buildings b on b.id = v.building_id
where v.by_school
union all
select 'room', v.room_id, v.room_id, r.cycle_id, r.school_id,
       v.id, v.status, v.validated_condition, v.validated_usage, v.validated_actual_usages, null, null,
       v.deletion_reason, v.remarks, v.recorded_at
from (select distinct on (room_id) * from room_validations order by room_id, id desc) v
join co_rooms r on r.id = v.room_id
where v.by_school;
grant select on school_updates to authenticated;

-- ── A school sees only its own School ID ────────────────────────────────────────────────────

create or replace function can_see_school(p_sdo text, p_school text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_app_role() in ('ro', 'admin')
                  or (current_sdo() = p_sdo and (current_school() is null or current_school() = p_school)), false)
$$;

drop policy read_scoped on cycle_schools;
drop policy read_scoped on co_buildings;
drop policy read_scoped on co_rooms;
drop policy read_scoped on new_buildings;
drop policy read_scoped on new_rooms;
drop policy read_scoped on co_school_records;
drop policy read_scoped on profiles;

create policy read_scoped on cycle_schools for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on co_buildings for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on co_rooms for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on new_buildings for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on new_rooms for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on co_school_records for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
-- A school sees its own account only; SDO staff see their SDO's accounts.
create policy read_scoped on profiles for select to authenticated using (
  id = auth.uid()
  or (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and (select current_school()) is null));

-- The DPO checks a school; a school account never does.
revoke execute on function made_by_school() from public, anon;

-- New buildings and rooms also say who added them (the views' column lists were fixed at creation).
create or replace view live_new_buildings with (security_invoker = true) as
  select nb.* from new_buildings nb
  where not exists (select 1 from new_record_withdrawals w where w.new_building_id = nb.id);

create or replace view live_new_rooms with (security_invoker = true) as
  select nr.* from new_rooms nr
  where not exists (select 1 from new_record_withdrawals w where w.new_room_id = nr.id)
    and (nr.new_building_id is null
         or not exists (select 1 from new_record_withdrawals w where w.new_building_id = nr.new_building_id));
