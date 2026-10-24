-- CO viewers, sending back, and the DPO's school access.
begin;
set role authenticated;

select tests.login('co');
select tests.ok((select count(distinct sdo_code) from cycle_schools) = 2, 'a CO viewer sees every SDO');
select tests.ok((select count(*) from co_rooms) = 6, 'and every room');
select tests.fails(format('select record_building_validation(%s, null, ''correct'')', tests.b('900001001')), '42501', 'a CO viewer records no validation');
select tests.fails('select sign_off_sdo(''SY2025-2026'', ''BOH'')', '42501', 'nor signs off an SDO');
select set_config('tests.poke', poke_ro('SY2025-2026', 'BOH', '900001', 'Please check the condemned building 2')::text, false);
select tests.ok((select state from return_status where id = current_setting('tests.poke')::bigint) = 'open', 'a CO viewer flags a school to the RO');

select tests.login('de');
select tests.ok((select count(*) from return_status where kind = 'co_to_ro') = 0, 'a CO note goes to the RO, not the SDO');
select tests.fails(format('select answer_return(%s, ''x'')', current_setting('tests.poke')), '42501', 'only the RO answers a CO note');

select tests.login('ro');
select answer_return(current_setting('tests.poke')::bigint, 'The DE is re-inspecting this week');
select tests.ok((select state from return_status where id = current_setting('tests.poke')::bigint) = 'answered', 'the RO answers');
select tests.login('co');
select close_return(current_setting('tests.poke')::bigint);
select tests.ok((select state from return_status where id = current_setting('tests.poke')::bigint) = 'closed', 'CO closes it');

-- DE sends back to the school.
select tests.login('de');
select tests.fails('select send_back_to_school(''SY2025-2026'', ''900001'', '''')', '23514', 'a send-back needs a note');
select set_config('tests.ret', send_back_to_school('SY2025-2026', '900001', 'Check building 2',
  jsonb_build_array(jsonb_build_object('kind', 'building', 'id', tests.b('900001002'), 'label', 'Building 2', 'note', 'Is it still used?')))::text, false);
select tests.fails('select send_back_to_school(''SY2025-2026'', ''900001'', ''again'')', '23514', 'one open send-back per school');
select tests.fails('select send_back_to_school(''SY2025-2026'', ''900003'', ''x'')', '42501', 'only for the DE''s own SDO');
select tests.login('school');
select tests.ok((select count(*) from return_status where kind = 'de_to_school') = 1, 'the school sees what was sent back');
select answer_return(current_setting('tests.ret')::bigint, 'Updated building 2');
select tests.fails(format('select close_return(%s)', current_setting('tests.ret')), '42501', 'the school does not close it');
select tests.login('de');
select close_return(current_setting('tests.ret')::bigint, 'Accepted');
select tests.ok((select state from return_status where id = current_setting('tests.ret')::bigint) = 'closed', 'the DE closes it');

-- School access, managed by the DPO.
select tests.login('de');
select tests.fails('select grant_school_access(''900002'', ''head.900002@deped.gov.ph'', ''Head'', ''Passw0rd123'')', '42501', 'only the DPO manages school access');
select tests.login('dpo');
select tests.fails('select grant_school_access(''900002'', ''head@gmail.com'', ''Head'', ''Passw0rd123'')', '23514', 'a DepEd email is required');
select tests.fails('select grant_school_access(''900002'', ''head.900002@deped.gov.ph'', ''Head'', ''short'')', '23514', 'a weak password is refused');
select tests.fails('select grant_school_access(''900003'', ''head.900003@deped.gov.ph'', ''Head'', ''Passw0rd123'')', '42501', 'only for the DPO''s own SDO');
select set_config('tests.g', grant_school_access('900002', 'Head.900002@DepEd.gov.ph', 'Ana Head', 'Passw0rd123', 'School Head')::text, false);
select tests.ok((select role = 'school' and school_id = '900002' and active from profiles where email = 'head.900002@deped.gov.ph'),
                'the account is made with the school role for that School ID');
select tests.fails('select grant_school_access(''900001'', ''head.900002@deped.gov.ph'', ''Ana'', ''Passw0rd123'')', '23514', 'one school per email');
select tests.ok((select count(*) from school_access_list('BOH')) = 1, 'the DPO lists the SDO''s school access');
select reset_school_password(current_setting('tests.g')::bigint, 'NewPassw0rd9');
select remove_school_access(current_setting('tests.g')::bigint, 'Transferred');
select tests.ok(not (select active from profiles where email = 'head.900002@deped.gov.ph'), 'removing access turns the account off');
select tests.fails(format('select reset_school_password(%s, ''Another1pass'')', current_setting('tests.g')), '23514', 'a removed access gets no new password');
select set_config('tests.g2', grant_school_access('900001', 'head.900002@deped.gov.ph', 'Ana Head', 'Passw0rd456', 'School Head')::text, false);
select tests.ok((select active and school_id = '900001' from profiles where email = 'head.900002@deped.gov.ph'), 'after a transfer the same email can get another school');

select tests.logout();
reset role;
select tests.ok((select encrypted_password like '$2%' from auth.users where email = 'head.900002@deped.gov.ph'), 'the password is stored hashed (bcrypt), as Supabase Auth does');
select tests.ok((select count(*) from auth.identities i join auth.users u on u.id = i.user_id where u.email = 'head.900002@deped.gov.ph') = 1,
                'the sign-in has its email identity');
rollback;
