-- RIVET V2 · 1800 · Summary reports (Ada, 26 Oct 2026).
--
-- One line per school of the current cycle with the room and building counts the Reports page
-- groups by SDO, district or school: NSBI as released beside the validated record. Validated
-- counts follow the Dashboard: records not for deletion, new records added in RIVET, and
-- usage-locked rooms (condemned or under construction) counted apart, never as instructional.

create view report_facilities with (security_invoker = true) as
with kinder(name) as (
  values ('Kindergarten Classroom'), ('Kindergarten Classroom - Multiple')
), rooms as (
  select r.cycle_id, r.school_id,
         count(*) as rooms_nsbi,
         count(*) filter (where r.room_usage = 'Instructional') as instructional_nsbi,
         count(*) filter (where r.room_usage = 'Non-Instructional') as noninstructional_nsbi,
         count(*) filter (where r.room_usage = 'Instructional'
                          and r.actual_usages && array(select name from kinder)) as kinder_nsbi,
         count(*) filter (where r.status is distinct from 'for_deletion') as rooms_validated,
         count(*) filter (where r.status is distinct from 'for_deletion' and not r.usage_locked
                          and r.final_usage = 'Instructional') as instructional_validated,
         count(*) filter (where r.status is distinct from 'for_deletion' and not r.usage_locked
                          and r.final_usage = 'Non-Instructional') as noninstructional_validated,
         count(*) filter (where r.status is distinct from 'for_deletion' and not r.usage_locked
                          and r.final_usage = 'Instructional'
                          and r.final_actual_usages && array(select name from kinder)) as kinder_validated,
         count(*) filter (where r.status is distinct from 'for_deletion' and r.usage_locked) as rooms_locked,
         count(*) filter (where r.status is distinct from 'for_deletion'
                          and rc.is_condemned) as rooms_condemned,
         count(*) filter (where r.status is distinct from 'for_deletion'
                          and r.final_condition = 'On-going Construction') as rooms_ongoing,
         count(*) filter (where r.status = 'for_deletion') as rooms_for_deletion
  from room_status r
  left join room_conditions rc on rc.name = r.final_condition
  group by r.cycle_id, r.school_id
), new_rooms as (
  select cycle_id, school_id, count(*) as added,
         count(*) filter (where room_usage = 'Instructional') as instructional,
         count(*) filter (where room_usage = 'Non-Instructional') as noninstructional,
         count(*) filter (where room_usage = 'Instructional' and actual_usages && array(select name from kinder)) as kinder,
         count(*) filter (where room_usage is null) as locked
  from live_new_rooms group by cycle_id, school_id
), buildings as (
  select b.cycle_id, b.school_id,
         count(*) as buildings_nsbi,
         count(*) filter (where b.status is distinct from 'for_deletion') as buildings_validated,
         count(*) filter (where b.status is distinct from 'for_deletion' and bc.is_condemned) as buildings_condemned,
         count(*) filter (where b.status is distinct from 'for_deletion'
                          and b.final_condition in ('On-going Construction', 'For Completion')) as buildings_ongoing,
         count(*) filter (where b.status = 'for_deletion') as buildings_for_deletion
  from building_status b
  left join building_conditions bc on bc.name = b.final_condition
  group by b.cycle_id, b.school_id
), new_buildings as (
  select cycle_id, school_id, count(*) as added from live_new_buildings group by cycle_id, school_id
)
select s.cycle_id, s.sdo_code, s.district, s.school_id, s.school_name,
       coalesce(b.buildings_nsbi, 0) as buildings_nsbi,
       coalesce(b.buildings_validated, 0) + coalesce(nb.added, 0) as buildings_validated,
       coalesce(b.buildings_condemned, 0) as buildings_condemned,
       coalesce(b.buildings_ongoing, 0) as buildings_ongoing,
       coalesce(b.buildings_for_deletion, 0) as buildings_for_deletion,
       coalesce(nb.added, 0) as buildings_added,
       coalesce(r.rooms_nsbi, 0) as rooms_nsbi,
       coalesce(r.rooms_validated, 0) + coalesce(n.added, 0) as rooms_validated,
       coalesce(r.instructional_nsbi, 0) as instructional_nsbi,
       coalesce(r.instructional_validated, 0) + coalesce(n.instructional, 0) as instructional_validated,
       coalesce(r.noninstructional_nsbi, 0) as noninstructional_nsbi,
       coalesce(r.noninstructional_validated, 0) + coalesce(n.noninstructional, 0) as noninstructional_validated,
       coalesce(r.kinder_nsbi, 0) as kinder_nsbi,
       coalesce(r.kinder_validated, 0) + coalesce(n.kinder, 0) as kinder_validated,
       coalesce(r.rooms_locked, 0) + coalesce(n.locked, 0) as rooms_locked,
       coalesce(r.rooms_condemned, 0) as rooms_condemned,
       coalesce(r.rooms_ongoing, 0) as rooms_ongoing,
       coalesce(r.rooms_for_deletion, 0) as rooms_for_deletion,
       coalesce(n.added, 0) as rooms_added
from cycle_schools s
join cycles c on c.id = s.cycle_id and c.role = 'current'
left join rooms r on r.cycle_id = s.cycle_id and r.school_id = s.school_id
left join new_rooms n on n.cycle_id = s.cycle_id and n.school_id = s.school_id
left join buildings b on b.cycle_id = s.cycle_id and b.school_id = s.school_id
left join new_buildings nb on nb.cycle_id = s.cycle_id and nb.school_id = s.school_id;

grant select on report_facilities to authenticated;
revoke all on report_facilities from anon;

-- Buildings and rooms marked for deletion, with the reason, for the Deletions report.
create view report_deletions with (security_invoker = true) as
select b.cycle_id, b.sdo_code, s.district, b.school_id, s.school_name, 'Building' as record,
       b.building_code as code, b.building_condition as nsbi_condition, d.label as reason, b.remarks,
       profile_name(b.recorded_by) as recorded_by, b.recorded_at
from building_status b
join cycle_schools s on s.cycle_id = b.cycle_id and s.school_id = b.school_id
left join deletion_reasons d on d.code = b.deletion_reason
where b.status = 'for_deletion'
union all
select r.cycle_id, r.sdo_code, s.district, r.school_id, s.school_name, 'Room',
       r.room_code, r.room_condition, d.label, r.remarks, profile_name(r.recorded_by), r.recorded_at
from room_status r
join cycle_schools s on s.cycle_id = r.cycle_id and s.school_id = r.school_id
left join deletion_reasons d on d.code = r.deletion_reason
where r.status = 'for_deletion';

grant select on report_deletions to authenticated;
revoke all on report_deletions from anon;
