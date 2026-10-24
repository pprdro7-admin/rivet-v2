-- Who sees what. Row-level security, not the web app, keeps each SDO to its own records.
begin;
set role authenticated;

select tests.login('de');
select tests.ok((select count(*) from co_buildings) = 5 and (select count(distinct sdo_code) from co_rooms) = 1,
                'a Bohol DE sees only Bohol buildings and rooms');
select tests.ok((select count(*) from school_tally) = 2, 'and only Bohol schools in the School Tally');
select tests.ok(not exists (select 1 from room_flags where sdo_code <> 'BOH'), 'and only Bohol flags');

select tests.login('de_cbu');
select tests.ok((select count(*) from co_rooms) = 1, 'a Cebu City DE sees only Cebu City rooms');
select tests.ok((select count(*) from profiles) = 2, 'and only Cebu City people');

select tests.login('ro');
select tests.ok((select count(*) from co_rooms) = 6 and (select count(*) from school_tally) = 3, 'the RO sees every SDO');

select tests.fails('select load_co_table(''SY2025-2026'', ''T1'', ''x'', ''x'')', '42501', 'the website cannot load CO data');
select tests.fails('insert into co_staging values (''T1'', 99, ''{}'')', '42501', 'nor stage it');
select tests.fails('insert into dpo_checks (cycle_id, school_id, result, recorded_by) values (''SY2025-2026'', ''900001'', ''complete'', auth.uid())',
                   '42501', 'nobody writes a DPO check directly');
select tests.fails('update cycles set frozen_at = now()', '42501', 'nobody freezes a cycle directly');

reset role;   -- Supabase Authentication creates the sign-in itself
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'new.de@sample.test');
set role authenticated;
select tests.login('admin');
insert into profiles (id, email, full_name, role, sdo_code) values ('00000000-0000-0000-0000-0000000000aa', 'new.de@sample.test', 'New DE', 'de', 'TAG');
select tests.ok(true, 'the admin adds an account');
select tests.login('de');
update profiles set role = 'ro' where id = auth.uid();
select tests.ok((select role from profiles where id = auth.uid()) = 'de', 'a DE cannot make themself RO');

set role anon;
select tests.fails('select count(*) from co_rooms', '42501', 'signed-out visitors see nothing');
reset role;

-- Every table has row-level security.
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity),
                'every table has row-level security');

rollback;
