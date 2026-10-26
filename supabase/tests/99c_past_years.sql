-- Earlier school years load like SY 2024-2025: buildings by condition (BLD) and Table 6 too, and a
-- past year never becomes the school page's reference over a later one.
begin;

select tests.ok((select count(*) from cycles where id in ('SY2022-2023', 'SY2023-2024') and role = 'prior') = 2,
                'SY 2022-2023 and SY 2023-2024 are prior cycles');

insert into co_staging values
  ('BLD', 7, '{"Division": "Bohol", "School ID": "900001", "School Name": "x", "measures": {"Good Condition": 3, "Needs Major Repair": 1}, "cells": {}}');
select load_co_school_table('SY2023-2024', 'BLD', 'buildings by condition.xlsx', 'sha');
insert into co_staging values
  ('T6', 8, '{"Division": "Bohol", "School ID": "900001", "School Name": "x", "measures": {"covered_court": 1, "covered_court_es": 1}, "cells": {}}');
select load_co_school_table('SY2023-2024', 'T6', 'other facilities.xlsx', 'sha');
select tests.ok((select count(*) from co_school_records where cycle_id = 'SY2023-2024') = 2, 'BLD and Table 6 load for a past year');
select tests.ok(exists (select 1 from cycle_schools where cycle_id = 'SY2023-2024' and school_id = '900001'),
                'the past year keeps its own school list');

insert into co_staging values
  ('T6', 8, '{"Division": "Bohol", "School ID": "900001", "School Name": "x", "measures": {"covered_court": 0}, "cells": {}}');
select load_co_school_table('SY2022-2023', 'T6', 'other facilities 2022.xlsx', 'sha');
select tests.ok((select cycle_id from school_other_data where school_id = '900001' and co_table = 'T6') = 'SY2023-2024',
                'the school page shows the latest year CO released, not an older one loaded later');

select tests.fails('select load_co_school_table(''SY2023-2024'', ''T1'', ''x'', ''x'')', 'P0001', 'Table 1 rows do not load as a school-level table');

set role authenticated;
select tests.login('de');
select tests.ok((select count(*) from co_school_records where cycle_id = 'SY2023-2024') = 2, 'a DE of the SDO sees its past years');
select tests.logout();
reset role;
rollback;
