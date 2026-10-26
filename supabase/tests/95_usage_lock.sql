-- A room that cannot be used (condemned, under construction, or in such a building) takes no usage entries.
begin;
-- This file checks room rules alone; the building-first order has its own test (99g).
alter table room_validations disable trigger room_validations_building_first;
set role authenticated;
select tests.login('de');

-- 900001002 is For Condemnation in the NSBI; its room 900001002001 is Instructional, Needs Major Repair.
select tests.ok((select usage_locked from room_status where room_code = '900001002001'), 'a room in a condemned building is locked');
select tests.ok(not (select usage_locked from room_status where room_code = '900001001001'), 'a room in a good building is not');
select tests.fails(format('select record_room_validation(%s, null, ''corrected'', p_actual_usages => array[''Offices''], p_remarks => ''x'')', tests.r('900001002001')),
                   '23514', 'no actual usage is entered for a room in a condemned building');
select tests.fails(format('select record_room_validation(%s, null, ''corrected'', p_usage => ''Non-Instructional'', p_remarks => ''x'')', tests.r('900001002001')),
                   '23514', 'its room usage cannot be changed either');
select tests.ok(record_room_validation(tests.r('900001002001'), null, 'corrected', p_condition => 'Condemned', p_remarks => 'Cracked columns') is not null,
                'its condition can still be corrected');
select tests.ok((select instructional_rooms_after from school_tally where school_id = '900001') = 1,
                'only the good building''s Instructional room counts; the locked one does not');
select tests.ok((select rooms_after from school_tally where school_id = '900001') = 4, 'but it stays in the room tally');

-- A room in a good building, set to a condemned condition, locks in the same step.
select tests.fails(format('select record_room_validation(%s, null, ''corrected'', p_condition => ''Condemned'', p_actual_usages => array[''Offices''], p_remarks => ''x'')', tests.r('900001001001')),
                   '23514', 'a room made condemned takes no usage in the same step');
select record_room_validation(tests.r('900001001001'), null, 'corrected', p_condition => 'Condemned', p_remarks => 'Fire damage');
select tests.ok((select usage_locked from room_status where room_code = '900001001001'), 'once condemned, the room is locked');

-- A building validated as condemned locks its rooms.
select record_building_validation(tests.b('900002001'), null, 'corrected', p_condition => 'Condemned / For Demolition', p_remarks => 'Engineer''s report');
select tests.ok((select usage_locked from room_status where room_code = '900002001001'), 'a building made condemned locks its rooms');
select tests.ok(record_room_validation(tests.r('900002001001'), tests.seen_r('900002001001'), 'correct') is not null,
                'a locked room can still be confirmed as is, even with its NSBI usage');

-- Buildings and rooms under construction lock the same way.
select tests.ok((select bool_and(locks_usage) from building_conditions where name in ('For Completion', 'On-going Construction')),
                'For Completion and On-going Construction buildings lock usage');
select tests.ok((select locks_usage from room_conditions where name = 'On-going Construction'), 'an On-going Construction room locks usage');
select tests.ok(not (select locks_usage from building_conditions where name = 'Needs Major Repair'), 'Needs Major Repair does not');

-- New rooms.
select tests.fails(format('select add_new_room(%s, null, ''Good Condition'', ''Instructional'', array[''Grade 3 Classroom''], ''x'')', tests.b('900001003')),
                   '23514', 'a new room in a demolished building takes no usage');
select tests.ok(add_new_room(tests.b('900001003'), null, 'Condemned', null, null, 'Missed room') is not null,
                'a new room in a condemned building is added without usage');
select tests.fails(format('select add_new_room(%s, null, ''Good Condition'', null, array[''Offices''], ''x'')', tests.b('900001001')),
                   '23514', 'a new room in a good building still needs its usage');

select tests.logout();
reset role;
rollback;
