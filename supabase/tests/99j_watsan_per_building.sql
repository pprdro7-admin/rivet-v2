-- Table 4A per building: each WATSAN row belongs to a Table 1 building, a building for deletion
-- carries none, and one condemned or demolished is flagged for the Engineer.
begin;
set role authenticated;

select tests.login('de');
select tests.fails('select record_building_watsan(''SY2025-2026'', ''900001'', 9, null, ''{"toilet_male": 2}'')', '23514',
                   'a building not in Table 1 carries no WATSAN');
select tests.fails('select record_building_watsan(''SY2025-2026'', ''900001'', 1, null, ''{"toilet_male": -1}'')', '23514',
                   'counts are whole numbers, 0 or more');
select tests.fails('select record_building_watsan(''SY2025-2026'', ''900001'', 1, null, ''{"septic_tank": 2}'')', '23514',
                   'the septic tank is Yes or No');
select tests.fails('select record_building_watsan(''SY2025-2026'', ''900001'', 1, null, ''{"bowls": 2}'')', '23514',
                   'only the Table 4A items are kept');
select record_building_watsan('SY2025-2026', '900001', 1, null, '{"toilet_male": 2, "toilet_female": 2, "sink": 3, "septic_tank": 1}');
select tests.ok((select (validated ->> 'toilet_male')::int from building_watsan_status where school_id = '900001' and building_no = 1) = 2,
                'Building 1 shows its WATSAN');
select tests.fails('select record_building_watsan(''SY2025-2026'', ''900001'', 1, null, ''{"toilet_male": 3}'')', '40001',
                   'a stale screen cannot overwrite a newer entry');
select record_building_watsan('SY2025-2026', '900001', 2, null, '{"toilet_male": 1}');
select tests.ok((select flag from building_watsan_status where school_id = '900001' and building_no = 2) like '%For Condemnation%',
                'WATSAN in a building For Condemnation is flagged');
select tests.ok((select flag from building_watsan_status where school_id = '900001' and building_no = 1) is null,
                'WATSAN in a good building is not flagged');
select record_building_watsan('SY2025-2026', '900001', 2,
  (select last_step_id from building_watsan_status where school_id = '900001' and building_no = 2), null, true, 'Toilets moved to Building 1');
select tests.ok((select validated is null and flag is null from building_watsan_status where school_id = '900001' and building_no = 2),
                'a removed row is no longer counted or flagged');
select tests.ok((select count(*) from building_watsan_entries where school_id = '900001' and building_no = 2) = 2, 'every step stays on record');
select tests.fails('select record_building_watsan(''SY2025-2026'', ''900003'', 1, null, ''{"toilet_male": 1}'')', '42501',
                   'a DE cannot enter another SDO''s school');

select tests.login('school');
select record_building_watsan('SY2025-2026', '900001', 1,
  (select last_step_id from building_watsan_status where school_id = '900001' and building_no = 1), '{"toilet_male": 3, "toilet_female": 2}');
select tests.ok((select (validated ->> 'toilet_male')::int = 2 and (school_update ->> 'toilet_male')::int = 3
                   from building_watsan_status where school_id = '900001' and building_no = 1),
                'a school''s update waits beside the validated row');

select tests.logout();
reset role;
rollback;
