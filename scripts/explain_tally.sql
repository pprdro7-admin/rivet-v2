-- Shows how the database runs the Validation list for one SDO (psql -v sdo=BOH), as that SDO's DPO or DE.
\pset pager off
begin;
select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', id::text, true)
from profiles where sdo_code = :'sdo' and role in ('dpo', 'de') order by role desc limit 1 \gset
set local role authenticated;
explain (analyze, buffers, costs off)
select * from school_tally where cycle_id = 'SY2025-2026' and sdo_code = :'sdo' order by school_id limit 1000;
rollback;
