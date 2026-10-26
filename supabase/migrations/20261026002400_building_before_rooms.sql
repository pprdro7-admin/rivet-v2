-- The SDO gives a building its status before its rooms (Ada, 2026-10-26): the building's
-- condition decides whether its rooms are usage-locked. Room entries made earlier stay as they are.
-- School updates are not held back: they wait for the SDO, who accepts them in the same order.
create or replace function building_before_rooms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.by_school and not exists (
       select 1 from co_rooms r join building_validations v on v.building_id = r.building_id and not v.by_school
       where r.id = new.room_id) then
    perform refuse('Give the building a status first, then its rooms');
  end if;
  return new;
end $$;

revoke execute on function building_before_rooms() from public, anon;

create trigger room_validations_building_first before insert on room_validations
  for each row execute function building_before_rooms();
