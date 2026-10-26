-- RIVET V2 · 1900 · Earlier school years for the reports (Ada, 26 Oct 2026).
--
-- CO's school-level releases for SY 2022-2023 and SY 2023-2024, kept read-only as released, so the
-- reports can go back year by year. SY 2021-2022 is added once the Region VII file is in hand.
-- Two more school-level tables load the same way as Tables 3 to 7:
--   BLD  number of buildings by condition, per school (CO's summary of Table 1)
--   T6   other facilities (CO released a regional Table 6 for these two years)

insert into cycles (id, label, role) values
  ('SY2022-2023', 'SY 2022–2023', 'prior'),
  ('SY2023-2024', 'SY 2023–2024', 'prior')
on conflict (id) do nothing;

alter table source_loads drop constraint source_loads_co_table_check;
alter table source_loads add constraint source_loads_co_table_check
  check (co_table in ('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CLS', 'BLD'));

create or replace function load_co_school_table(p_cycle text, p_table text, p_file text, p_sha text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_load bigint;
  v_n    int;
  v_bad  text;
begin
  if p_table not in ('T3', 'T4', 'T5', 'T6', 'T7', 'CLS', 'BLD') then
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
revoke execute on function load_co_school_table(text, text, text, text) from public, anon, authenticated;
