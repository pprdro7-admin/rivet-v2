-- Reports' Group by: one place line per school, with the legislative district from CO's Table 1.
begin;
select tests.ok((select count(*) from cycles where id = 'SY2021-2022' and role = 'prior') = 1, 'SY 2021-2022 is a prior cycle');
select tests.ok((select count(*) from school_places) = (select count(*) from cycle_schools), 'one place line per school and cycle');
alter table co_buildings disable trigger co_buildings_locked;  -- a fixture value, rolled back
update co_buildings set co_record = co_record || '{"Leg. District": "1st District"}'
 where id = (select min(id) from co_buildings where cycle_id = 'SY2025-2026');
select tests.ok((select legislative_district from school_places p join co_buildings b using (cycle_id, school_id)
                  where b.id = (select min(id) from co_buildings where cycle_id = 'SY2025-2026')) = '1st District',
                'the legislative district comes from Table 1');
rollback;
