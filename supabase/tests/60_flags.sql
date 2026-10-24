-- RO auto-flags: same checks and wording as the v5 workbook.
begin;

select tests.ok(exists (select 1 from building_flags where flag = 'Status: For Condemnation but 1 room(s) still Instructional in T2'),
                'a condemned building with Instructional rooms is flagged');
select tests.ok(exists (select 1 from building_flags where flag = 'Tally: building has 0 rooms'), 'a building with 0 rooms is flagged');
select tests.ok(exists (select 1 from room_flags where flag = 'Usage: Instructional but actual usage is ''Not Currently Used'''),
                'an Instructional room not currently used is flagged');
select tests.ok(exists (select 1 from room_flags where flag = 'Status: Instructional room in a building tagged For Condemnation'),
                'an Instructional room in a condemned building is flagged');
select tests.ok((select count(*) from room_flags where room_id = tests.r('900003001001')) = 0, 'a clean room has no flag');
select tests.ok((select flagged_rooms from school_tally where school_id = '900002') = 1, 'the School Tally counts flagged rooms');

rollback;
