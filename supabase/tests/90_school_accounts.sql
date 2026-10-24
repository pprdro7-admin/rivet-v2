-- Pilot: a school updates its own records; the SDO's step is what counts as validated.
begin;
set role authenticated;

select tests.login('school');
select tests.ok((select count(*) from cycle_schools) = 1, 'a school sees only its own School ID');
select tests.ok((select count(*) from co_buildings where school_id <> '900001') = 0, 'a school sees none of the other schools'' buildings');
select tests.ok((select count(*) from profiles) = 1, 'a school sees only its own account');

select record_building_validation(tests.b('900001002'), null, 'corrected', p_condition => 'Needs Minor Repair', p_remarks => 'Roof leaks');
select tests.ok((select status from building_status where building_code = '900001002') is null,
                'a school''s update does not count as validated');
select tests.ok((select validated_condition from school_updates where kind = 'building') = 'Needs Minor Repair',
                'the update waits for the SDO beside the record');
select tests.fails(format('select record_building_validation(%s, null, ''correct'')', tests.b('900002001')),
                   '42501', 'a school cannot update another school');
select tests.fails('select record_dpo_check(''SY2025-2026'', ''900001'', ''complete'')', '42501', 'a school does not do the DPO check');

select tests.login('de');
select tests.ok((select count(*) from school_updates) = 1, 'the DE sees the school''s update');
select record_building_validation(tests.b('900001002'), (select last_step_id from building_status where building_code = '900001002'),
                                  'corrected', p_condition => 'Needs Minor Repair', p_remarks => 'Roof leaks, seen on site');
select tests.ok((select status from building_status where building_code = '900001002') = 'corrected', 'the DE accepts it as validated');
select tests.ok((select count(*) from school_updates) = 0, 'an accepted update no longer waits');

select tests.logout();
reset role;
rollback;
