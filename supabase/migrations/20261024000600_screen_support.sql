-- RIVET V2 · 0600 · Views the screens read, so a page needs one request, not one per school.

-- Progress per SDO, for the Regional Office.
create view sdo_progress with (security_invoker = true) as
select t.cycle_id, t.sdo_code, s.name as sdo_name,
       count(*)                         as schools,
       sum(t.co_buildings)              as co_buildings,
       sum(t.co_rooms)                  as co_rooms,
       sum(t.flagged_buildings)         as flagged_buildings,
       sum(t.flagged_rooms)             as flagged_rooms,
       sum(t.buildings_with_status)     as buildings_with_status,
       sum(t.rooms_with_status)         as rooms_with_status,
       sum(t.rooms_for_deletion)        as rooms_for_deletion,
       count(*) filter (where t.dpo_complete)            as schools_complete,
       count(*) filter (where t.dpo_result = 'returned') as schools_returned,
       case when sum(t.co_buildings + t.co_rooms) = 0 then 0
            else round(sum(t.buildings_with_status + t.rooms_with_status)::numeric / sum(t.co_buildings + t.co_rooms), 4) end
         as share_validated,
       o.signed_at, o.remarks as signoff_remarks
from school_tally t
join sdos s on s.code = t.sdo_code
left join sdo_signoffs o on o.cycle_id = t.cycle_id and o.sdo_code = t.sdo_code
group by t.cycle_id, t.sdo_code, s.name, o.signed_at, o.remarks;

-- Flags per record, joined into one line each, the way the workbook shows them.
create view building_flag_text with (security_invoker = true) as
select building_id, string_agg(format('[%s] %s', who, flag), '; ' order by who, flag) as flags
from building_flags group by building_id;

create view room_flag_text with (security_invoker = true) as
select room_id, string_agg(format('[%s] %s', who, flag), '; ' order by who, flag) as flags
from room_flags group by room_id;
