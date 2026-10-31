-- RIVET V2 · 2800 · Building numbers, "Replaces", and the site sketch (Ada, 31 Oct 2026, from the
-- rows mockup she chose to build in full).
--
-- CO's numbering rule (NSBI business-rule infographics): a new building always takes the last number
-- in sequence, even when it stands between two buildings or where a demolished one stood; a
-- demolished building keeps its number, which is never given out again.
--   - A building added in RIVET may not reuse any number already in the school (NSBI or added),
--     demolished buildings included. The screen offers the next number.
--   - A building can be marked as replacing a demolished one ("Replaces Bldg 9"). The mark is kept
--     step by step; clearing it is another step.
--   - The site sketch: each building of Table 1 (and each one added) is a box placed on the main
--     site or on an adjacent site under the same School ID, plus simple landmarks (WATSAN, covered
--     court, grounds, gate). Only positions are new; the building's own data stays in Tables 1 and 2.
-- The Division Engineer or Planning Officer records these. A school account sees them.

-- A number already used in the school, by an NSBI building or one added in RIVET.
create or replace function building_no_used(p_cycle text, p_school text, p_no int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from co_buildings where cycle_id = p_cycle and school_id = p_school and building_no = p_no)
      or exists (select 1 from live_new_buildings where cycle_id = p_cycle and school_id = p_school and building_no = p_no)
$$;

-- The next number for a new building: one above the highest ever used in the school.
create or replace function next_building_no(p_cycle text, p_school text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(greatest(
    (select max(building_no) from co_buildings where cycle_id = p_cycle and school_id = p_school),
    (select max(building_no) from new_buildings where cycle_id = p_cycle and school_id = p_school)), 0) + 1
$$;

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
  if p_building_no is null or p_building_no < 1 then perform refuse('Give the building number'); end if;
  if building_no_used(p_cycle, p_school, p_building_no) then
    perform refuse(format('Building number %s is already used in this school, and a number is never reused '
                          '(a demolished building keeps its own). The next number is %s.',
                          p_building_no, next_building_no(p_cycle, p_school)));
  end if;
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

-- ---------------------------------------------------------------- "Replaces Bldg N"
create table building_replacements (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  building_no int  not null,
  replaces_no int,                         -- null clears the mark
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id),
  check (replaces_no is distinct from building_no)
);
create index building_replacements_school_idx on building_replacements (cycle_id, school_id, building_no, id);
create trigger building_replacements_locked before update or delete on building_replacements
  for each row execute function forbid_change();

-- A building's condition as it now stands: the validated one for an NSBI building, the given one
-- for a building added in RIVET.
create or replace function building_condition_now(p_cycle text, p_school text, p_no int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(bl.validated_condition, b.building_condition)
       from co_buildings b left join building_latest bl on bl.building_id = b.id
      where b.cycle_id = p_cycle and b.school_id = p_school and b.building_no = p_no
      order by b.id limit 1),
    (select building_condition from live_new_buildings
      where cycle_id = p_cycle and school_id = p_school and building_no = p_no order by id desc limit 1))
$$;

create or replace function record_building_replaces(p_cycle text, p_school text, p_building_no int, p_replaces_no int)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_sdo text;
  v_me  uuid;
  v_id  bigint;
begin
  select sdo_code into v_sdo from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if v_sdo is null then perform refuse('No such school in this cycle', 'no_data_found'); end if;
  v_me := assert_can_edit(p_cycle, v_sdo, p_school);
  if (select role from profiles where id = v_me) = 'school' then
    perform refuse('The Division Engineer or Planning Officer records which building a new one replaces', 'insufficient_privilege');
  end if;
  if not building_no_used(p_cycle, p_school, p_building_no) then
    perform refuse(format('There is no Building %s in this school', p_building_no));
  end if;
  if p_replaces_no is not null then
    if p_replaces_no = p_building_no then perform refuse('A building cannot replace itself'); end if;
    if not building_no_used(p_cycle, p_school, p_replaces_no) then
      perform refuse(format('There is no Building %s in this school', p_replaces_no));
    end if;
    if building_condition_now(p_cycle, p_school, p_replaces_no) is distinct from 'Demolished'
       and building_condition_now(p_cycle, p_school, p_replaces_no) is distinct from 'Condemned / For Demolition' then
      perform refuse(format('Building %s is not demolished: only a demolished building (or one condemned for '
                            'demolition) is replaced', p_replaces_no));
    end if;
    if building_condition_now(p_cycle, p_school, p_building_no) = 'Demolished' then
      perform refuse('A demolished building does not replace another');
    end if;
  end if;
  insert into building_replacements (cycle_id, school_id, sdo_code, building_no, replaces_no, recorded_by)
  values (p_cycle, p_school, v_sdo, p_building_no, p_replaces_no, v_me)
  returning id into v_id;
  return v_id;
end $$;

create view building_replaces with (security_invoker = true) as
select * from (
  select distinct on (r.cycle_id, r.school_id, r.building_no)
         r.cycle_id, r.school_id, r.sdo_code, r.building_no, r.replaces_no, r.recorded_at,
         profile_name(r.recorded_by) as recorded_by_name
  from building_replacements r
  order by r.cycle_id, r.school_id, r.building_no, r.id desc
) x where replaces_no is not null;

-- ---------------------------------------------------------------- The site sketch
-- Site 1 is the main site. An adjacent site (2, 3, ...) is added with a name, e.g. "Across the road".
create table school_sites (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  site_no     int  not null check (site_no >= 2),
  name        text,
  removed     boolean not null default false,
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id),
  check (removed or nullif(btrim(name), '') is not null)
);
create index school_sites_school_idx on school_sites (cycle_id, school_id, site_no, id);
create trigger school_sites_locked before update or delete on school_sites
  for each row execute function forbid_change();

-- Each box on the sketch, as last placed. item_key is 'b:<building no.>' for a building, or
-- 'm:<n>' for a landmark. x, y, w, h are in sketch units (the drawing is 800 x 460).
create table sketch_items (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  item_key    text not null check (item_key ~ '^(b|m):[0-9]+$'),
  kind        text not null check (kind in ('building', 'watsan', 'court', 'grounds', 'gate', 'flagpole', 'other')),
  label       text,
  site_no     int  not null default 1 check (site_no >= 1),
  x           int  not null check (x between 0 and 800),
  y           int  not null check (y between 0 and 460),
  w           int  not null check (w between 20 and 800),
  h           int  not null check (h between 20 and 460),
  removed     boolean not null default false,
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id),
  check ((kind = 'building') = (item_key like 'b:%'))
);
create index sketch_items_school_idx on sketch_items (cycle_id, school_id, item_key, id);
create trigger sketch_items_locked before update or delete on sketch_items
  for each row execute function forbid_change();

create or replace function sketch_editor(p_cycle text, p_school text) returns record
language plpgsql security definer set search_path = public as $$
declare
  v_sdo text;
  v_me  uuid;
  r     record;
begin
  select sdo_code into v_sdo from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if v_sdo is null then perform refuse('No such school in this cycle', 'no_data_found'); end if;
  v_me := assert_can_edit(p_cycle, v_sdo, p_school);
  if (select role from profiles where id = v_me) = 'school' then
    perform refuse('The Division Engineer or Planning Officer draws the site sketch', 'insufficient_privilege');
  end if;
  select v_sdo as sdo_code, v_me as me into r;
  return r;
end $$;

create or replace function record_school_site(p_cycle text, p_school text, p_site_no int, p_name text, p_removed boolean default false)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_id bigint;
begin
  select * into e from sketch_editor(p_cycle, p_school) as (sdo_code text, me uuid);
  if p_site_no is null or p_site_no < 2 then perform refuse('The main site is always there; an adjacent site is number 2 or more'); end if;
  if not p_removed and nullif(btrim(p_name), '') is null then perform refuse('Name the adjacent site, e.g. "Across the road"'); end if;
  if p_removed and exists (
    select 1 from (select distinct on (item_key) site_no, removed from sketch_items
                    where cycle_id = p_cycle and school_id = p_school order by item_key, id desc) x
     where x.site_no = p_site_no and not x.removed) then
    perform refuse('Move the buildings and landmarks off this site first');
  end if;
  insert into school_sites (cycle_id, school_id, sdo_code, site_no, name, removed, recorded_by)
  values (p_cycle, p_school, e.sdo_code, p_site_no, nullif(btrim(p_name), ''), coalesce(p_removed, false), e.me)
  returning id into v_id;
  return v_id;
end $$;

create or replace function record_sketch_item(p_cycle text, p_school text, p_key text, p_kind text, p_label text,
                                              p_site_no int, p_x int, p_y int, p_w int, p_h int, p_removed boolean default false)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_id bigint;
begin
  select * into e from sketch_editor(p_cycle, p_school) as (sdo_code text, me uuid);
  if p_key like 'b:%' and not building_no_used(p_cycle, p_school, substr(p_key, 3)::int) then
    perform refuse('There is no such building in this school');
  end if;
  if coalesce(p_site_no, 1) >= 2 and not exists (
    select 1 from (select distinct on (site_no) site_no, removed from school_sites
                    where cycle_id = p_cycle and school_id = p_school order by site_no, id desc) s
     where s.site_no = p_site_no and not s.removed) then
    perform refuse('Add the adjacent site first');
  end if;
  insert into sketch_items (cycle_id, school_id, sdo_code, item_key, kind, label, site_no, x, y, w, h, removed, recorded_by)
  values (p_cycle, p_school, e.sdo_code, p_key, p_kind, nullif(btrim(p_label), ''), coalesce(p_site_no, 1),
          greatest(0, least(800, p_x)), greatest(0, least(460, p_y)), p_w, p_h, coalesce(p_removed, false), e.me)
  returning id into v_id;
  return v_id;
end $$;

create view school_site_list with (security_invoker = true) as
select * from (
  select distinct on (s.cycle_id, s.school_id, s.site_no) s.cycle_id, s.school_id, s.sdo_code, s.site_no, s.name, s.removed
  from school_sites s order by s.cycle_id, s.school_id, s.site_no, s.id desc
) x where not removed;

create view sketch_latest with (security_invoker = true) as
select * from (
  select distinct on (i.cycle_id, i.school_id, i.item_key)
         i.cycle_id, i.school_id, i.sdo_code, i.item_key, i.kind, i.label, i.site_no, i.x, i.y, i.w, i.h, i.removed,
         i.recorded_at, profile_name(i.recorded_by) as recorded_by_name
  from sketch_items i order by i.cycle_id, i.school_id, i.item_key, i.id desc
) x where not removed;

-- ---------------------------------------------------------------- Who sees what
alter table building_replacements enable row level security;
alter table school_sites enable row level security;
alter table sketch_items enable row level security;
create policy read_scoped on building_replacements for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on school_sites for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on sketch_items for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));

revoke all on building_replacements, building_replaces, school_sites, school_site_list, sketch_items, sketch_latest from anon;
revoke insert, update, delete, truncate on building_replacements, school_sites, sketch_items from authenticated;
grant select on building_replacements, building_replaces, school_sites, school_site_list, sketch_items, sketch_latest to authenticated;

revoke execute on function building_no_used(text, text, int), next_building_no(text, text),
  building_condition_now(text, text, int), sketch_editor(text, text),
  record_building_replaces(text, text, int, int), record_school_site(text, text, int, text, boolean),
  record_sketch_item(text, text, text, text, text, int, int, int, int, int, boolean) from public, anon;
revoke execute on function sketch_editor(text, text), building_condition_now(text, text, int) from authenticated;
grant execute on function building_no_used(text, text, int), next_building_no(text, text),
  record_building_replaces(text, text, int, int), record_school_site(text, text, int, text, boolean),
  record_sketch_item(text, text, text, text, text, int, int, int, int, int, boolean) to authenticated;
