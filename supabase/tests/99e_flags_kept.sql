-- The kept flags are the rules' flags, and a new load refreshes them.
begin;
select tests.ok((select count(*) from room_flags) = (select count(*) from room_flags_rules), 'kept room flags match the rules');
select tests.ok((select count(*) from building_flags) = (select count(*) from building_flags_rules), 'kept building flags match the rules');
select tests.ok(not exists (select room_id, flag from room_flags_rules except select room_id, flag from co_room_flags), 'no room flag is missing');
rollback;
