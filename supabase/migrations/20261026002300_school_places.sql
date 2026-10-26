-- RIVET V2 · 2300 · Province, municipality and legislative district per school, for the Reports'
-- Group by (Ada, 26 Oct 2026, as in BEIS).
--
-- Province and municipality are kept in cycle_schools. The legislative district is in CO's
-- Table 1 ("Leg. District", repeated on each building of a school); for a school with no building
-- there, it is taken from the latest earlier release that gives it ("Legislative District").

create view school_places with (security_invoker = true) as
select cs.cycle_id, cs.school_id, cs.school_name, cs.sdo_code, cs.district, cs.municipality, cs.province,
       coalesce(
         (select nullif(btrim(b.co_record->>'Leg. District'), '')
            from co_buildings b
           where b.cycle_id = cs.cycle_id and b.school_id = cs.school_id
             and nullif(btrim(b.co_record->>'Leg. District'), '') is not null
           order by b.id limit 1),
         (select nullif(btrim(e.value), '')
            from co_school_records r, jsonb_each_text(r.co_record) e
           where r.school_id = cs.school_id and r.cycle_id <= cs.cycle_id
             and e.key ~ ':(Legislative District|Leg\. District)$' and nullif(btrim(e.value), '') is not null
           order by r.cycle_id desc, r.id limit 1)) as legislative_district
from cycle_schools cs;

revoke all on school_places from anon;
grant select on school_places to authenticated;
