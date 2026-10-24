-- RIVET V2 · 0110 · Reference data: SDOs, cycles and the template's drop-down lists.

insert into sdos (code, name, nsbi_name) values
  ('BOH', 'Bohol',           'Bohol'),
  ('CEB', 'Cebu Province',   'Cebu'),
  ('CBU', 'Cebu City',       'Cebu City'),
  ('MDE', 'Mandaue City',    'Mandaue City'),
  ('LLC', 'Lapu-Lapu City',  'Lapu-Lapu City'),
  ('TAL', 'Talisay City',    'Talisay City'),
  ('TOL', 'Toledo City',     'Toledo City'),
  ('DAN', 'Danao City',      'Danao City'),
  ('CAR', 'Carcar City',     'Carcar City'),
  ('NAG', 'Naga City',       'City of Naga, Cebu'),
  ('BOG', 'Bogo City',       'Bogo City'),
  ('TAG', 'Tagbilaran City', 'Tagbilaran City');

insert into cycles (id, label, role, co_as_of) values
  ('SY2024-2025', 'SY 2024–2025', 'prior',   null),
  ('SY2025-2026', 'SY 2025–2026', 'current', '2026-10-21');

insert into building_conditions (name, sort, is_condemned, is_demolished) values
  ('Good Condition',             1, false, false),
  ('Needs Minor Repair',         2, false, false),
  ('Needs Major Repair',         3, false, false),
  ('For Completion',             4, false, false),
  ('On-going Construction',      5, false, false),
  ('For Condemnation',           6, true,  false),
  ('Condemned / For Demolition', 7, true,  false),
  ('Demolished',                 8, true,  true);

insert into room_conditions (name, sort, is_condemned) values
  ('Good Condition',                  1, false),
  ('Needs Minor Repair',              2, false),
  ('Needs Major Repair',              3, false),
  ('On-going Construction',           4, false),
  ('For Condemnation/For Demolition', 5, true),
  ('Condemned / For Demolition',      6, true),
  ('Condemned',                       7, true);

insert into room_usages (name, sort) values
  ('Instructional', 1), ('Non-Instructional', 2), ('Combination', 3);

insert into actual_usages (name, kind) values
  ('Kindergarten Classroom', 'classroom'), ('Kindergarten Classroom - Multiple', 'classroom'),
  ('Grade 1 Classroom', 'classroom'),  ('Grade 1 Classroom - Multiple', 'classroom'),
  ('Grade 2 Classroom', 'classroom'),  ('Grade 2 Classroom - Multiple', 'classroom'),
  ('Grade 3 Classroom', 'classroom'),  ('Grade 3 Classroom - Multiple', 'classroom'),
  ('Grade 4 Classroom', 'classroom'),  ('Grade 4 Classroom - Multiple', 'classroom'),
  ('Grade 5 Classroom', 'classroom'),  ('Grade 5 Classroom - Multiple', 'classroom'),
  ('Grade 6 Classroom', 'classroom'),  ('Grade 6 Classroom - Multiple', 'classroom'),
  ('Grade 7 Classroom', 'classroom'),  ('Grade 7 Classroom - Multiple', 'classroom'),
  ('Grade 8 Classroom', 'classroom'),  ('Grade 8 Classroom - Multiple', 'classroom'),
  ('Grade 9 Classroom', 'classroom'),  ('Grade 9 Classroom - Multiple', 'classroom'),
  ('Grade 10 Classroom', 'classroom'), ('Grade 10 Classroom - Multiple', 'classroom'),
  ('Grade 11 Classroom', 'classroom'), ('Grade 11 Classroom - Multiple', 'classroom'),
  ('Grade 12 Classroom', 'classroom'), ('Grade 12 Classroom - Multiple', 'classroom'),
  ('Classroom SPED', 'classroom'),
  ('ALS Room', 'classroom'),
  ('Library/Learning Resource Center', 'non_instructional'),
  ('Offices', 'non_instructional'),
  ('Faculty Room', 'non_instructional'),
  ('Supply Room', 'non_instructional'),
  ('Clinic', 'non_instructional'),
  ('Conference Room', 'non_instructional'),
  ('Canteen', 'non_instructional'),
  ('Data File Room/Records Room', 'non_instructional'),
  ('Student Co-Curricular Center', 'non_instructional'),
  ('Youth Development Center', 'non_instructional'),
  ('Not Currently Used', 'not_used'),
  ('Computer Room', 'neutral'),
  ('Science Laboratory', 'neutral'),
  ('Research Laboratory', 'neutral'),
  ('Speech Laboratory', 'neutral'),
  ('Home Economic Room', 'neutral'),
  ('Industrial Arts Room', 'neutral'),
  ('Audio Visual Room', 'neutral'),
  ('Museum', 'neutral'),
  ('Others', 'neutral');

insert into deletion_reasons (code, label, sort, needs_remarks) values
  ('mistaken',      'Mistakenly added / encoded', 1, false),
  ('not_standard',  'Not a standard building (PTA-funded, private or temporary structure)', 2, false),
  ('other_school',  'Belongs to another school (school became stand-alone)', 3, false),
  ('shared_site',   'Duplicate declaration on a shared site', 4, false),
  ('duplicate_row', 'Duplicate row', 5, false),
  ('other',         'Other (specify)', 6, true);
