-- The Division Engineer's step on a building, and every refusal from template v3.
begin;
set role authenticated;
select tests.login('de');

select tests.fails(format('select record_building_validation(%s, null, ''correct'', ''Good Condition'')', tests.b('900001001')),
                   '23514', 'correct as is takes no corrections');
select record_building_validation(tests.b('900001001'), null, 'correct');
select tests.ok((select status from building_status where building_code = '900001001') = 'correct', 'a building is validated correct as is');

select tests.fails(format('select record_building_validation(%s, null, ''correct'')', tests.b('900001001')),
                   '40001', 'a step from a stale screen is refused: reload and try again');
select tests.fails(format('select record_building_validation(%s, %s, ''corrected'', ''Needs Minor Repair'')', tests.b('900001001'), tests.seen_b('900001001')),
                   '23514', 'a correction without remarks is refused');
select tests.fails(format('select record_building_validation(%s, %s, ''corrected'', ''Good Condition'', p_remarks => ''x'')', tests.b('900001001'), tests.seen_b('900001001')),
                   '23514', 'a validated condition equal to CO is refused');
select tests.fails(format('select record_building_validation(%s, %s, ''corrected'', p_longitude => 9.9, p_latitude => 123.9, p_remarks => ''GPS'')', tests.b('900001001'), tests.seen_b('900001001')),
                   '23514', 'swapped coordinates are refused');
select tests.fails(format('select record_building_validation(%s, %s, ''corrected'', p_longitude => 123.95, p_remarks => ''GPS'')', tests.b('900001001'), tests.seen_b('900001001')),
                   '23514', 'longitude without latitude is refused');
select record_building_validation(tests.b('900001001'), tests.seen_b('900001001'), 'corrected',
       p_longitude => 123.95, p_latitude => 9.95, p_remarks => 'Coordinates taken on site');
select tests.ok((select final_longitude = 123.95 and longitude = 123.9 from building_status where building_code = '900001001'),
                'a correction is kept beside the CO value, which stays as released');

select tests.fails(format('select record_building_validation(%s, null, ''for_deletion'')', tests.b('900001002')),
                   '23514', 'a deletion without a reason is refused');
select tests.fails(format('select record_building_validation(%s, null, ''for_deletion'', p_reason => ''other'')', tests.b('900001002')),
                   '23514', 'Other (specify) needs remarks');
select tests.fails(format('select record_building_validation(%s, null, ''for_deletion'', p_reason => ''mistaken'')', tests.b('900001003')),
                   '23514', 'a demolished building cannot be deleted');
select record_building_validation(tests.b('900001003'), null, 'correct');
select tests.ok(true, 'a demolished building is kept as is');

select tests.fails(format('select record_building_validation(%s, null, ''correct'')', tests.b('900003001')),
                   '42501', 'a DE cannot validate another SDO''s building');
select tests.login('dpo');
select tests.fails(format('select record_building_validation(%s, null, ''correct'')', tests.b('900001002')),
                   '42501', 'the DPO does not change a building''s status');
select tests.login('ro');
select tests.fails(format('select record_building_validation(%s, null, ''correct'')', tests.b('900001002')),
                   '42501', 'the RO does not validate buildings');

select tests.login('de');
select tests.fails(format('insert into building_validations (building_id, status, recorded_by) values (%s, ''correct'', %L)',
                          tests.b('900001002'), '00000000-0000-0000-0000-000000000001'),
                   '42501', 'nobody writes a validation directly, skipping the rules');
reset role;
select tests.fails('delete from building_validations', '42501', 'validation history cannot be deleted, even by the owner');
select tests.ok((select count(*) from building_validations where building_id = tests.b('900001001')) = 2,
                'both steps on a building are kept');

rollback;
