-- Summary reports add up the same records as the screens.
begin;
set role authenticated;

select tests.login('ro');
select tests.ok((select sum(rooms_nsbi) from report_facilities) = (select count(*) from co_rooms), 'report rooms (NSBI) match the NSBI rooms');
select tests.ok((select sum(buildings_nsbi) from report_facilities) = (select count(*) from co_buildings), 'report buildings (NSBI) match the NSBI buildings');
select tests.ok((select count(*) from report_facilities) = (select count(*) from cycle_schools s join cycles c on c.id = s.cycle_id and c.role = 'current'),
                'one report line per school');

select tests.login('de');
select tests.ok((select count(distinct sdo_code) from report_facilities) = 1, 'a DE''s reports cover only their SDO');

select tests.logout();
reset role;
rollback;
