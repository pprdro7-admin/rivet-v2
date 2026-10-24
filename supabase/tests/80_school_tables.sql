-- CO's school-level tables (3, 4a/4b, 5, 7, classroom summary) are kept read-only per cycle.
begin;

insert into co_staging values
  ('T3', 8, '{"Division": "Bohol", "School ID": "900001", "School Name": "x", "measures": {"tls_count_es": 2}, "cells": {"19:es": "2"}}'),
  ('T3', 9, '{"Division": "Cebu City", "School ID": "900003", "School Name": "y", "measures": {"tls_count_es": null}, "cells": {}}');
select load_co_school_table('SY2025-2026', 'T3', 'TABLE 3.xlsx', 'sha');
select tests.ok((select count(*) from co_school_records where co_table = 'T3') = 2, 'Table 3 loads one row per school');
select tests.ok((select measures->>'tls_count_es' from school_other_data where school_id = '900001' and co_table = 'T3') = '2',
                'the school page reads the values under RIVET''s names');
select tests.ok((select measures->'tls_count_es' from co_school_records where school_id = '900003') = 'null'::jsonb,
                'a blank cell stays blank, not 0');

insert into co_staging values ('T3', 8, '{"Division": "Bohol", "School ID": "900001", "School Name": "x", "measures": {}, "cells": {}}');
select tests.fails('select load_co_school_table(''SY2025-2026'', ''T3'', ''again'', ''again'')', '23505',
                   'a second Table 3 for the same cycle is refused');
delete from co_staging;

insert into co_staging values ('T5', 8, '{"Division": "Negros Oriental", "School ID": "900001", "School Name": "x", "measures": {}, "cells": {}}');
select tests.fails('select load_co_school_table(''SY2025-2026'', ''T5'', ''x'', ''x'')', 'P0001', 'an unknown Division is refused');
delete from co_staging;

select tests.fails('update co_school_records set measures = ''{}''', '42501', 'a CO school record cannot be edited');

set role authenticated;
select tests.login('de');
select tests.ok((select count(*) from school_other_data) = 1, 'a DE sees only their own SDO''s schools');
select tests.fails('select load_co_school_table(''SY2025-2026'', ''T7'', ''x'', ''x'')', '42501',
                   'the website cannot load CO tables');
select tests.logout();
reset role;

rollback;
