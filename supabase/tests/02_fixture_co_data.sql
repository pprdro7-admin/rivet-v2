-- LOCAL TESTING ONLY. A tiny fictional CO release, loaded the way the real files are.
--
-- School 900001 (Bohol): a good building with 2 rooms, a building For Condemnation still holding
--   an Instructional room, a Demolished building.
-- School 900002 (Bohol): a room tagged Instructional but Not Currently Used, a building with 0 rooms.
-- School 900003 (Cebu City): one building, one room.

insert into co_staging (co_table, source_row, rec)
select 'T1', row_number() over () + 1, jsonb_build_object(
  'Level of Education', 'Elementary', 'Region', 'Region VII', 'Division', d, 'District', 'Sample District',
  'School ID', s, 'School Name', n, 'Building Code', c, 'Building No.', no, 'Building Type', 'DepED Standard School Building',
  'Building Condition', cond, 'Number of Storeys', 1, 'Number of Rooms', rooms, 'Longitude', 123.9, 'Latitude', 9.9)
from (values
  ('Bohol',     '900001', 'Sample Elementary School',      '900001001', 1, 'Good Condition',   2),
  ('Bohol',     '900001', 'Sample Elementary School',      '900001002', 2, 'For Condemnation', 1),
  ('Bohol',     '900001', 'Sample Elementary School',      '900001003', 3, 'Demolished',       1),
  ('Bohol',     '900002', 'Specimen Primary School',       '900002001', 1, 'Needs Minor Repair', 1),
  ('Bohol',     '900002', 'Specimen Primary School',       '900002002', 2, 'Good Condition',   0),
  ('Cebu City', '900003', 'Example National High School',  '900003001', 1, 'Good Condition',   1)
) as t(d, s, n, c, no, cond, rooms);
select load_co_table('SY2025-2026', 'T1', 'fixture T1', 'fixture');

insert into co_staging (co_table, source_row, rec)
select 'T2', row_number() over () + 1, jsonb_build_object(
  'Status of Submission', 'Validated', 'Division', d, 'School ID', s, 'School Name', n,
  'Building Code', b, 'Building Condition', bc, 'Room Code', rc, 'Room Number', rn,
  'Room Condition', cond, 'Room Usage', u, 'Actual Usage/s', au)
from (values
  ('Bohol',     '900001', 'Sample Elementary School',     '900001001', 'Good Condition',     '900001001001', 1, 'Good Condition',     'Instructional',     'Grade 1 Classroom'),
  ('Bohol',     '900001', 'Sample Elementary School',     '900001001', 'Good Condition',     '900001001002', 2, 'Good Condition',     'Non-Instructional', 'Offices,Faculty Room'),
  ('Bohol',     '900001', 'Sample Elementary School',     '900001002', 'For Condemnation',   '900001002001', 1, 'Needs Major Repair', 'Instructional',     'Grade 2 Classroom'),
  ('Bohol',     '900001', 'Sample Elementary School',     '900001003', 'Demolished',         '900001003001', 1, 'Condemned',          'Non-Instructional', 'Not Currently Used'),
  ('Bohol',     '900002', 'Specimen Primary School',      '900002001', 'Needs Minor Repair', '900002001001', 1, 'Needs Minor Repair', 'Instructional',     'Not Currently Used'),
  ('Cebu City', '900003', 'Example National High School', '900003001', 'Good Condition',     '900003001001', 1, 'Good Condition',     'Instructional',     'Grade 7 Classroom')
) as t(d, s, n, b, bc, rc, rn, cond, u, au);
select load_co_table('SY2025-2026', 'T2', 'fixture T2', 'fixture');
