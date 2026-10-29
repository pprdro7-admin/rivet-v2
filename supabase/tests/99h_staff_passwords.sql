-- The Regional Office sets a new password for any account but RO and admin; nobody else can.
begin;
set role authenticated;
select tests.login('ro');
select tests.ok((select count(*) from staff_accounts()) >= 5, 'the RO sees the Engineer, Planning Officer and view-only accounts');
select tests.ok((select bool_and(role in ('de', 'dpo', 'co', 'school')) from staff_accounts()), 'the list holds no RO or admin account');
select tests.ok(exists (select 1 from staff_accounts() where role = 'school'), 'school accounts are listed too');
select reset_staff_password('00000000-0000-0000-0000-000000000001', 'Bohol2026x');
reset role;
select tests.ok((select encrypted_password = extensions.crypt('Bohol2026x', encrypted_password) from auth.users
                 where id = '00000000-0000-0000-0000-000000000001'), 'the new password is set');
select tests.ok(exists (select 1 from auth.identities where user_id = '00000000-0000-0000-0000-000000000001' and provider = 'email'),
                'the sign-in has an email identity');
set role authenticated;
select tests.ok((select last_reset_at is not null from staff_accounts() where id = '00000000-0000-0000-0000-000000000001'),
                'the reset is kept on record');
select tests.fails($$select reset_staff_password('00000000-0000-0000-0000-000000000002', 'short1')$$, '23514', 'a weak password is refused');
select tests.fails($$select reset_staff_password('00000000-0000-0000-0000-000000000006', 'Admin2026x')$$, '23514', 'an admin password is not reset here');
select tests.logout();
select tests.login('dpo');
select tests.fails($$select reset_staff_password('00000000-0000-0000-0000-000000000001', 'Bohol2026y')$$, '42501', 'a DPO cannot reset an Engineer''s password');
select tests.fails($$select * from staff_accounts()$$, '42501', 'a DPO cannot list the accounts');
select tests.logout();
reset role;
rollback;
