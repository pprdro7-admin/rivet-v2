-- One person opening a school page (Engineer, DPO or the school itself)
-- Read-only. Acts as a signed-in user of Bohol or Cebu Province (as the website does), then runs
-- the same reads the screen makes, with the same literal values. Used by the "Load test" workflow with pgbench.
\set r random(0, 100000)
select s.school_id as sid, s.sdo_code as sdo, u.id as uid from (select school_id, sdo_code from cycle_schools where cycle_id = 'SY2025-2026' and sdo_code in ('BOH', 'CEB') order by school_id offset (:r % (select count(*) from cycle_schools where cycle_id = 'SY2025-2026' and sdo_code in ('BOH', 'CEB'))) limit 1) s cross join lateral (select coalesce((select id from profiles where role = 'de' and sdo_code = s.sdo_code limit 1), (select id from profiles where role in ('de', 'dpo') and sdo_code = s.sdo_code limit 1), (select id from profiles where role = 'ro' limit 1)) as id) u \gset
begin read only;
set local statement_timeout = '8s';
select set_config('request.jwt.claims', json_build_object('sub', ':uid', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', ':uid', true);
set local role authenticated;
select * from school_tally where cycle_id = 'SY2025-2026' and school_id = ':sid';
select * from building_status where cycle_id = 'SY2025-2026' and school_id = ':sid' order by building_no;
select * from room_status where cycle_id = 'SY2025-2026' and school_id = ':sid' order by building_code, room_no;
select * from live_new_buildings where cycle_id = 'SY2025-2026' and school_id = ':sid' order by id;
select * from live_new_rooms where cycle_id = 'SY2025-2026' and school_id = ':sid' order by id;
select * from school_open_items('SY2025-2026', ':sid');
select * from school_updates where cycle_id = 'SY2025-2026' and school_id = ':sid';
select * from school_relocation where cycle_id = 'SY2025-2026' and school_id = ':sid';
select * from building_replaces where cycle_id = 'SY2025-2026' and school_id = ':sid';
select * from school_site_list where cycle_id = 'SY2025-2026' and school_id = ':sid' order by site_no;
select * from sketch_latest where cycle_id = 'SY2025-2026' and school_id = ':sid';
select next_building_no('SY2025-2026', ':sid');
select * from building_flag_text where building_id in (select building_id from building_status where cycle_id = 'SY2025-2026' and school_id = ':sid');
select * from room_flag_text where room_id in (select room_id from room_status where cycle_id = 'SY2025-2026' and school_id = ':sid');
select * from building_watsan_status where cycle_id = 'SY2025-2026' and school_id = ':sid';
select * from school_table_status where cycle_id = 'SY2025-2026' and school_id = ':sid';
commit;
