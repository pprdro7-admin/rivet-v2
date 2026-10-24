-- The dashboard reads under each viewer's own access.
begin;
set role authenticated;
select tests.login('de');

select tests.ok((select bool_and(sdo_code = 'BOH') from dash_conditions), 'a DE''s dashboard holds only their SDO');
select tests.ok((select sum(nsbi) from dash_conditions where kind = 'building') = 5, 'buildings by condition add up to the NSBI count');
select record_building_validation(tests.b('900002002'), null, 'for_deletion', p_reason => 'mistaken');
select tests.ok((select sum(validated) from dash_conditions where kind = 'building') = 4, 'a deleted building leaves the validated count');
select tests.ok((select validated from dash_room_usage where usage = 'Usage locked') = 2,
                'rooms in condemned or demolished buildings count as usage locked after validation');
select tests.ok((select nsbi from dash_room_usage where usage = 'Instructional') = 3, 'the NSBI usage is kept as reported');
select tests.ok((select cycle_id from dash_years where has_buildings) = 'SY2025-2026', 'the year selector offers the loaded school year');

select tests.login('ro');
select tests.ok((select count(distinct sdo_code) from dash_conditions) = 2, 'the RO sees every SDO with data');

select tests.logout();
reset role;
rollback;
