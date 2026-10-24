-- RIVET V2 · 0800 · The rest of the NSBI: CO's school-level tables.
--
-- Tables 1 and 2 (buildings, rooms) are validated. The other NSBI tables are one row per school
-- and are kept read-only, exactly as CO released them, so each School ID carries every NSBI data
-- element: Table 3 (temporary learning spaces and makeshift rooms), Table 4a/4b (water and
-- sanitation), Table 5 (usable furniture), Table 7 (access going to school), and CO's classroom
-- summary with enrollment (CLS). When a cycle has no release of a table yet, the school page shows
-- the latest cycle that has one (school_other_data).

alter table source_loads drop constraint source_loads_co_table_check;
alter table source_loads add constraint source_loads_co_table_check
  check (co_table in ('T1', 'T2', 'T3', 'T4', 'T5', 'T7', 'CLS'));

-- One row per school per table per cycle. `measures` holds the values under RIVET's names
-- (scripts/load_co_school_tables.py, after the SY 2024-2025 import mapping registry); `co_record`
-- keeps every cell as CO wrote it, keyed by column number and header.
create table co_school_records (
  id         bigint generated always as identity primary key,
  load_id    bigint not null references source_loads(id),
  source_row int    not null,
  cycle_id   text   not null references cycles(id),
  co_table   text   not null,
  school_id  text   not null,
  sdo_code   text   not null references sdos(code),
  measures   jsonb  not null,
  co_record  jsonb  not null,
  unique (load_id, source_row),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create index co_school_records_school_idx on co_school_records (school_id, co_table, cycle_id);
create trigger co_school_records_locked before update or delete on co_school_records
  for each row execute function forbid_change();

-- Staged rows (co_staging) carry {"School ID", "Division", "School Name", "District",
-- "Municipality", "Province", "measures": {...}, "cells": {...}}.
create or replace function load_co_school_table(p_cycle text, p_table text, p_file text, p_sha text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_load bigint;
  v_n    int;
  v_bad  text;
begin
  if p_table not in ('T3', 'T4', 'T5', 'T7', 'CLS') then
    raise exception 'Not a school-level table: %', p_table;
  end if;
  select count(*) into v_n from co_staging where co_table = p_table;
  if v_n = 0 then
    raise exception 'Nothing staged for %', p_table;
  end if;
  select string_agg(distinct rec->>'Division', ', ') into v_bad
  from co_staging st where co_table = p_table
    and not exists (select 1 from sdos where nsbi_name = st.rec->>'Division');
  if v_bad is not null then
    raise exception 'Unknown Division in %: %', p_table, v_bad;
  end if;

  insert into source_loads (cycle_id, co_table, file_name, file_sha256, row_count)
  values (p_cycle, p_table, p_file, p_sha, v_n) returning id into v_load;

  insert into cycle_schools (cycle_id, school_id, school_name, sdo_code, district, municipality, province)
  select distinct on (rec->>'School ID')
         p_cycle, rec->>'School ID', rec->>'School Name', s.code, rec->>'District',
         rec->>'Municipality', rec->>'Province'
  from co_staging st join sdos s on s.nsbi_name = st.rec->>'Division'
  where co_table = p_table
  order by rec->>'School ID', source_row
  on conflict do nothing;

  insert into co_school_records (load_id, source_row, cycle_id, co_table, school_id, sdo_code, measures, co_record)
  select v_load, st.source_row, p_cycle, p_table, st.rec->>'School ID', s.code, st.rec->'measures', st.rec->'cells'
  from co_staging st join sdos s on s.nsbi_name = st.rec->>'Division'
  where st.co_table = p_table order by st.source_row;

  delete from co_staging where co_table = p_table;
  return v_load;
end $$;

-- For each School ID and table, the latest cycle that has it. The school page shows these beside
-- the current cycle's buildings and rooms, labelled with the cycle they come from.
create view school_other_data with (security_invoker = true) as
select distinct on (r.school_id, r.co_table)
       r.school_id, r.co_table, r.cycle_id, c.label as cycle_label, r.measures
from co_school_records r join cycles c on c.id = r.cycle_id
order by r.school_id, r.co_table, r.cycle_id desc, r.source_row;

alter table co_school_records enable row level security;
create policy read_scoped on co_school_records for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin') or sdo_code = (select current_sdo()));
revoke insert, update, delete, truncate on co_school_records from authenticated;
revoke all on co_school_records from anon;
grant select on co_school_records, school_other_data to authenticated;
revoke all on school_other_data from anon;
revoke execute on function load_co_school_table(text, text, text, text) from public, anon, authenticated;
