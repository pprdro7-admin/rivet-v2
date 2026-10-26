-- Times the screens' main queries on the validation database, as a DPO of each SDO and as the RO,
-- so a slow screen shows up in the workflow log. Reads only; prints timings and row counts.
\timing on
\pset pager off
set statement_timeout = '60s';
select p.sdo_code, p.id as user_id into temporary speed_users
from (select distinct on (sdo_code) sdo_code, id from profiles where role in ('dpo', 'de') and sdo_code is not null order by sdo_code, role desc) p;
\echo === Validation list (school_tally), one SDO per line
do $$
declare u record; r record; t0 timestamptz; n int;
begin
  for u in select * from speed_users order by sdo_code loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u.user_id::text, true);
    t0 := clock_timestamp();
    execute 'set local role authenticated';
    select count(*) into n from school_tally where cycle_id = 'SY2025-2026' and sdo_code = u.sdo_code;
    execute 'reset role';
    raise notice '% school_tally: % schools in % ms', u.sdo_code, n, round(extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  select id into r from profiles where role = 'ro' limit 1;
  if found then
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.id::text, true);
    t0 := clock_timestamp();
    execute 'set local role authenticated';
    select count(*) into n from school_tally where cycle_id = 'SY2025-2026';
    execute 'reset role';
    raise notice 'RO school_tally (region): % schools in % ms', n, round(extract(epoch from clock_timestamp() - t0) * 1000);
    t0 := clock_timestamp();
    execute 'set local role authenticated';
    select count(legislative_district) into n from school_places where cycle_id = 'SY2025-2026';
    execute 'reset role';
    raise notice 'RO school_places (Reports): % schools in % ms', n, round(extract(epoch from clock_timestamp() - t0) * 1000);
  end if;
end $$;
