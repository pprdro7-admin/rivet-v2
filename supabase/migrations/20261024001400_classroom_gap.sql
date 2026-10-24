-- RIVET V2 · 1400 · Classroom gap and priority schools (Ada, 24 Oct 2026).
--
-- Demand: LIS enrollment by grade, one load per school year, kept read-only as released.
-- Rule: the old RIVET's MATATAG class-organization rule (rules.yaml P1 to P4). Per band,
--   classes = ceil(learners / maximum class size); Kindergarten runs two sessions per room;
--   every other band needs one room per class. Non-graded (SNEd) learners are counted in the
--   school's learners but not split into bands.
-- Supply: Instructional rooms after validation, not for deletion and not usage-locked
--   (condemned or under construction). Combination rooms are shown on their own and not counted
--   as supply, as in the old RIVET (decision still open with the DPOs).

create table planning_parameters (
  band              text primary key,
  label             text not null,
  sort              int  not null,
  class_size_max    int  not null,
  sessions_per_room int  not null,
  source            text not null
);
insert into planning_parameters values
  ('kinder', 'Kindergarten', 1, 30, 2, 'MATATAG-based DepEd Planning Parameters (max 30 per session); DO 81 s. 2012 item 2.2.c (two sessions a day)'),
  ('g1_3',   'Grades 1-3',   2, 35, 1, 'MATATAG-based DepEd Planning Parameters (max 35)'),
  ('g4_6',   'Grades 4-6',   3, 45, 1, 'MATATAG-based DepEd Planning Parameters (max 45)'),
  ('g7_10',  'Grades 7-10',  4, 45, 1, 'MATATAG-based DepEd Planning Parameters (max 45)'),
  ('g11_12', 'Grades 11-12', 5, 40, 1, 'MATATAG-based DepEd Planning Parameters (max 40)');

create table enrollment_loads (
  id          bigint generated always as identity primary key,
  school_year text not null,
  source      text not null,          -- e.g. 'LIS BOSY, generated as of 30 January 2025'
  file_name   text not null,
  file_sha256 text not null,
  row_count   int  not null,
  loaded_at   timestamptz not null default now(),
  unique (school_year, source)
);

create table enrollments (
  id          bigint generated always as identity primary key,
  load_id     bigint not null references enrollment_loads(id),
  school_year text not null,
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  kinder int, g1 int, g2 int, g3 int, g4 int, g5 int, g6 int, es_ng int,
  g7 int, g8 int, g9 int, g10 int, jhs_ng int, g11 int, g12 int,
  unique (load_id, school_id)
);
create trigger enrollment_loads_locked before update or delete on enrollment_loads for each row execute function forbid_change();
create trigger enrollments_locked      before update or delete on enrollments      for each row execute function forbid_change();

-- Staged rows (co_staging, co_table 'LIS') carry {"School ID", "Division", "grades": {kinder, g1, ...}}.
create or replace function load_enrollment(p_school_year text, p_source text, p_file text, p_sha text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_load bigint;
  v_n    int;
  v_bad  text;
begin
  select count(*) into v_n from co_staging where co_table = 'LIS';
  if v_n = 0 then raise exception 'Nothing staged for LIS'; end if;
  select string_agg(distinct rec->>'Division', ', ') into v_bad
  from co_staging st where co_table = 'LIS' and not exists (select 1 from sdos where nsbi_name = st.rec->>'Division');
  if v_bad is not null then raise exception 'Unknown Division in the enrollment file: %', v_bad; end if;

  insert into enrollment_loads (school_year, source, file_name, file_sha256, row_count)
  values (p_school_year, p_source, p_file, p_sha, v_n) returning id into v_load;

  insert into enrollments (load_id, school_year, school_id, sdo_code, kinder, g1, g2, g3, g4, g5, g6, es_ng,
                           g7, g8, g9, g10, jhs_ng, g11, g12)
  select v_load, p_school_year, st.rec->>'School ID', s.code,
         (g->>'kinder')::int, (g->>'g1')::int, (g->>'g2')::int, (g->>'g3')::int, (g->>'g4')::int,
         (g->>'g5')::int, (g->>'g6')::int, (g->>'es_ng')::int, (g->>'g7')::int, (g->>'g8')::int,
         (g->>'g9')::int, (g->>'g10')::int, (g->>'jhs_ng')::int, (g->>'g11')::int, (g->>'g12')::int
  from co_staging st
  join sdos s on s.nsbi_name = st.rec->>'Division'
  cross join lateral (select st.rec->'grades' as g) x
  where st.co_table = 'LIS' order by st.source_row;

  delete from co_staging where co_table = 'LIS';
  return v_load;
end $$;

alter table planning_parameters enable row level security;
alter table enrollment_loads enable row level security;
alter table enrollments enable row level security;
create policy read_all on planning_parameters for select to authenticated using (true);
create policy read_all on enrollment_loads for select to authenticated using (true);
create policy read_scoped on enrollments for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on planning_parameters, enrollment_loads, enrollments from anon;
revoke insert, update, delete, truncate on planning_parameters, enrollment_loads, enrollments from authenticated;
grant select on planning_parameters, enrollment_loads, enrollments to authenticated;
revoke execute on function load_enrollment(text, text, text, text) from public, anon, authenticated;

-- One line per school in the current cycle: learners (latest enrollment load), classrooms needed,
-- usable instructional rooms after validation, and the gap. A school with no enrollment record
-- has no gap (null), never 0.
create view classroom_gap with (security_invoker = true) as
with p as (
  select max(class_size_max) filter (where band = 'kinder') as k_max,
         max(sessions_per_room) filter (where band = 'kinder') as k_sessions,
         max(class_size_max) filter (where band = 'g1_3')   as g1_3_max,
         max(class_size_max) filter (where band = 'g4_6')   as g4_6_max,
         max(class_size_max) filter (where band = 'g7_10')  as g7_10_max,
         max(class_size_max) filter (where band = 'g11_12') as g11_12_max
  from planning_parameters
), e as (
  select distinct on (school_id) e.*, l.source
  from enrollments e join enrollment_loads l on l.id = e.load_id
  order by school_id, e.school_year desc, e.load_id desc
), rooms as (
  select cycle_id, school_id,
         count(*) filter (where final_usage = 'Instructional' and not usage_locked) as usable,
         count(*) filter (where final_usage = 'Instructional' and not usage_locked
                          and final_condition = 'Needs Major Repair')                as usable_major_repair,
         count(*) filter (where final_usage = 'Combination' and not usage_locked)   as combination,
         count(*) filter (where usage_locked)                                        as locked,
         count(*) filter (where status is not null)                                  as with_status,
         count(*)                                                                    as listed
  from room_status where status is distinct from 'for_deletion'
  group by cycle_id, school_id
), new_rooms as (
  select cycle_id, school_id, count(*) filter (where room_usage = 'Instructional') as usable
  from live_new_rooms group by cycle_id, school_id
), d as (
  select s.cycle_id, s.sdo_code, s.district, s.school_id, s.school_name,
         e.school_year as enrollment_year, e.source as enrollment_source,
         e.kinder, coalesce(e.g1, 0) + coalesce(e.g2, 0) + coalesce(e.g3, 0) as g1_3,
         coalesce(e.g4, 0) + coalesce(e.g5, 0) + coalesce(e.g6, 0) as g4_6,
         coalesce(e.g7, 0) + coalesce(e.g8, 0) + coalesce(e.g9, 0) + coalesce(e.g10, 0) as g7_10,
         coalesce(e.g11, 0) + coalesce(e.g12, 0) as g11_12,
         coalesce(e.es_ng, 0) + coalesce(e.jhs_ng, 0) as sned,
         e.school_id is not null as has_enrollment,
         coalesce(r.usable, 0) + coalesce(n.usable, 0) as usable_rooms,
         coalesce(r.usable_major_repair, 0) as usable_major_repair,
         coalesce(r.combination, 0) as combination_rooms,
         coalesce(r.locked, 0) as locked_rooms,
         coalesce(r.with_status, 0) as rooms_with_status,
         coalesce(r.listed, 0) as rooms_listed
  from cycle_schools s
  join cycles c on c.id = s.cycle_id and c.role = 'current'
  left join e on e.school_id = s.school_id
  left join rooms r on r.cycle_id = s.cycle_id and r.school_id = s.school_id
  left join new_rooms n on n.cycle_id = s.cycle_id and n.school_id = s.school_id
), need as (
  select d.*,
         ceil(ceil(coalesce(d.kinder, 0)::numeric / p.k_max) / p.k_sessions)::int as rooms_kinder,
         ceil(d.g1_3::numeric / p.g1_3_max)::int     as rooms_g1_3,
         ceil(d.g4_6::numeric / p.g4_6_max)::int     as rooms_g4_6,
         ceil(d.g7_10::numeric / p.g7_10_max)::int   as rooms_g7_10,
         ceil(d.g11_12::numeric / p.g11_12_max)::int as rooms_g11_12
  from d cross join p
)
select cycle_id, sdo_code, district, school_id, school_name, enrollment_year, enrollment_source, has_enrollment,
       case when has_enrollment then coalesce(kinder, 0) + g1_3 + g4_6 + g7_10 + g11_12 + sned end as learners,
       case when has_enrollment then rooms_kinder + rooms_g1_3 + rooms_g4_6 + rooms_g7_10 + rooms_g11_12 end as rooms_needed,
       usable_rooms, usable_major_repair, combination_rooms, locked_rooms, rooms_with_status, rooms_listed,
       case when has_enrollment then rooms_kinder + rooms_g1_3 + rooms_g4_6 + rooms_g7_10 + rooms_g11_12 - usable_rooms end as gap,
       case when has_enrollment and usable_rooms > 0
            then round((coalesce(kinder, 0) + g1_3 + g4_6 + g7_10 + g11_12 + sned)::numeric / usable_rooms, 1) end as learners_per_room
from need;

grant select on classroom_gap to authenticated;
revoke all on classroom_gap from anon;

-- Drill-down: the same counts as dash_conditions and dash_room_usage, one line per school, so a
-- click on a bar lists the schools behind it.
create view dash_by_school with (security_invoker = true) as
with x as (
  select cycle_id, school_id, 'building' as kind, building_condition as label, 1 as nsbi, 0 as validated from building_status
  union all
  select cycle_id, school_id, 'building', final_condition, 0, 1 from building_status where status is distinct from 'for_deletion'
  union all
  select cycle_id, school_id, 'building', building_condition, 0, 1 from live_new_buildings
  union all
  select cycle_id, school_id, 'room', room_condition, 1, 0 from room_status
  union all
  select cycle_id, school_id, 'room', final_condition, 0, 1 from room_status where status is distinct from 'for_deletion'
  union all
  select cycle_id, school_id, 'room', room_condition, 0, 1 from live_new_rooms
  union all
  select cycle_id, school_id, 'usage', room_usage, 1, 0 from room_status
  union all
  select cycle_id, school_id, 'usage', case when usage_locked then 'Usage locked' else final_usage end, 0, 1
  from room_status where status is distinct from 'for_deletion'
  union all
  select cycle_id, school_id, 'usage', coalesce(room_usage, 'Usage locked'), 0, 1 from live_new_rooms
)
select x.cycle_id, s.sdo_code, s.district, x.school_id, s.school_name, x.kind, coalesce(x.label, 'Blank') as label,
       sum(x.nsbi) as nsbi, sum(x.validated) as validated
from x join cycle_schools s on s.cycle_id = x.cycle_id and s.school_id = x.school_id
group by 1, 2, 3, 4, 5, 6, 7;

grant select on dash_by_school to authenticated;
revoke all on dash_by_school from anon;
