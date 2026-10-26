-- RIVET V2 · 2100 · Data-quality flags worked out once per load, not on every page view (26 Oct 2026).
--
-- The flags on CO's buildings and rooms (room_flags, building_flags) depend only on CO's Tables 1
-- and 2, which never change once loaded, yet the Validation list worked them out again for the
-- whole region on every page, which the live database cut off ("canceling statement due to
-- statement timeout", Ada, LLC DPO). They are now kept in two tables, filled when Table 1 or 2
-- loads, and the two views read the tables. Same columns and same rules as before.
-- One difference: "Room code repeated" now always compares the whole region, as written; before,
-- each viewer's own SDO limited the comparison.

create table co_room_flags (
  room_id   bigint not null references co_rooms(id),
  cycle_id  text   not null,
  sdo_code  text   not null,
  school_id text   not null,
  who       text   not null,
  flag      text   not null
);
create index co_room_flags_school_idx on co_room_flags (cycle_id, school_id);
create index co_room_flags_room_idx on co_room_flags (room_id);

create table co_building_flags (
  building_id bigint not null references co_buildings(id),
  cycle_id    text   not null,
  sdo_code    text   not null,
  school_id   text   not null,
  who         text   not null,
  flag        text   not null
);
create index co_building_flags_school_idx on co_building_flags (cycle_id, school_id);
create index co_building_flags_building_idx on co_building_flags (building_id);

-- The rules themselves stay as written in 0400, under new names.
do $$
begin
  execute 'create view room_flags_rules as ' || pg_get_viewdef('room_flags'::regclass);
  execute 'create view building_flags_rules as ' || pg_get_viewdef('building_flags'::regclass);
end $$;
revoke all on room_flags_rules, building_flags_rules from public, anon, authenticated;

create or replace function refresh_co_flags(p_cycle text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from co_room_flags where cycle_id = p_cycle;
  insert into co_room_flags select room_id, cycle_id, sdo_code, school_id, who, flag from room_flags_rules where cycle_id = p_cycle;
  delete from co_building_flags where cycle_id = p_cycle;
  insert into co_building_flags select building_id, cycle_id, sdo_code, school_id, who, flag from building_flags_rules where cycle_id = p_cycle;
end $$;
revoke execute on function refresh_co_flags(text) from public, anon, authenticated;

create or replace function co_flags_after_load() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cycle text;
begin
  for v_cycle in select distinct cycle_id from loaded loop
    perform refresh_co_flags(v_cycle);
  end loop;
  return null;
end $$;
create trigger co_rooms_flags after insert on co_rooms referencing new table as loaded
  for each statement execute function co_flags_after_load();
create trigger co_buildings_flags after insert on co_buildings referencing new table as loaded
  for each statement execute function co_flags_after_load();

select refresh_co_flags(id) from cycles;

create or replace view room_flags with (security_invoker = true) as
select room_id, cycle_id, sdo_code, school_id, who, flag from co_room_flags;
create or replace view building_flags with (security_invoker = true) as
select building_id, cycle_id, sdo_code, school_id, who, flag from co_building_flags;

alter table co_room_flags enable row level security;
alter table co_building_flags enable row level security;
create policy read_scoped on co_room_flags for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
create policy read_scoped on co_building_flags for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on co_room_flags, co_building_flags from anon;
revoke insert, update, delete, truncate on co_room_flags, co_building_flags from authenticated;
grant select on co_room_flags, co_building_flags to authenticated;
