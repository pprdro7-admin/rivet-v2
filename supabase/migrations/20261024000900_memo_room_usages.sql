-- RIVET V2 · 0900 · Room usages added by the SY 2025-2026 NSBI form.
--
-- CO's memorandum of 24 July 2026 (NSBI Data Collection, section III) adds Guidance Office and
-- Principal's Office to the non-instructional options of Table 2, so a DE can pick them here too.
insert into actual_usages (name, kind) values
  ('Guidance Office', 'non_instructional'),
  ('Principal''s Office', 'non_instructional')
on conflict do nothing;
