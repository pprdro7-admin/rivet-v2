-- RIVET V2 · 0300 · Validation of buildings and rooms (template v3).
--
-- Every building and room gets a status from the Division Engineer: correct as is, with
-- correction, or for deletion. Each step is an append-only row; the latest one counts. A
-- correction is written beside the CO value, never over it. Records for deletion are set
-- aside, not removed.

create type validation_status as enum ('correct', 'corrected', 'for_deletion');

create table building_validations (
  id                  bigint generated always as identity primary key,
  building_id         bigint not null references co_buildings(id),
  status              validation_status not null,
  validated_condition text references building_conditions(name),
  correct_longitude   numeric,
  correct_latitude    numeric,
  deletion_reason     text references deletion_reasons(code),
  remarks             text,
  recorded_by         uuid not null references profiles(id),
  recorded_at         timestamptz not null default clock_timestamp()
);
create index building_validations_idx on building_validations (building_id, id desc);

create table room_validations (
  id                     bigint generated always as identity primary key,
  room_id                bigint not null references co_rooms(id),
  status                 validation_status not null,
  validated_condition    text references room_conditions(name),
  validated_usage        text references room_usages(name),
  validated_actual_usages text[],
  deletion_reason        text references deletion_reasons(code),
  remarks                text,
  recorded_by            uuid not null references profiles(id),
  recorded_at            timestamptz not null default clock_timestamp()
);
create index room_validations_idx on room_validations (room_id, id desc);

-- Buildings and rooms missing from CO's file. Codes stay blank: CO assigns them.
create table new_buildings (
  id                 bigint generated always as identity primary key,
  cycle_id           text not null references cycles(id),
  school_id          text not null,
  sdo_code           text not null references sdos(code),
  building_no        int  not null,          -- number on site
  building_type      text,
  building_condition text not null references building_conditions(name),
  storeys            int,
  year_completed     text,
  longitude          numeric,
  latitude           numeric,
  remarks            text not null,
  recorded_by        uuid not null references profiles(id),
  recorded_at        timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);

create table new_rooms (
  id               bigint generated always as identity primary key,
  cycle_id         text not null references cycles(id),
  school_id        text not null,
  sdo_code         text not null references sdos(code),
  building_id      bigint references co_buildings(id),     -- a new room in an existing building
  new_building_id  bigint references new_buildings(id),    -- or in a new building
  room_no          int,
  room_condition   text not null references room_conditions(name),
  room_usage       text not null references room_usages(name),
  actual_usages    text[] not null,
  width_m          numeric,
  length_m         numeric,
  remarks          text not null,
  recorded_by      uuid not null references profiles(id),
  recorded_at      timestamptz not null default clock_timestamp(),
  check ((building_id is null) <> (new_building_id is null)),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);

-- A new record entered by mistake is withdrawn, not deleted.
create table new_record_withdrawals (
  id              bigint generated always as identity primary key,
  new_building_id bigint unique references new_buildings(id),
  new_room_id     bigint unique references new_rooms(id),
  remarks         text not null,
  recorded_by     uuid not null references profiles(id),
  recorded_at     timestamptz not null default clock_timestamp(),
  check ((new_building_id is null) <> (new_room_id is null))
);

-- The DPO's check of a school: complete, or returned to the DE with remarks.
create table dpo_checks (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  result      text not null check (result in ('complete', 'returned')),
  remarks     text,
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create index dpo_checks_idx on dpo_checks (cycle_id, school_id, id desc);

-- The RO's sign-off of a whole SDO. After it, nothing more is recorded for that SDO.
create table sdo_signoffs (
  id         bigint generated always as identity primary key,
  cycle_id   text not null references cycles(id),
  sdo_code   text not null references sdos(code),
  remarks    text,
  signed_by  uuid not null references profiles(id),
  signed_at  timestamptz not null default now(),
  unique (cycle_id, sdo_code)
);

create trigger building_validations_append_only before update or delete on building_validations for each row execute function forbid_change();
create trigger room_validations_append_only     before update or delete on room_validations     for each row execute function forbid_change();
create trigger new_buildings_append_only        before update or delete on new_buildings        for each row execute function forbid_change();
create trigger new_rooms_append_only            before update or delete on new_rooms            for each row execute function forbid_change();
create trigger new_record_withdrawals_append_only before update or delete on new_record_withdrawals for each row execute function forbid_change();
create trigger dpo_checks_append_only           before update or delete on dpo_checks           for each row execute function forbid_change();
create trigger sdo_signoffs_append_only         before update or delete on sdo_signoffs         for each row execute function forbid_change();

-- ── Latest step per record ──────────────────────────────────────────────────────────────────

create view building_latest with (security_invoker = true) as
  select distinct on (building_id) * from building_validations order by building_id, id desc;

create view room_latest with (security_invoker = true) as
  select distinct on (room_id) * from room_validations order by room_id, id desc;

create view live_new_buildings with (security_invoker = true) as
  select nb.* from new_buildings nb
  where not exists (select 1 from new_record_withdrawals w where w.new_building_id = nb.id);

create view live_new_rooms with (security_invoker = true) as
  select nr.* from new_rooms nr
  where not exists (select 1 from new_record_withdrawals w where w.new_room_id = nr.id)
    and (nr.new_building_id is null
         or not exists (select 1 from new_record_withdrawals w where w.new_building_id = nr.new_building_id));

-- ── Guards shared by every step ─────────────────────────────────────────────────────────────

create or replace function refuse(p_message text, p_code text default 'check_violation') returns void
language plpgsql as $$
begin
  raise exception '%', p_message using errcode = p_code;
end $$;

-- The DE (or DPO) may record for this SDO in this cycle.
create or replace function assert_open_for(p_cycle text, p_sdo text, p_role app_role) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_me profiles;
  v_cycle cycles;
begin
  v_me := current_profile();
  if v_me.id is null then
    perform refuse('Sign in first', 'insufficient_privilege');
  end if;
  if v_me.role <> p_role then
    perform refuse(format('Only the %s records this step', case p_role when 'de' then 'Division Engineer'
      when 'dpo' then 'Division Planning Officer' else p_role::text end), 'insufficient_privilege');
  end if;
  if v_me.sdo_code is distinct from p_sdo then
    perform refuse('This school is not in your SDO', 'insufficient_privilege');
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

-- Rough box around Bohol and Cebu, to catch swapped or mistyped coordinates.
create or replace function in_region_vii(p_lon numeric, p_lat numeric) returns boolean
language sql immutable as $$
  select p_lon between 123.0 and 124.8 and p_lat between 9.4 and 11.4
$$;

-- ── Building step ───────────────────────────────────────────────────────────────────────────

-- p_seen: the latest validation id the person's screen showed for this building (null if none).
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
  v_me := assert_open_for(b.cycle_id, b.sdo_code, 'de');

  select max(id) into v_last from building_validations where building_id = p_building;
  if v_last is distinct from p_seen then
    perform refuse('This building was updated since your screen loaded: reload and try again', 'serialization_failure');
  end if;

  if p_status = 'correct' then
    if coalesce(p_condition, p_reason) is not null or p_longitude is not null or p_latitude is not null then
      perform refuse('Correct as is takes no corrections: choose With correction instead');
    end if;
    if b.building_condition is null then
      perform refuse('CO left the building condition blank: give the validated condition (With correction)');
    end if;

  elsif p_status = 'corrected' then
    if p_reason is not null then perform refuse('A deletion reason goes with For deletion only'); end if;
    if p_condition is null and p_longitude is null and p_latitude is null then
      perform refuse('With correction needs the corrected value: condition or coordinates');
    end if;
    if p_condition is not distinct from b.building_condition then
      perform refuse('Validated condition is the same as CO: leave it blank');
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

-- ── Room step ───────────────────────────────────────────────────────────────────────────────

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
  v_me := assert_open_for(r.cycle_id, r.sdo_code, 'de');

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
      perform refuse('CO left the room condition blank: give the validated condition (With correction)');
    end if;
    if r.room_usage is null or cardinality(r.actual_usages) = 0 then
      perform refuse('CO left Room Usage or Actual Usage/s blank: give the validated value (With correction)');
    end if;

  elsif p_status = 'corrected' then
    if p_reason is not null then perform refuse('A deletion reason goes with For deletion only'); end if;
    if p_condition is null and p_usage is null and v_actual is null then
      perform refuse('With correction needs the corrected value: condition, usage or actual usage');
    end if;
    if p_condition is not distinct from r.room_condition then
      perform refuse('Validated room condition is the same as CO: leave it blank');
    end if;
    if p_usage is not distinct from r.room_usage then
      perform refuse('Validated room usage is the same as CO: leave it blank');
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

-- ── New buildings and rooms ─────────────────────────────────────────────────────────────────

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
    perform refuse('That school is not in this cycle''s CO file: list it under Missing Schools', 'no_data_found');
  end if;
  v_me := assert_open_for(p_cycle, s.sdo_code, 'de');
  if nullif(trim(p_remarks), '') is null then perform refuse('Say in REMARKS why this building is missing from CO''s file'); end if;
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

-- A new room goes in an existing CO building (p_building) or a new building (p_new_building).
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
  v_me := assert_open_for(v_cycle, v_sdo, 'de');
  if nullif(trim(p_remarks), '') is null then perform refuse('Say in REMARKS why this room is missing from CO''s file'); end if;
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
  v_cycle text; v_sdo text;
  v_me uuid;
  v_id bigint;
begin
  if (p_new_building is null) = (p_new_room is null) then
    perform refuse('Give either the new building or the new room');
  end if;
  if p_new_building is not null then
    select cycle_id, sdo_code into v_cycle, v_sdo from new_buildings where id = p_new_building;
  else
    select cycle_id, sdo_code into v_cycle, v_sdo from new_rooms where id = p_new_room;
  end if;
  if v_sdo is null then perform refuse('No such record', 'no_data_found'); end if;
  v_me := assert_open_for(v_cycle, v_sdo, 'de');
  if nullif(trim(p_remarks), '') is null then perform refuse('Say why it is withdrawn'); end if;
  insert into new_record_withdrawals (new_building_id, new_room_id, remarks, recorded_by)
  values (p_new_building, p_new_room, trim(p_remarks), v_me)
  returning id into v_id;
  return v_id;
end $$;
