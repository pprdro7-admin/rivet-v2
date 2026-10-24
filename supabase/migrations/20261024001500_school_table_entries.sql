-- RIVET V2 · 1500 · Tables 3 to 7 of the SY 2025-2026 template, entered in RIVET (Ada, 24 Oct 2026).
--
-- CO has not released SY 2025-2026 data for Table 3 (TLS and makeshift rooms), Table 4a/4b (water
-- and sanitation), Table 5 (furniture), Table 6 (other facilities) and Table 7 (access). Each school
-- starts blank. The DE or DPO enters what the SDO has; a school's entry waits for the SDO to accept
-- it, as with buildings and rooms. The earlier year's NSBI values are shown beside, for reference
-- only, and are never copied in. When CO releases the data, it loads into co_school_records as the
-- NSBI value and the entries are compared against it.
--
-- Each entry holds the whole table for that school (blank items stay null), so the latest SDO entry
-- is the validated table.

create table school_table_entries (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  co_table    text not null check (co_table in ('T3', 'T4', 'T5', 'T6', 'T7')),
  measures    jsonb not null,
  remarks     text,
  by_school   boolean not null default made_by_school(),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id)
);
create index school_table_entries_idx on school_table_entries (cycle_id, school_id, co_table, id);
create trigger school_table_entries_locked before update or delete on school_table_entries
  for each row execute function forbid_change();

create or replace function record_school_table(
  p_cycle text, p_school text, p_table text, p_seen bigint, p_measures jsonb, p_remarks text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s cycle_schools;
  v_me uuid;
  v_last bigint;
  v_bad text;
  v_id bigint;
begin
  select * into s from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if s.school_id is null then perform refuse('That school is not in this cycle''s NSBI data', 'no_data_found'); end if;
  v_me := assert_can_edit(p_cycle, s.sdo_code, p_school);
  if p_table not in ('T3', 'T4', 'T5', 'T6', 'T7') then perform refuse('Not one of Tables 3 to 7'); end if;

  select max(id) into v_last from school_table_entries where cycle_id = p_cycle and school_id = p_school and co_table = p_table;
  if v_last is distinct from p_seen then
    perform refuse('This table was updated since your screen loaded: reload and try again', 'serialization_failure');
  end if;

  if jsonb_typeof(p_measures) is distinct from 'object' then perform refuse('Give the table''s values'); end if;
  select string_agg(key, ', ') into v_bad from jsonb_each(p_measures)
  where key !~ '^[a-z0-9_]+$'
     or not (jsonb_typeof(value) = 'null'
             or (jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric >= 0
                 and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
                 and (p_table not in ('T6', 'T7') or (value #>> '{}')::numeric in (0, 1))));
  if v_bad is not null then
    perform refuse(case when p_table in ('T6', 'T7') then 'Answer Yes or No: ' else 'Give whole numbers, 0 or more: ' end || v_bad);
  end if;
  if not exists (select 1 from jsonb_each(p_measures) where jsonb_typeof(value) <> 'null') then
    perform refuse('Fill in at least one item');
  end if;

  insert into school_table_entries (cycle_id, school_id, sdo_code, co_table, measures, remarks, recorded_by)
  values (p_cycle, p_school, s.sdo_code, p_table, p_measures, nullif(trim(p_remarks), ''), v_me)
  returning id into v_id;
  return v_id;
end $$;

-- Per school and table: the validated entry (the SDO's latest), a school's update waiting after it,
-- and the latest step id for the screen to send back as p_seen.
create view school_table_status with (security_invoker = true) as
with k as (
  select cycle_id, school_id, co_table, max(id) as last_step_id from school_table_entries group by 1, 2, 3
), v as (
  select distinct on (cycle_id, school_id, co_table) * from school_table_entries
  where not by_school order by cycle_id, school_id, co_table, id desc
), w as (
  select distinct on (cycle_id, school_id, co_table) * from school_table_entries
  order by cycle_id, school_id, co_table, id desc
)
select k.cycle_id, k.school_id, k.co_table, k.last_step_id,
       v.measures as validated, v.remarks as validated_remarks, v.recorded_at as validated_at,
       case when w.by_school then w.measures end as school_update,
       case when w.by_school then w.remarks end as school_update_remarks,
       case when w.by_school then w.recorded_at end as school_update_at
from k
left join v using (cycle_id, school_id, co_table)
join w using (cycle_id, school_id, co_table);

alter table school_table_entries enable row level security;
create policy read_scoped on school_table_entries for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on school_table_entries, school_table_status from anon;
revoke insert, update, delete, truncate on school_table_entries from authenticated;
grant select on school_table_entries, school_table_status to authenticated;
revoke execute on function record_school_table(text, text, text, bigint, jsonb, text) from public, anon;
grant execute on function record_school_table(text, text, text, bigint, jsonb, text) to authenticated;
