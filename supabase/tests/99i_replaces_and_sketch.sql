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
select tests.ok(not (select waits_for_engineer from sketch_state where school_id = '900001'), 'a sketch drawn by the DE waits for no one');
select record_sketch_item('SY2025-2026', '900001', 'm:2', 'gate', 'Gate', 1, 40, 40, 60, 30);
select tests.ok((select by_school from sketch_items where school_id = '900001' and item_key = 'm:2' order by id desc limit 1),
                'the school may place items on its own sketch');
select tests.ok((select waits_for_engineer from sketch_state where school_id = '900001'), 'the school''s placing waits for the Engineer');
select tests.fails('select confirm_sketch(''SY2025-2026'', ''900001'')', '42501', 'a school account does not confirm the sketch');
select tests.login('de');
select tests.fails('select confirm_sketch(''SY2025-2026'', ''900002'')', '23514', 'an empty sketch cannot be confirmed');
select confirm_sketch('SY2025-2026', '900001');
select tests.ok(not (select waits_for_engineer from sketch_state where school_id = '900001')
                and (select confirmed_at is not null from sketch_state where school_id = '900001'), 'the Engineer confirms the sketch');
select tests.login('school');
select record_sketch_item('SY2025-2026', '900001', 'm:2', 'gate', 'Gate', 1, 80, 40, 60, 30);
select tests.ok((select waits_for_engineer from sketch_state where school_id = '900001'), 'a school change after confirmation waits again');
select tests.login('de');
select confirm_sketch('SY2025-2026', '900001');
select tests.login('school');
select tests.fails('select record_site_fence(''SY2025-2026'', ''900001'', 1, ''[[10,10],[700,10]]'')', '23514', 'a fence needs at least 3 corners');
select tests.fails('select record_site_fence(''SY2025-2026'', ''900001'', 1, ''[[10,10],[900,10],[10,400]]'')', '23514', 'fence corners stay on the drawing');
select tests.fails('select record_site_fence(''SY2025-2026'', ''900001'', 1, ''[[10,10],[700,10],[10,400]]'', ''{5}'')', '23514', 'an open side is one of the fence''s sides');
select tests.fails('select record_site_fence(''SY2025-2026'', ''900001'', 7, ''[[10,10],[700,10],[10,400]]'')', '23514', 'a fence goes on an existing site');
select record_site_fence('SY2025-2026', '900001', 1, '[[20,20],[760,20],[760,300],[400,300],[400,440],[20,440]]', '{3}');
select tests.ok((select jsonb_array_length(points) = 6 and open_sides = '{3}' and by_school from site_fence_latest where school_id = '900001' and site_no = 1),
                'the school traces the actual fence, any shape, with a side marked open');
select tests.ok((select waits_for_engineer from sketch_state where school_id = '900001'), 'a school''s fence waits for the Engineer');
select record_site_fence('SY2025-2026', '900001', 1, null, '{}', true);
select tests.ok(not exists (select 1 from site_fence_latest where school_id = '900001'), 'a fence can be cleared back to the plain boundary');
select tests.fails('select record_building_replaces(''SY2025-2026'', ''900001'', 4, null)', '42501',
                   'a school account does not mark replacements');

select tests.logout();
reset role;
rollback;
