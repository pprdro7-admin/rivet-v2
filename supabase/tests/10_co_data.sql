-- CO's data is loaded as released and cannot be changed afterwards.
begin;

select tests.ok((select count(*) from co_buildings) = 6 and (select count(*) from co_rooms) = 6,
                'the fixture loads 6 buildings and 6 rooms');
select tests.ok((select count(*) from cycle_schools where cycle_id = 'SY2025-2026') = 3, 'schools are taken from the CO files');
select tests.ok((select count(*) from co_rooms where building_id is null) = 0, 'every room finds its building');
select tests.ok((select sdo_code from cycle_schools where school_id = '900003') = 'CBU', 'the Division name maps to its SDO');
select tests.ok((select co_record->>'Building Type' from co_buildings where building_code = '900001001') = 'DepED Standard School Building',
                'every CO column is kept as released');
select tests.ok((select actual_usages from co_rooms where room_code = '900001001002') = array['Offices', 'Faculty Room'],
                'Actual Usage/s is split into a list');

select tests.fails('update co_buildings set building_condition = ''Good Condition'' where building_code = ''900001002''',
                   '42501', 'a CO building cannot be edited, even by the owner');
select tests.fails('delete from co_rooms where room_code = ''900001003001''', '42501', 'a CO room cannot be deleted, even by the owner');
select tests.fails('update source_loads set file_sha256 = ''x''', '42501', 'a source load cannot be edited');

insert into co_staging values ('T1', 2, '{"Division": "Bohol", "School ID": "900001", "School Name": "x", "Building Code": "900001009"}');
select tests.fails('select load_co_table(''SY2025-2026'', ''T1'', ''again'', ''again'')', '23505',
                   'a second Table 1 for the same cycle is refused');
delete from co_staging;

insert into co_staging values ('T1', 2, '{"Division": "Negros Oriental", "School ID": "900009", "School Name": "x", "Building Code": "900009001"}');
select tests.fails('select load_co_table(''SY2024-2025'', ''T1'', ''x'', ''x'')', 'P0001', 'an unknown Division is refused');
delete from co_staging;

insert into co_staging values ('T2', 2, '{"Division": "Bohol", "School ID": "900001", "School Name": "x", "Building Code": "900001001"}');
select tests.fails('select load_co_table(''SY2024-2025'', ''T2'', ''x'', ''x'')', 'P0001', 'Table 2 cannot be loaded before Table 1');

rollback;
