-- RIVET V2 · 0500 · Who can read and write what.
--
-- Row-level security decides what each person reads: a DE or DPO only their own SDO, the RO
-- every SDO. Nobody writes a table directly; the step functions in 0300 and 0400 do it, after
-- their checks. The web app holds no secrets and makes no access decisions of its own.

do $$
declare t text;
begin
  foreach t in array array['sdos', 'cycles', 'building_conditions', 'room_conditions', 'room_usages',
    'actual_usages', 'deletion_reasons', 'source_loads', 'cycle_schools', 'co_buildings', 'co_rooms',
    'co_staging', 'profiles', 'building_validations', 'room_validations', 'new_buildings', 'new_rooms',
    'new_record_withdrawals', 'dpo_checks', 'sdo_signoffs']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Signed-out visitors get nothing.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- Signed-in people never write tables directly.
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant insert, update, delete on profiles to authenticated;   -- limited to the admin by policy below

-- Loading CO's files is for the service role (scripts/load_co_tables.py), never the website.
revoke all on co_staging from authenticated;
revoke execute on function load_co_table(text, text, text, text) from public, authenticated;

-- ── Reference data ──────────────────────────────────────────────────────────────────────────

create policy read_all on sdos                for select to authenticated using (true);
create policy read_all on cycles              for select to authenticated using (true);
create policy read_all on building_conditions for select to authenticated using (true);
create policy read_all on room_conditions     for select to authenticated using (true);
create policy read_all on room_usages         for select to authenticated using (true);
create policy read_all on actual_usages       for select to authenticated using (true);
create policy read_all on deletion_reasons    for select to authenticated using (true);
create policy read_all on source_loads        for select to authenticated using (true);

-- ── Records of one SDO ──────────────────────────────────────────────────────────────────────
-- "(select …)" so the signed-in person is looked up once per query, not once per row.

create policy read_scoped on cycle_schools for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin') or sdo_code = (select current_sdo()));
create policy read_scoped on co_buildings for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin') or sdo_code = (select current_sdo()));
create policy read_scoped on co_rooms for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin') or sdo_code = (select current_sdo()));
create policy read_scoped on new_buildings for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin') or sdo_code = (select current_sdo()));
create policy read_scoped on new_rooms for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin') or sdo_code = (select current_sdo()));
create policy read_scoped on sdo_signoffs for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin') or sdo_code = (select current_sdo()));

create policy read_scoped on building_validations for select to authenticated using (
  exists (select 1 from co_buildings b where b.id = building_id));
create policy read_scoped on room_validations for select to authenticated using (
  exists (select 1 from co_rooms r where r.id = room_id));
create policy read_scoped on new_record_withdrawals for select to authenticated using (
  exists (select 1 from new_buildings nb where nb.id = new_building_id)
  or exists (select 1 from new_rooms nr where nr.id = new_room_id));
create policy read_scoped on dpo_checks for select to authenticated using (
  exists (select 1 from cycle_schools s where s.cycle_id = dpo_checks.cycle_id and s.school_id = dpo_checks.school_id));

-- ── People ──────────────────────────────────────────────────────────────────────────────────

create policy read_scoped on profiles for select to authenticated using (
  id = auth.uid()
  or (select current_app_role()) in ('ro', 'admin')
  or sdo_code = (select current_sdo()));

create policy admin_manage on profiles for all to authenticated
  using ((select current_app_role()) = 'admin') with check ((select current_app_role()) = 'admin');
