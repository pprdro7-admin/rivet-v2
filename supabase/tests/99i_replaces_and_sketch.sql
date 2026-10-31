-- Building numbers are never reused, a new building can replace a demolished one, and the site sketch
-- keeps each box's place on the main or an adjacent site.
begin;
set role authenticated;

select tests.login('de');
select tests.ok(next_building_no('SY2025-2026', '900001') = 4, 'the next number is one above the highest, demolished included');
select tests.fails('select add_new_building(''SY2025-2026'', ''900001'', 3, ''Good Condition'', ''Built 2026'')', '23514',
                   'the number of the demolished Building 3 is not reused');
select add_new_building('SY2025-2026', '900001', 4, 'Good Condition', 'Built 2026 where Building 3 stood', 'DepEd Standard School Building');
select tests.ok(next_building_no('SY2025-2026', '900001') = 5, 'the new building takes the last number');

select tests.fails('select record_building_replaces(''SY2025-2026'', ''900001'', 4, 1)', '23514',
                   'a building in good condition is not replaced');
select tests.fails('select record_building_replaces(''SY2025-2026'', ''900001'', 4, 9)', '23514',
                   'the replaced building must be in the school');
select record_building_replaces('SY2025-2026', '900001', 4, 3);
select tests.ok((select replaces_no from building_replaces where school_id = '900001' and building_no = 4) = 3,
                'Building 4 shows as replacing Building 3');
select record_building_replaces('SY2025-2026', '900001', 4, null);
select tests.ok(not exists (select 1 from building_replaces where school_id = '900001'), 'the mark can be cleared');
select tests.ok((select count(*) from building_replacements where school_id = '900001') = 2, 'every mark stays on record');
select record_building_replaces('SY2025-2026', '900001', 4, 3);

select record_sketch_item('SY2025-2026', '900001', 'b:1', 'building', null, 1, 40, 40, 120, 60);
select record_sketch_item('SY2025-2026', '900001', 'b:1', 'building', null, 1, 300, 60, 120, 60);
select tests.ok((select x from sketch_latest where school_id = '900001' and item_key = 'b:1') = 300, 'the latest place is the one shown');
select tests.fails('select record_sketch_item(''SY2025-2026'', ''900001'', ''b:2'', ''building'', null, 2, 40, 40, 120, 60)', '23514',
                   'a building goes on an adjacent site only once that site is added');
select record_school_site('SY2025-2026', '900001', 2, 'Across the road');
select record_sketch_item('SY2025-2026', '900001', 'b:4', 'building', null, 2, 60, 60, 140, 70);
select record_sketch_item('SY2025-2026', '900001', 'm:1', 'watsan', 'WATSAN', 1, 140, 130, 70, 40);
select tests.ok((select count(*) from sketch_latest where school_id = '900001') = 3, 'buildings and landmarks are on the sketch');
select tests.fails('select record_school_site(''SY2025-2026'', ''900001'', 2, null, true)', '23514',
                   'a site with buildings on it is not removed');
select tests.fails('select record_sketch_item(''SY2025-2026'', ''900001'', ''b:9'', ''building'', null, 1, 40, 40, 120, 60)', '23514',
                   'only the school''s own buildings are placed');
select tests.fails('select record_sketch_item(''SY2025-2026'', ''900003'', ''m:1'', ''gate'', ''Gate'', 1, 40, 40, 60, 30)', '42501',
                   'a DE cannot draw a school of another SDO');

select tests.login('school');
select tests.ok((select count(*) from sketch_latest where school_id = '900001') = 3, 'the school sees its sketch');
select tests.fails('select record_sketch_item(''SY2025-2026'', ''900001'', ''m:2'', ''gate'', ''Gate'', 1, 40, 40, 60, 30)', '42501',
                   'a school account does not draw the sketch');
select tests.fails('select record_building_replaces(''SY2025-2026'', ''900001'', 4, null)', '42501',
                   'a school account does not mark replacements');

select tests.logout();
reset role;
rollback;
