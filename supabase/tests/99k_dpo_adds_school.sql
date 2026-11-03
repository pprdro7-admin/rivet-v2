-- The DPO adds a school that is new, or that did not submit its NSBI SY 2025-2026 (Ada, 2026-11-03).
begin;
set role authenticated;

select tests.login('de');
select tests.fails('select add_school(''SY2025-2026'', ''900777'', ''Sample New ES'', ''new_school'')', '42501', 'a DE does not add a school');
select tests.login('school');
select tests.fails('select add_school(''SY2025-2026'', ''900777'', ''Sample New ES'', ''new_school'')', '42501', 'nor does a school account');
select tests.login('dpo');
select tests.fails('select add_school(''SY2025-2026'', ''900001'', ''Again'', ''new_school'')', '23514', 'a School ID already in the list is not added twice');
select tests.fails('select add_school(''SY2025-2026'', ''90077'', ''Sample New ES'', ''new_school'')', '23514', 'the School ID has 6 digits');
select tests.fails('select add_school(''SY2025-2026'', ''900777'', '' '', ''new_school'')', '23514', 'the school needs a name');
select tests.fails('select add_school(''SY2025-2026'', ''900777'', ''Sample New ES'', ''other'')', '23514', 'the reason is new school or no NSBI report');
select add_school('SY2025-2026', '900777', 'Sample New ES', 'no_nsbi_report', 'District I', 'Tagbilaran City', 'Bohol', 'Did not submit');
select tests.ok((select sdo_code = 'BOH' and co_buildings = 0 and not dpo_complete from school_tally where school_id = '900777'),
                'the added school is in the DPO''s Division list, with no NSBI records yet');
select tests.ok((select reason from school_additions where school_id = '900777') = 'no_nsbi_report', 'why it was added is kept');
select tests.login('de');
select add_new_building('SY2025-2026', '900777', 1, 'Good Condition', 'Found on site', 'Academic Building');
select tests.ok((select buildings_after from school_tally where school_id = '900777') = 1, 'the DE adds its buildings like any school');
select tests.login('dpo_cbu');
select tests.ok(not exists (select 1 from school_tally where school_id = '900777'), 'another Division does not see it');

select tests.logout();
reset role;
rollback;
