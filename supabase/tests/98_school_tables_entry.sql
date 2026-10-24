-- Tables 3 to 7 for SY 2025-2026: blank until the SDO enters them; a school's entry waits for the SDO.
begin;
set role authenticated;

select tests.login('school');
select tests.ok(record_school_table('SY2025-2026', '900001', 'T6', null, '{"covered_court": 1, "gymnasium": 0}') is not null,
                'a school enters its own Table 6');
select tests.ok((select validated is null and school_update->>'covered_court' = '1' from school_table_status
                 where school_id = '900001' and co_table = 'T6'), 'a school''s entry waits; nothing is validated yet');
select tests.fails('select record_school_table(''SY2025-2026'', ''900002'', ''T6'', null, ''{"gymnasium": 1}'')', '42501',
                   'a school cannot enter another school''s table');

select tests.login('de');
select tests.fails('select record_school_table(''SY2025-2026'', ''900001'', ''T6'', null, ''{"gymnasium": 1}'')', '40001',
                   'an entry made on an old screen is refused');
select record_school_table('SY2025-2026', '900001', 'T6',
  (select last_step_id from school_table_status where school_id = '900001' and co_table = 'T6'),
  '{"covered_court": 1, "gymnasium": 0}', 'Seen on site');
select tests.ok((select validated->>'covered_court' = '1' and school_update is null from school_table_status
                 where school_id = '900001' and co_table = 'T6'), 'the DE accepts it as validated');
select tests.fails('select record_school_table(''SY2025-2026'', ''900002'', ''T6'', null, ''{"gymnasium": 2}'')', '23514',
                   'Table 6 takes Yes or No only');
select tests.fails('select record_school_table(''SY2025-2026'', ''900002'', ''T5'', null, ''{"num_armchair_es": -3}'')', '23514',
                   'counts are whole numbers, 0 or more');
select tests.fails('select record_school_table(''SY2025-2026'', ''900002'', ''T5'', null, ''{"num_armchair_es": null}'')', '23514',
                   'an entry with nothing filled in is refused');
select tests.ok(record_school_table('SY2025-2026', '900002', 'T5', null, '{"num_armchair_es": 120, "num_oneseater_es": null}') is not null,
                'blank items stay blank');
select tests.fails('select record_school_table(''SY2025-2026'', ''900003'', ''T5'', null, ''{"num_armchair_es": 1}'')', '42501',
                   'a DE enters only their own SDO''s schools');
select tests.fails('insert into school_table_entries (cycle_id, school_id, sdo_code, co_table, measures, recorded_by)
                    values (''SY2025-2026'', ''900001'', ''BOH'', ''T3'', ''{}'', auth.uid())', '42501', 'entries go through the checks only');

select tests.login('school');
select tests.ok((select count(*) from school_table_status) = 1, 'a school sees only its own tables');

select tests.logout();
reset role;
rollback;
