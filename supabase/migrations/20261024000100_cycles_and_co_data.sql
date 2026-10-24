-- RIVET V2 · 0100 · Cycles, drop-down lists and the CO data exactly as released.
--
-- Carried over from V1: CO observations are never edited. Tables 1 and 2 are loaded once per
-- cycle as a source load and locked; every correction is a validation row beside them (0300).

create extension if not exists pgcrypto;

-- Schools Division Offices of Region VII. `nsbi_name` is the Division name as CO's NSBI files write it.
create table sdos (
  code      text primary key,
  name      text not null unique,
  nsbi_name text not null unique
);

-- A school year of NSBI data. Only the current cycle is validated; a prior cycle is read-only
-- and kept for comparison. A cycle is frozen once every SDO is signed off (0300).
create table cycles (
  id             text primary key check (id ~ '^SY[0-9]{4}-[0-9]{4}$'),
  label          text not null,
  role           text not null check (role in ('prior', 'current')),
  co_as_of       date,          -- date of CO's raw release
  frozen_at      timestamptz,
  frozen_by      uuid
);
create unique index cycles_one_current on cycles (role) where role = 'current';

-- ── Drop-down lists (as in the template's Lists sheet). Data, not code. ─────────────────────

create table building_conditions (
  name          text primary key,
  sort          int  not null,
  is_condemned  boolean not null default false,  -- for condemnation, condemned, demolished
  is_demolished boolean not null default false
);

create table room_conditions (
  name         text primary key,
  sort         int  not null,
  is_condemned boolean not null default false
);

create table room_usages (
  name text primary key,
  sort int  not null
);

-- Actual Usage/s values. `kind` drives the usage checks: a classroom, a non-instructional room,
-- 'not used' for Not Currently Used, or neutral (labs, computer room, Others…).
create table actual_usages (
  name text primary key,
  kind text not null check (kind in ('classroom', 'non_instructional', 'not_used', 'neutral'))
);

create table deletion_reasons (
  code        text primary key,
  label       text not null unique,
  sort        int  not null,
  needs_remarks boolean not null default false     -- 'Other (specify)'
);

-- ── Source loads: one per CO table per cycle ────────────────────────────────────────────────

create table source_loads (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  co_table    text not null check (co_table in ('T1', 'T2')),
  file_name   text not null,
  file_sha256 text not null,
  row_count   int  not null,
  loaded_at   timestamptz not null default now(),
  -- A second CO release for the same cycle is a deliberate migration (re-attaching validations),
  -- never a silent reload.
  unique (cycle_id, co_table)
);

-- Schools as the cycle's CO files list them.
create table cycle_schools (
  cycle_id     text not null references cycles(id),
  school_id    text not null check (school_id ~ '^[0-9]{6}$'),
  school_name  text not null,
  sdo_code     text not null references sdos(code),
  district     text,
  municipality text,
  province     text,
  primary key (cycle_id, school_id)
);
create index cycle_schools_sdo_idx on cycle_schools (cycle_id, sdo_code);

-- Table 1: one row per building, as released. `co_record` keeps every column exactly as CO wrote it;
-- the typed columns are copies used by the checks.
create table co_buildings (
  id                 bigint generated always as identity primary key,
  load_id            bigint not null references source_loads(id),
  source_row         int    not null,
  cycle_id           text   not null references cycles(id),
  school_id          text   not null,
  sdo_code           text   not null references sdos(code),
  level_of_education text,
  building_code      text   not null,
  building_no        int,
  building_type      text,
  fund_source        text,
  building_condition text,
  storeys            int,
  number_of_rooms    int,
  year_completed     text,
  longitude          numeric,
  latitude           numeric,
  co_record          jsonb  not null,
  unique (load_id, source_row),
  unique (cycle_id, building_code),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create index co_buildings_school_idx on co_buildings (cycle_id, school_id);

-- Table 2: one row per room, as released. Room codes can be blank or repeated in CO's data,
-- so a room is identified by its own id, never by its code.
create table co_rooms (
  id                 bigint generated always as identity primary key,
  load_id            bigint not null references source_loads(id),
  source_row         int    not null,
  cycle_id           text   not null references cycles(id),
  school_id          text   not null,
  sdo_code           text   not null references sdos(code),
  building_id        bigint references co_buildings(id),   -- null when the code is not in Table 1
  building_code      text,
  building_condition text,
  room_code          text,
  room_no            int,
  room_condition     text,
  room_usage         text,
  actual_usages      text[] not null default '{}',
  submission_status  text,
  width_m            numeric,
  length_m           numeric,
  co_record          jsonb  not null,
  unique (load_id, source_row),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create index co_rooms_building_idx on co_rooms (building_id);
create index co_rooms_school_idx on co_rooms (cycle_id, school_id);
create index co_rooms_code_idx on co_rooms (cycle_id, room_code);

-- Append-only guard, shared by every table that keeps a record of what happened.
create or replace function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: record a new entry instead of changing or deleting one',
    tg_table_name using errcode = 'insufficient_privilege';
end $$;

create trigger source_loads_locked  before update or delete on source_loads  for each row execute function forbid_change();
create trigger cycle_schools_locked before update or delete on cycle_schools for each row execute function forbid_change();
create trigger co_buildings_locked  before update or delete on co_buildings  for each row execute function forbid_change();
create trigger co_rooms_locked      before update or delete on co_rooms      for each row execute function forbid_change();

-- Split CO's comma-separated Actual Usage/s into a list.
create or replace function split_usages(p text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(trim(x)) filter (where trim(x) <> ''), '{}')
  from unnest(string_to_array(coalesce(p, ''), ',')) as x
$$;

-- ── Loading CO's files ──────────────────────────────────────────────────────────────────────
-- scripts/load_co_tables.py turns each xlsx sheet into staged JSON rows (one object per row,
-- keyed by CO's own column headers) and calls these two functions. Service role only.

create table co_staging (
  co_table   text not null,
  source_row int  not null,
  rec        jsonb not null,
  primary key (co_table, source_row)
);

create or replace function load_co_table(p_cycle text, p_table text, p_file text, p_sha text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_load bigint;
  v_n    int;
  v_bad  text;
begin
  select count(*) into v_n from co_staging where co_table = p_table;
  if v_n = 0 then
    raise exception 'Nothing staged for %', p_table;
  end if;
  if p_table = 'T2' and not exists (select 1 from source_loads where cycle_id = p_cycle and co_table = 'T1') then
    raise exception 'Load Table 1 before Table 2, so each room finds its building';
  end if;

  select string_agg(distinct rec->>'Division', ', ') into v_bad
  from co_staging st where co_table = p_table
    and not exists (select 1 from sdos where nsbi_name = st.rec->>'Division');
  if v_bad is not null then
    raise exception 'Unknown Division in %: %', p_table, v_bad;
  end if;

  insert into source_loads (cycle_id, co_table, file_name, file_sha256, row_count)
  values (p_cycle, p_table, p_file, p_sha, v_n) returning id into v_load;

  -- Schools: first time a School ID is seen in this cycle, from whichever table lists it.
  insert into cycle_schools (cycle_id, school_id, school_name, sdo_code, district, municipality, province)
  select distinct on (rec->>'School ID')
         p_cycle, rec->>'School ID', rec->>'School Name', s.code, rec->>'District',
         coalesce(rec->>'Municipality', rec->>'City/Municipality'), rec->>'Province'
  from co_staging st join sdos s on s.nsbi_name = st.rec->>'Division'
  where co_table = p_table
  order by rec->>'School ID', source_row
  on conflict do nothing;

  if p_table = 'T1' then
    insert into co_buildings (load_id, source_row, cycle_id, school_id, sdo_code, level_of_education,
      building_code, building_no, building_type, fund_source, building_condition, storeys,
      number_of_rooms, year_completed, longitude, latitude, co_record)
    select v_load, source_row, p_cycle, rec->>'School ID', s.code, rec->>'Level of Education',
      rec->>'Building Code', (rec->>'Building No.')::numeric::int, rec->>'Building Type',
      rec->>'Fund Source', rec->>'Building Condition', (rec->>'Number of Storeys')::numeric::int,
      (rec->>'Number of Rooms')::numeric::int, rec->>'Year Completed/ Implemented',
      (rec->>'Longitude')::numeric, (rec->>'Latitude')::numeric, rec
    from co_staging st join sdos s on s.nsbi_name = st.rec->>'Division'
    where co_table = 'T1' order by source_row;
  else
    insert into co_rooms (load_id, source_row, cycle_id, school_id, sdo_code, building_id,
      building_code, building_condition, room_code, room_no, room_condition, room_usage,
      actual_usages, submission_status, width_m, length_m, co_record)
    select v_load, st.source_row, p_cycle, st.rec->>'School ID', s.code, b.id,
      st.rec->>'Building Code', st.rec->>'Building Condition', nullif(st.rec->>'Room Code', ''),
      (st.rec->>'Room Number')::numeric::int, st.rec->>'Room Condition', st.rec->>'Room Usage',
      split_usages(st.rec->>'Actual Usage/s'), st.rec->>'Status of Submission',
      (st.rec->>'Room Dimension (Width)')::numeric, (st.rec->>'Room Dimension (Length)')::numeric, rec
    from co_staging st
    join sdos s on s.nsbi_name = st.rec->>'Division'
    left join co_buildings b on b.cycle_id = p_cycle and b.building_code = st.rec->>'Building Code'
    where st.co_table = 'T2' order by st.source_row;
  end if;

  delete from co_staging where co_table = p_table;
  return v_load;
end $$;
