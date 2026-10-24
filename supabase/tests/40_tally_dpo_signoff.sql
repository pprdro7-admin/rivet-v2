-- The tally, the DPO's check, the RO's sign-off and the validated baseline.
begin;
set role authenticated;
select tests.login('de');

-- Tally flows from Table 2 to Table 1.
select tests.ok((select tally_check from building_status where building_code = '900001001') = 'Same as CO (2)', 'tally starts the same as CO');
select record_room_validation(tests.r('900001001002'), null, 'for_deletion', p_reason => 'duplicate_row');
select tests.ok((select tally_check from building_status where building_code = '900001001') = 'Changed: CO 2 -> now 1',
                'deleting a room changes its building''s validated room count');
select add_new_room(tests.b('900001001'), null, 'Good Condition', 'Instructional', array['Grade 3 Classroom'], 'Built 2026, not yet in NSBI', 3);
select tests.ok((select tally_check from building_status where building_code = '900001001') = 'Same as CO (2)',
                'a new room in an existing building counts in its tally');
select tests.fails('select add_new_building(''SY2025-2026'', ''900001'', 4, ''Good Condition'', '''')', '23514', 'a new building needs remarks');
select set_config('tests.nb', add_new_building('SY2025-2026', '900001', 4, 'On-going Construction', 'Two-classroom building started 2026')::text, false);
select add_new_room(null, current_setting('tests.nb')::bigint, 'On-going Construction', 'Instructional', array['Grade 4 Classroom'], 'Part of the new building');

-- The DPO's check.
select tests.login('dpo');
select tests.fails('select record_dpo_check(''SY2025-2026'', ''900001'', ''complete'')', '23514', 'a school with records lacking a status cannot be complete');
select tests.fails('select record_dpo_check(''SY2025-2026'', ''900001'', ''returned'')', '23514', 'a return needs DPO remarks');
select record_dpo_check('SY2025-2026', '900001', 'returned', 'Please finish building 2');
select tests.fails('select record_dpo_check(''SY2025-2026'', ''900003'', ''returned'', ''x'')', '42501', 'a DPO cannot check another SDO''s school');

select tests.login('de');
select record_building_validation(tests.b('900001001'), null, 'correct');
select record_building_validation(tests.b('900001002'), null, 'for_deletion', p_reason => 'not_standard');
select record_building_validation(tests.b('900001003'), null, 'correct');
select record_room_validation(tests.r('900001001001'), null, 'correct');
select record_room_validation(tests.r('900001003001'), null, 'correct');
select tests.login('dpo');
select tests.fails('select record_dpo_check(''SY2025-2026'', ''900001'', ''complete'')', '23514',
                   'a room kept in a building for deletion stops the school from being complete');
select tests.login('de');
select record_room_validation(tests.r('900001002001'), null, 'for_deletion', p_reason => 'not_standard');

select tests.login('dpo');
select record_dpo_check('SY2025-2026', '900001', 'complete');
select tests.ok((select dpo_complete and share_validated = 1 from school_tally where school_id = '900001'), 'the school is complete at 100% validated');
select tests.ok((select buildings_after = 3 and rooms_after = 4 and rooms_for_deletion = 2 and instructional_rooms_after = 3
                 from school_tally where school_id = '900001'),
                'counts after validation leave out deletions and add the new records');

select tests.login('de');
select add_new_room(tests.b('900001003'), null, 'Condemned', 'Non-Instructional', array['Supply Room'], 'Missed room');
select tests.ok(not (select dpo_complete from school_tally where school_id = '900001'), 'a later step by the DE reopens the school');
select tests.login('dpo');
select record_dpo_check('SY2025-2026', '900001', 'complete');

-- RO sign-off.
select tests.login('ro');
select tests.fails('select sign_off_sdo(''SY2025-2026'', ''BOH'')', '23514', 'an SDO cannot be signed off while a school is not complete');
select tests.login('de');
select record_building_validation(tests.b('900002001'), null, 'correct');
select record_building_validation(tests.b('900002002'), null, 'for_deletion', p_reason => 'mistaken');
select record_room_validation(tests.r('900002001001'), null, 'corrected', p_usage => 'Non-Instructional', p_remarks => 'No learners');
select tests.login('dpo');
select record_dpo_check('SY2025-2026', '900002', 'complete');
select tests.fails('select sign_off_sdo(''SY2025-2026'', ''BOH'')', '42501', 'only the RO signs off an SDO');
select tests.login('ro');
select sign_off_sdo('SY2025-2026', 'BOH', 'Certification received');
select tests.login('de');
select tests.fails(format('select record_room_validation(%s, %s, ''correct'')', tests.r('900001003001'), tests.seen_r('900001003001')),
                   '23514', 'nothing more is recorded for a signed-off SDO');

select tests.login('ro');
select tests.fails('select freeze_cycle(''SY2025-2026'')', '23514', 'a cycle cannot be frozen while an SDO is not signed off');

-- The validated baseline.
select tests.ok((select count(*) from baseline_buildings where school_id = '900001') = 3
                and not exists (select 1 from baseline_buildings where building_code = '900001002'),
                'the baseline leaves out buildings for deletion and adds new buildings');
select tests.ok((select count(*) from baseline_rooms where school_id = '900001') = 5, 'the baseline counts kept and new rooms');
select tests.ok((select number_of_rooms from baseline_buildings where origin = 'New' and school_id = '900001') = 1,
                'a new building carries the rooms listed under it');
select tests.ok((select count(*) from co_buildings where school_id = '900001') = 3, 'deleted records stay in the CO data');

rollback;
