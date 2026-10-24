-- Classroom gap: MATATAG class sizes against usable instructional rooms after validation.
begin;
insert into co_staging (co_table, source_row, rec) values
  ('LIS', 7, '{"School ID": "900001", "Division": "Bohol", "grades": {"kinder": 61, "g1": 30, "g2": 30, "g3": 30, "g4": 46, "g5": 0, "g6": 0, "es_ng": 4}}'),
  ('LIS', 8, '{"School ID": "900003", "Division": "Cebu City", "grades": {"g7": 90, "g11": 41}}');
select load_enrollment('SY2024-2025', 'LIS BOSY (fixture)', 'fixture.xlsx', 'x');
select tests.fails('select load_enrollment(''SY2024-2025'', ''x'', ''f'', ''s'')', 'P0001', 'nothing staged is refused');

set role authenticated;
select tests.login('de');
-- 900001: Kinder 61 -> 3 classes -> 2 rooms; G1-3 90 -> 3; G4-6 46 -> 2; total 7 rooms needed.
select tests.ok((select rooms_needed from classroom_gap where school_id = '900001') = 7, 'rooms needed follow the MATATAG class sizes, Kinder in two sessions');
select tests.ok((select learners from classroom_gap where school_id = '900001') = 201, 'learners include non-graded SNEd');
-- Usable: 900001001001 (Instructional, good building). 900001002001 is in a condemned building: locked.
select tests.ok((select usable_rooms = 1 and locked_rooms = 2 and gap = 6 from classroom_gap where school_id = '900001'),
                'only unlocked Instructional rooms count as usable; the gap is the difference');
select tests.ok((select gap is null and not has_enrollment from classroom_gap where school_id = '900002'),
                'a school without an enrollment record has no gap, not 0');
select tests.ok((select count(*) from classroom_gap where sdo_code <> 'BOH') = 0, 'a DE sees only their SDO''s schools');
select tests.ok((select count(*) from enrollments where sdo_code <> 'BOH') = 0, 'and only their SDO''s enrollment');
select tests.ok((select sum(nsbi) from dash_by_school where kind = 'building') = 5, 'the drill-down adds up to the dashboard');
select tests.ok((select school_name from dash_by_school where kind = 'building' and label = 'Demolished') = 'Sample Elementary School',
                'a bar lists the schools behind it');

select tests.login('ro');
select tests.ok((select rooms_needed from classroom_gap where school_id = '900003') = 4, 'JHS (90 learners, 45 a class) and SHS (41, 40 a class) need 2 rooms each');
select tests.fails('insert into enrollments (load_id, school_year, school_id, sdo_code) values (1, ''x'', ''1'', ''BOH'')', '42501', 'the website cannot add enrollment');

select tests.logout();
reset role;
rollback;
