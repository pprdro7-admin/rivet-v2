-- RIVET V2 · 2000 · Relocated schools (Ada, 26 Oct 2026, from a DE's finding).
--
-- A school may have moved since SY 2024-2025, either to a temporary site (for example, the old
-- site was declared unsafe) or to a new school site. Its SY 2025-2026 list was carried over from
-- SY 2024-2025, so it still holds the buildings of the previous site.
--   - The DE or DPO marks the school as relocated, with the kind, the reason and remarks. The
--     mark is kept step by step, like every other record; "not relocated" clears it.
--   - Each building of the previous site is marked For deletion with the reason "At the previous
--     site": it leaves the SY 2025-2026 count but stays on record. Its rooms follow, as for any
--     building for deletion.
--   - Structures at a temporary site are Table 3 (temporary learning spaces and makeshift rooms),
--     not buildings (Ada).

insert into deletion_reasons (code, label, sort, needs_remarks) values
  ('previous_site', 'At the previous site (school relocated)', 7, false)
on conflict (code) do nothing;
update deletion_reasons set sort = 8 where code = 'other';  -- "Other (specify)" stays last

create table school_relocations (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  kind        text not null check (kind in ('temporary_site', 'new_site', 'not_relocated')),
  reason      text check (reason in ('unsafe', 'other')),
  remarks     text,
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id),
  check (kind = 'not_relocated' or reason is not null),
  check (reason is distinct from 'other' or remarks is not null)
);
create index school_relocations_school_idx on school_relocations (cycle_id, school_id, id);
create trigger school_relocations_locked before update or delete on school_relocations
  for each row execute function forbid_change();

create or replace function record_school_relocation(p_cycle text, p_school text, p_kind text,
                                                    p_reason text default null, p_remarks text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_sdo  text;
  v_me   uuid;
  v_id   bigint;
  v_note text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  select sdo_code into v_sdo from cycle_schools where cycle_id = p_cycle and school_id = p_school;
  if v_sdo is null then
    perform refuse('No such school in this cycle', 'no_data_found');
  end if;
  v_me := assert_can_edit(p_cycle, v_sdo, p_school);
  if (select role from profiles where id = v_me) = 'school' then
    perform refuse('The Division Engineer or Planning Officer records a relocation', 'insufficient_privilege');
  end if;
  if p_kind not in ('temporary_site', 'new_site', 'not_relocated') then
    perform refuse('Choose where the school moved');
  end if;
  if p_kind <> 'not_relocated' and p_reason is null then
    perform refuse('Give the reason for the relocation');
  end if;
  if p_reason = 'other' and v_note is null then
    perform refuse('Say what the other reason is, in the remarks');
  end if;
  insert into school_relocations (cycle_id, school_id, sdo_code, kind, reason, remarks, recorded_by)
  values (p_cycle, p_school, v_sdo, p_kind, case when p_kind = 'not_relocated' then null else p_reason end, v_note, v_me)
  returning id into v_id;
  return v_id;
end $$;

-- The school's relocation as last recorded; a school marked "not relocated" again has no row.
create view school_relocation with (security_invoker = true) as
select * from (
  select distinct on (r.cycle_id, r.school_id)
         r.cycle_id, r.school_id, r.sdo_code, r.kind, r.reason, r.remarks, r.recorded_at,
         profile_name(r.recorded_by) as recorded_by_name
  from school_relocations r
  order by r.cycle_id, r.school_id, r.id desc
) x where kind <> 'not_relocated';

alter table school_relocations enable row level security;
create policy read_scoped on school_relocations for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on school_relocations, school_relocation from anon;
revoke insert, update, delete, truncate on school_relocations from authenticated;
grant select on school_relocations, school_relocation to authenticated;
revoke execute on function record_school_relocation(text, text, text, text, text) from public, anon;
grant execute on function record_school_relocation(text, text, text, text, text) to authenticated;
