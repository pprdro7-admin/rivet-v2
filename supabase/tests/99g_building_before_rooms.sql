-- The SDO gives a building its status before its rooms; a school's own updates are not held back.
begin;
set role authenticated;
select tests.login('de');
select tests.fails(format('select record_room_validation(%s, null, ''correct'')',
                          (select r.id from co_rooms r join co_buildings b on b.id = r.building_id
                            where b.school_id = '900001' and r.room_condition is not null and r.room_usage is not null
                              and cardinality(r.actual_usages) > 0
                              and not exists (select 1 from building_validations v where v.building_id = b.id)
                            order by r.id limit 1)),
                   '23514', 'a room cannot take a status before its building');
select record_building_validation((select min(b.id) from co_buildings b join co_rooms r on r.building_id = b.id
                                    where b.school_id = '900001' and b.building_condition is not null
                                      and r.room_condition is not null and r.room_usage is not null and cardinality(r.actual_usages) > 0),
                                  null, 'correct');
select tests.ok(record_room_validation((select min(r.id) from co_rooms r join building_validations v on v.building_id = r.building_id
                                         where r.room_condition is not null and r.room_usage is not null and cardinality(r.actual_usages) > 0),
                                       null, 'correct') is not null,
                'once the building has a status, its rooms can take one');
select tests.logout();
reset role;
rollback;
