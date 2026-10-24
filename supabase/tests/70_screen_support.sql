-- The views the screens read.
begin;
set role authenticated;

select tests.login('ro');
select tests.ok((select count(*) from sdo_progress) = 2, 'the RO sees progress for each SDO with schools');
select tests.ok((select schools = 2 and co_rooms = 5 from sdo_progress where sdo_code = 'BOH'), 'progress adds up the School Tally');
select tests.login('de_cbu');
select tests.ok((select count(*) from sdo_progress) = 1, 'an SDO sees only its own progress');
select tests.login('de');
select tests.ok((select flags from room_flag_text where room_id = tests.r('900002001001')) like '[DE] Usage: Instructional%',
                'flags read as one line per record');

rollback;
