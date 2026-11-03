-- More landmarks on the site sketch (Ada, 2026-11-03): gymnasium, garden, guardhouse, and other
-- common structures, so fewer have to go under "Other".
alter table sketch_items drop constraint sketch_items_kind_check;
alter table sketch_items add constraint sketch_items_kind_check check (kind in (
  'building', 'watsan', 'court', 'grounds', 'gate', 'flagpole', 'other',
  'gym', 'garden', 'guardhouse', 'canteen', 'stage', 'water_tank', 'parking', 'playground', 'pathway'));
