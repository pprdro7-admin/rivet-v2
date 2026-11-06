-- One person opening a school page (Engineer, DPO or the school itself)
-- Read-only. Acts as a signed-in user of Bohol or Cebu Province (as the website does), then runs
-- the same reads the screen makes. Used by the "Load test" workflow with pgbench.
\set r random(0, 100000)
begin read only;
set local statement_timeout = '8s';
select set_config('lt.school', s.school_id, true), set_config('lt.sdo', s.sdo_code, true), set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', u.id::text, true) from (select school_id, sdo_code from cycle_schools where cycle_id = 'SY2025-2026' and sdo_code in ('BOH', 'CEB') order by school_id offset (:r % (select count(*) from cycle_schools where cycle_id = 'SY2025-2026' and sdo_code in ('BOH', 'CEB'))) limit 1) s cross join lateral (select coalesce((select id from profiles where role = 'de' and sdo_code = s.sdo_code limit 1), (select id from profiles where role in ('de', 'dpo') and sdo_code = s.sdo_code limit 1), (select id from profiles where role = 'ro' limit 1)) as id) u;
set local role authenticated;
select * from school_tally where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school');
select * from building_status where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school') order by building_no;
select * from room_status where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school') order by building_code, room_no;
select * from live_new_buildings where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school') order by id;
select * from live_new_rooms where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school') order by id;
select * from school_open_items('SY2025-2026', current_setting('lt.school'));
select * from school_updates where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school');
select * from school_relocation where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school');
select * from building_replaces where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school');
select * from school_site_list where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school') order by site_no;
select * from sketch_latest where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school');
select next_building_no('SY2025-2026', current_setting('lt.school'));
select * from building_flag_text where building_id in (select building_id from building_status where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school'));
select * from room_flag_text where room_id in (select room_id from room_status where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school'));
select * from building_watsan_status where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school');
select * from school_table_status where cycle_id = 'SY2025-2026' and school_id = current_setting('lt.school');
commit;
