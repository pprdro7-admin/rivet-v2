-- A relocated school: the DE or DPO marks it, kept step by step; previous-site buildings leave the
-- count through the "At the previous site" deletion reason.
begin;
set role authenticated;

select tests.login('school');
select tests.fails('select record_school_relocation(''SY2025-2026'', ''900001'', ''temporary_site'', ''unsafe'')', '42501',
                   'a school account cannot mark its own relocation');

select tests.login('de');
select tests.fails('select record_school_relocation(''SY2025-2026'', ''900001'', ''temporary_site'')', '23514',
                   'a relocation needs a reason');
select tests.fails('select record_school_relocation(''SY2025-2026'', ''900001'', ''new_site'', ''other'')', '23514',
                   'an other reason needs remarks');
select record_school_relocation('SY2025-2026', '900001', 'temporary_site', 'unsafe', 'Classes held at the barangay hall');
select tests.ok((select kind from school_relocation where school_id = '900001') = 'temporary_site', 'the school shows as relocated to a temporary site');
select record_school_relocation('SY2025-2026', '900001', 'new_site', 'unsafe');
select tests.ok((select kind from school_relocation where school_id = '900001') = 'new_site', 'the latest mark is the one shown');
select record_school_relocation('SY2025-2026', '900001', 'not_relocated');
select tests.ok(not exists (select 1 from school_relocation where school_id = '900001'), '"not relocated" clears the mark');
select tests.ok((select count(*) from school_relocations where school_id = '900001') = 3, 'every mark stays on record');
select tests.fails('select record_school_relocation(''SY2025-2026'', ''900003'', ''new_site'', ''unsafe'')', '42501',
                   'a DE cannot mark a school of another SDO');

select tests.ok(exists (select 1 from deletion_reasons where code = 'previous_site'), 'buildings of the previous site have their own deletion reason');

select tests.logout();
reset role;
rollback;
