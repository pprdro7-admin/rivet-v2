-- Fictional sample accounts, for local runs and the validation site only. Never production.
-- Names and emails are made up; School IDs in the 900000 range do not exist.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'de.bohol@sample.test'),
  ('00000000-0000-0000-0000-000000000002', 'dpo.bohol@sample.test'),
  ('00000000-0000-0000-0000-000000000003', 'de.cebucity@sample.test'),
  ('00000000-0000-0000-0000-000000000004', 'dpo.cebucity@sample.test'),
  ('00000000-0000-0000-0000-000000000005', 'ro@sample.test'),
  ('00000000-0000-0000-0000-000000000006', 'admin@sample.test');

insert into profiles (id, email, full_name, role, sdo_code) values
  ('00000000-0000-0000-0000-000000000001', 'de.bohol@sample.test',     'Sample DE, Bohol',      'de',    'BOH'),
  ('00000000-0000-0000-0000-000000000002', 'dpo.bohol@sample.test',    'Sample DPO, Bohol',     'dpo',   'BOH'),
  ('00000000-0000-0000-0000-000000000003', 'de.cebucity@sample.test',  'Sample DE, Cebu City',  'de',    'CBU'),
  ('00000000-0000-0000-0000-000000000004', 'dpo.cebucity@sample.test', 'Sample DPO, Cebu City', 'dpo',   'CBU'),
  ('00000000-0000-0000-0000-000000000005', 'ro@sample.test',           'Sample RO PPRD',        'ro',    null),
  ('00000000-0000-0000-0000-000000000006', 'admin@sample.test',        'Sample administrator',  'admin', null);
