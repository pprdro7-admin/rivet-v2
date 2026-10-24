-- The Division Engineer's step on a room.
begin;
set role authenticated;
select tests.login('de');

select tests.fails(format('select record_room_validation(%s, null, ''correct'')', tests.r('900002001001')),
                   '23514', 'an Instructional room that is not currently used cannot be confirmed as is');
select tests.fails(format('select record_room_validation(%s, null, ''corrected'', p_actual_usages => array[''Grade 3 Classrom''], p_remarks => ''x'')', tests.r('900002001001')),
                   '23514', 'an Actual Usage value outside the list is refused');
select record_room_validation(tests.r('900002001001'), null, 'corrected', p_usage => 'Non-Instructional',
       p_remarks => 'No learners this year');
select tests.ok((select final_usage = 'Non-Instructional' and room_usage = 'Instructional' from room_status where room_code = '900002001001'),
                'an unused room becomes Non-Instructional beside the CO value');

select record_room_validation(tests.r('900001001001'), null, 'correct');
select record_room_validation(tests.r('900001001002'), null, 'corrected', p_actual_usages => array['Offices'], p_remarks => 'Faculty moved');
select tests.ok((select final_actual_usages from room_status where room_code = '900001001002') = array['Offices'],
                'a corrected actual usage is kept');

-- When a building is for deletion, its rooms must each be decided by the DE.
select record_building_validation(tests.b('900001002'), null, 'for_deletion', p_reason => 'not_standard');
select tests.ok((select needs_room_decision from room_status where room_code = '900001002001'),
                'a room kept in a building for deletion is flagged until the DE decides it');
select tests.fails(format('select record_room_validation(%s, null, ''for_deletion'', p_condition => ''Good Condition'', p_reason => ''mistaken'')', tests.r('900001002001')),
                   '23514', 'a room for deletion takes no corrections');
select record_room_validation(tests.r('900001002001'), null, 'for_deletion', p_reason => 'not_standard');
select tests.ok(not (select needs_room_decision from room_status where room_code = '900001002001'), 'once deleted too, the flag clears');

rollback;
