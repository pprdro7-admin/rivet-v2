-- RIVET V2 · 1300 · Dashboard (Ada, 24 Oct 2026: available already in the pilot).
-- Each view is read under the viewer's own access, so the RO sees Region VII, and a DE or DPO
-- sees their own SDO. The year selector offers each school year with NSBI data loaded.

-- School years with data, and which kind: buildings and rooms (T1/T2), or school-level tables.
create view dash_years with (security_invoker = true) as
select c.id as cycle_id, c.label, c.role,
       bool_or(s.co_table in ('T1', 'T2'))     as has_buildings,
       bool_or(s.co_table not in ('T1', 'T2')) as has_school_tables
from cycles c join source_loads s on s.cycle_id = c.id
group by c.id, c.label, c.role;

-- Buildings and rooms by condition: as in the NSBI, and after validation (deletions out,
-- new records in; a record without a status yet keeps its NSBI value).
create view dash_conditions with (security_invoker = true) as
with x as (
  select cycle_id, sdo_code, 'building' as kind, building_condition as cond, 1 as nsbi, 0 as validated from building_status
  union all
  select cycle_id, sdo_code, 'building', final_condition, 0, 1 from building_status where status is distinct from 'for_deletion'
  union all
  select cycle_id, sdo_code, 'building', building_condition, 0, 1 from live_new_buildings
  union all
  select cycle_id, sdo_code, 'room', room_condition, 1, 0 from room_status
  union all
  select cycle_id, sdo_code, 'room', final_condition, 0, 1 from room_status where status is distinct from 'for_deletion'
  union all
  select cycle_id, sdo_code, 'room', room_condition, 0, 1 from live_new_rooms
)
select cycle_id, sdo_code, kind, coalesce(cond, 'Blank') as condition, sum(nsbi) as nsbi, sum(validated) as validated
from x group by 1, 2, 3, 4;

-- Rooms by usage. After validation, a room whose usage is locked (condemned or under
-- construction) is counted on its own line, neither instructional nor non-instructional.
create view dash_room_usage with (security_invoker = true) as
with x as (
  select cycle_id, sdo_code, room_usage as usage, 1 as nsbi, 0 as validated from room_status
  union all
  select cycle_id, sdo_code, case when usage_locked then 'Usage locked' else final_usage end, 0, 1
  from room_status where status is distinct from 'for_deletion'
  union all
  select cycle_id, sdo_code, coalesce(room_usage, 'Usage locked'), 0, 1 from live_new_rooms
)
select cycle_id, sdo_code, coalesce(usage, 'Blank') as usage, sum(nsbi) as nsbi, sum(validated) as validated
from x group by 1, 2, 3;

-- Totals of the school-level tables (classroom summary and enrollment, Tables 3, 4, 5) per SDO.
create view dash_school_totals with (security_invoker = true) as
select r.cycle_id, r.sdo_code, r.co_table, m.key as measure,
       sum((m.value #>> '{}')::numeric) as total,
       count(distinct r.school_id) as schools
from co_school_records r
cross join lateral jsonb_each(r.measures) m
where jsonb_typeof(m.value) = 'number'
group by 1, 2, 3, 4;

grant select on dash_years, dash_conditions, dash_room_usage, dash_school_totals to authenticated;
revoke all on dash_years, dash_conditions, dash_room_usage, dash_school_totals from anon;
