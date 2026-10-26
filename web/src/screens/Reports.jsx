import React, { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Loading } from '../components/ui.jsx';
import { CYCLE, n, ratio, REGION_ROLES } from '../lib/labels.js';
import { fetchAll } from '../lib/fetchAll.js';

// Summary reports, in the manner of BEIS: filters on top, the list of reports below, each report a
// table grouped by region, division, district, province, municipality, legislative district or
// school that prints cleanly and downloads to Excel.
// A report lists only the school years it has data for. SY 2025-2026 is the year being validated:
// on its own a report shows the NSBI beside the validated record; beside earlier years it stands
// for its validated record. An earlier year is CO's release for that year.
// Every report reads per-school lines and adds them up here, so a group's figure is always the sum
// of its schools (ratios are worked out from the sums, never averaged).

const LEVELS = {
  all: ['All levels', null],
  es: ['Elementary', /_(es|elem)$/],
  sec: ['Secondary (JHS and SHS)', /_(jhs|shs|ss)$/],
};
const GROUPS = { region: 'Region', sdo: 'Division (SDO)', district: 'District', province: 'Province', municipality: 'Municipality',
  legislative: 'Legislative District', school: 'School' };

const sumKeys = (m, re, level) => Object.entries(m || {}).reduce((a, [k, v]) => (
  re.test(k) && (!level || level.test(k) || !/_(es|elem|jhs|shs|ss)$/.test(k)) && typeof v === 'number' ? a + v : a), 0);

// Per-school loaders. Each returns { rows: [{ school_id, ...numbers }], source }.
const load = {
  facilities: async (db, f) => ({
    rows: await fetchAll(() => scoped(db.from('report_facilities').select('*').eq('cycle_id', CYCLE).order('school_id'), f)),
    source: 'NSBI 2025–2026 (as of 31 May 2026), with the SDO validation recorded in RIVET',
  }),
  byCondition: (kind) => async (db, f) => {
    const raw = await fetchAll(() => scoped(db.from('dash_by_school').select('school_id, label, nsbi, validated').eq('cycle_id', CYCLE).eq('kind', kind).order('school_id').order('label'), f));
    const by = {};
    raw.forEach((r) => {
      const x = by[r.school_id] ?? (by[r.school_id] = { school_id: r.school_id, total_nsbi: 0, total_validated: 0 });
      x[`v:${r.label}`] = (x[`v:${r.label}`] ?? 0) + Number(r.validated);
      x.total_nsbi += Number(r.nsbi);
      x.total_validated += Number(r.validated);
    });
    return { rows: Object.values(by), source: 'Validated record, SY 2025–2026; NSBI total for comparison' };
  },
  gap: async (db, f) => {
    const rows = await fetchAll(() => scoped(db.from('classroom_gap').select('*').eq('cycle_id', CYCLE).order('school_id'), f));
    const e = rows.find((r) => r.has_enrollment);
    return {
      rows: rows.filter((r) => r.has_enrollment).map((r) => ({ ...r, short: Math.max(0, r.gap), schools_short: r.gap > 0 ? 1 : 0 })),
      source: e ? `Learners: ${e.enrollment_source} (${e.enrollment_year.replace('SY', 'SY ')}). Rooms: usable instructional rooms in the validated record` : 'Needs LIS enrollment, not loaded yet',
    };
  },
  // Buildings by condition: the validated record for SY 2025-2026; CO's per-school summary of
  // Table 1 for an earlier year.
  bcond: async (db, f) => {
    if (f.year === CYCLE) return load.byCondition('building')(db, f);
    const rows = await fetchAll(() => scoped(db.from('co_school_records').select('school_id, sdo_code, measures').eq('cycle_id', f.year).eq('co_table', 'BLD').order('school_id'), f, false));
    return {
      co: true,
      rows: rows.map((r) => {
        const x = { school_id: r.school_id, sdo_code: r.sdo_code, total_nsbi: 0 };
        CONDITIONS_CO.forEach((k) => { const v = r.measures[k]; if (typeof v === 'number') { x[`v:${k}`] = v; x.total_nsbi += v; } });
        return x;
      }),
      source: `${yearText(f.year)}: CO's number of buildings by condition`,
    };
  },
  // Learners by level from LIS, for any school year loaded.
  enrol: async (db, f) => {
    // The year's latest load only, should LIS's file for a year ever be loaded twice.
    const l = await db.from('enrollment_loads').select('id, source').eq('school_year', f.year).order('id', { ascending: false }).limit(1);
    const rows = l.data?.length ? await fetchAll(() => scoped(db.from('enrollments').select('*').eq('load_id', l.data[0].id).order('school_id'), f, false)) : [];
    const add = (r, ks) => ks.reduce((a, k) => a + (r[k] ?? 0), 0);
    return {
      rows: rows.map((r) => ({ school_id: r.school_id, sdo_code: r.sdo_code, m: {
        k_es: r.kinder ?? 0, g1_6_es: add(r, ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']), ng_es: r.es_ng ?? 0,
        g7_10_jhs: add(r, ['g7', 'g8', 'g9', 'g10']), ng_jhs: r.jhs_ng ?? 0, g11_12_shs: add(r, ['g11', 'g12']) } })),
      source: `${yearText(f.year)}: ${l.data?.[0]?.source ?? 'LIS'} (public schools)`,
    };
  },
  // Classroom ratio: the validated record for SY 2025-2026. For an earlier year, instructional
  // rooms from CO's classroom summary and learners from LIS for the same year (CO's own learner
  // columns where LIS for that year is not loaded; SY 2023-2024's summary has none).
  ratio: async (db, f) => {
    if (f.year === CYCLE) return load.gap(db, f);
    const level = LEVELS[f.level][1];
    const [rows, lis] = await Promise.all([
      fetchAll(() => scoped(db.from('co_school_records').select('school_id, sdo_code, measures').eq('cycle_id', f.year).eq('co_table', 'CLS').order('school_id'), f, false)),
      load.enrol(db, f),
    ]);
    const learners = Object.fromEntries(lis.rows.map((r) => [r.school_id, sumKeys(r.m, /./, level)]));
    const useLis = lis.rows.length > 0;
    return {
      rows: rows.map((r) => ({ school_id: r.school_id, sdo_code: r.sdo_code,
        learners: useLis ? learners[r.school_id] ?? 0 : sumKeys(r.measures, /^enrollment_(es|jhs|shs)$/, level),
        usable_rooms: sumKeys(r.measures, /^instructional_rooms_/, level) })),
      source: `${yearText(f.year)}: instructional rooms from CO's classroom summary; learners from ${useLis ? lis.source.replace(`${yearText(f.year)}: `, '') : 'the same summary'}`,
    };
  },
  // Tables 3 to 7: CO's release for a past year; for SY 2025-2026, the SDO's validated entries.
  table: (code) => async (db, f) => {
    if (f.year === CYCLE) {
      // school_table_status has no SDO column: RLS scopes it, and the SDO filter is applied when grouping.
      const rows = await fetchAll(() => db.from('school_table_status').select('school_id, validated').eq('cycle_id', CYCLE).eq('co_table', code).not('validated', 'is', null).order('school_id'));
      return { rows: rows.map((r) => ({ school_id: r.school_id, m: r.validated })), source: `SY 2025–2026: entries validated by the SDO in RIVET (CO has not released Table ${code.slice(1)})` };
    }
    const rows = await fetchAll(() => scoped(db.from('co_school_records').select('school_id, sdo_code, measures').eq('cycle_id', f.year).eq('co_table', code).order('school_id'), f, false));
    return { rows: rows.map((r) => ({ school_id: r.school_id, sdo_code: r.sdo_code, m: r.measures })), source: `NSBI ${yearText(f.year)} as released by CO` };
  },
  tally: async (db, f) => {
    const [rows, ret] = await Promise.all([
      fetchAll(() => scoped(db.from('school_tally').select('*').eq('cycle_id', CYCLE).order('school_id'), f)),
      fetchAll(() => scoped(db.from('return_status').select('school_id, state').eq('cycle_id', CYCLE).eq('kind', 'de_to_school').neq('state', 'closed').order('id'), f, false)),
    ]);
    const sent = new Set(ret.map((r) => r.school_id));
    return { rows: rows.map((r) => ({ ...r, sent_back: sent.has(r.school_id) ? 1 : 0 })), source: 'RIVET validation record, SY 2025–2026' };
  },
};

// The building conditions in CO's per-school summary (it has no Demolished).
const CONDITIONS_CO = ['Good Condition', 'Needs Minor Repair', 'Needs Major Repair', 'For Completion', 'On-going Construction', 'For Condemnation', 'Condemned / For Demolition'];
const yearText = (y) => y.replace('SY', 'SY ').replace('-', '–');
// "2023–2026" for the span from SY 2023-2024 to SY 2025-2026.
const PLACE = 'school_id, school_name, sdo_code, district, province, municipality, legislative_district';
const spanText = (from, to) => `${from.slice(2, 6)}–${to.slice(7, 11)}`;
// The school years a report has, latest first: SY 2025-2026 (the year being validated) and the
// years CO released its source table for; LIS's school years for the learners.
// A school-level table (3 to 6) has SY 2025-2026 once the SDO has validated entries for it.
function yearsFor(r, avail) {
  if (!r.src) return [CYCLE];
  if (r.src === 'LIS') return [...(avail.LIS ?? [])].sort().reverse();
  const now = !r.table || avail.now?.[r.loader.toUpperCase()];
  return [...new Set([...(now ? [CYCLE] : []), ...(avail[r.src] ?? [])])].sort().reverse();
}

function scoped(q, f, hasDistrict = true) {
  let x = q;
  if (f.sdo) x = x.eq('sdo_code', f.sdo);
  if (f.district && hasDistrict) x = x.eq('district', f.district);
  return x;
}

const col = (key, label, get, fmt) => ({ key, label, get: get ?? ((r) => Number(r[key] ?? 0)), fmt });

const REPORTS = [
  { group: 'Physical Facilities', id: 'instructional', title: 'Instructional Rooms', loader: 'facilities', src: 'CLS', prior: /^instructional_rooms_/, validated: 'instructional_validated',
    note: 'SY 2025–2026: NSBI is the rooms each school encoded as instructional in the NSBI (as of 31 May 2026); Validated is the usable rooms after the SDO\'s validation in RIVET. Rooms that are condemned or under construction, or in such a building, are usage-locked and counted apart. Earlier years: CO\'s number of classrooms, as released.',
    columns: [col('instructional_nsbi', 'NSBI'), col('instructional_validated', 'Validated'), col('chg', 'Change', (r) => Number(r.instructional_validated) - Number(r.instructional_nsbi), signed), col('rooms_locked', 'Usage locked')] },
  { group: 'Physical Facilities', id: 'noninstructional', title: 'Non-Instructional Rooms', loader: 'facilities', src: 'CLS', prior: /^noninstructional_rooms_/, validated: 'noninstructional_validated',
    note: 'SY 2025–2026: NSBI as encoded by the schools, beside the validated record. Earlier years: CO\'s number of classrooms, as released.',
    columns: [col('noninstructional_nsbi', 'NSBI'), col('noninstructional_validated', 'Validated'), col('chg', 'Change', (r) => Number(r.noninstructional_validated) - Number(r.noninstructional_nsbi), signed)] },
  { group: 'Physical Facilities', id: 'kinder', title: 'Kindergarten Instructional Rooms', loader: 'facilities',
    note: 'Instructional rooms whose actual usage includes a Kindergarten classroom.',
    columns: [col('kinder_nsbi', 'NSBI'), col('kinder_validated', 'Validated'), col('chg', 'Change', (r) => Number(r.kinder_validated) - Number(r.kinder_nsbi), signed)] },
  { group: 'Physical Facilities', id: 'bcond', title: 'Buildings by Condition', loader: 'bcond', conditions: 'bcond', src: 'BLD',
    note: 'SY 2025–2026: the validated record. Earlier years: CO\'s number of buildings by condition, as released.' },
  { group: 'Physical Facilities', id: 'rcond', title: 'Rooms by Condition', loader: 'rcond', conditions: 'rcond' },
  { group: 'Physical Facilities', id: 'unsafe', title: 'Condemned and Under Construction', loader: 'facilities',
    note: 'From the validated record. Usage-locked rooms take no usage and are not counted as instructional.',
    columns: [col('buildings_condemned', 'Buildings condemned'), col('buildings_ongoing', 'Buildings under construction or for completion'),
      col('rooms_condemned', 'Rooms condemned'), col('rooms_ongoing', 'Rooms under construction'), col('rooms_locked', 'Rooms usage-locked')] },
  { group: 'Physical Facilities', id: 't3', title: 'Temporary Learning Spaces and Makeshift Rooms', loader: 't3', table: true, src: 'T3',
    columns: [mcol('tls', 'TLS', /^tls_count_/), mcol('tlsc', 'Classes in TLS', /^tls_classes_/), mcol('mk', 'Makeshift rooms', /^makeshift_count_/), mcol('mkc', 'Classes in makeshift rooms', /^makeshift_classes_/)] },
  { group: 'Physical Facilities', id: 't4', title: 'Toilets and Water', loader: 't4', table: true, src: 'T4',
    columns: [mcol('ft', 'Functional toilet bowls', /_func_toilet_/), mcol('ftp', 'of which PWD', /_func_toilet_pwd_/), mcol('nf', 'Non-functional toilet bowls', /_nonfunc_toilet_/),
      mcol('ur', 'Urinals and troughs', /_urinal(_trough)?_/), mcol('sk', 'Sinks', /_sink_/), mcol('fw', 'Faucets with water', /_faucet_with_water_/), mcol('fo', 'Faucets without water', /_faucet_without_water_/)] },
  { group: 'Physical Facilities', id: 't5', title: 'Furniture', loader: 't5', table: true, src: 'T5',
    columns: [mcol('seat', 'Total seats', /^total_seat_/), mcol('arm', 'Armchairs', /^num_armchair_/), mcol('desk', 'School desks', /^num_schooldesk_/),
      mcol('one', '1-seater table and chair', /^num_oneseater_/), mcol('tnc', '2-seater table and chair', /^num_newtnc_/), mcol('kc', 'Kinder chairs', /^num_kinder_chair$/), mcol('kt', 'Kinder modular tables', /^num_kinder_modtable$/)] },
  { group: 'Physical Facilities', id: 't6', title: 'Other Facilities', loader: 't6', table: true, src: 'T6',
    note: 'Number of schools with each facility. SY 2025–2026: entries validated in RIVET (CO released no Table 6). Earlier years: CO\'s Table 6.',
    columns: [['covered_court', 'Covered court'], ['gymnasium', 'Gymnasium'], ['solar_panel', 'Solar panel'], ['permanent_fence', 'Permanent fence'],
      ['temporary_fence', 'Temporary fence'], ['flood_marker', 'Flood marker'], ['playground', 'Playground'], ['school_garden', 'School garden'],
      ['entrance_gate', 'Entrance gate'], ['exit_gate', 'Exit gate'], ['bike_racks', 'Bike racks'], ['paved_pathway', 'Paved pathway'], ['pathway_cover', 'Pathway cover']]
      .map(([k, label]) => col(k, label, (r) => (r.m?.[k] === 1 ? 1 : 0))) },

  { group: 'Resource Ratios', id: 'enrol', title: 'Learners by Level', loader: 'enrol', src: 'LIS',
    note: 'Public schools, from LIS. Schools of the divisions now in the Negros Island Region are left out of every year.',
    columns: [mcol('k', 'Kindergarten', /^k_es$/), mcol('e', 'Grades 1–6', /^g1_6_es$/), mcol('j', 'Grades 7–10', /^g7_10_jhs$/),
      mcol('s', 'Grades 11–12', /^g11_12_shs$/), mcol('ng', 'Non-graded (SNEd)', /^ng_/), mcol('t', 'Total learners', /./)] },
  { group: 'Resource Ratios', id: 'cratio', title: 'Classroom Ratio', loader: 'ratio', src: 'CLS',
    note: 'Learners per usable instructional room. SY 2025–2026: LIS learners and the validated rooms; combination and usage-locked rooms are not counted. Earlier years: CO\'s classroom summary.',
    columns: [col('learners', 'Learners'), col('usable_rooms', 'Usable instructional rooms'), col('ratio', 'Learners per room', null, null, true)],
    derive: (r) => ({ ratio: r.usable_rooms && r.learners ? r.learners / r.usable_rooms : null }) },
  { group: 'Resource Ratios', id: 'gap', title: 'Classroom Gap', loader: 'gap',
    note: 'Classrooms needed under the MATATAG class sizes (Kindergarten 30 a session, two sessions a room; Grades 1–3, 35; Grades 4–10, 45; Grades 11–12, 40). Shortage adds up only the schools short of rooms.',
    columns: [col('rooms_needed', 'Classrooms needed'), col('usable_rooms', 'Usable'), col('short', 'Classrooms short'), col('schools_short', 'Schools short')] },
  { group: 'Resource Ratios', id: 'fratio', title: 'Furniture Ratio', loader: 't5', table: true, src: 'SEAT', needs: /^total_seat_/,
    note: 'Learners per seat, from Table 5 (learners and total seats as computed in the NSBI). Seat shortage adds up only the schools with fewer seats than learners.',
    columns: [mcol('learners', 'Learners', /^enrollment_(es|jhs|shs)$/), mcol('seats', 'Total seats', /^total_seat_/), col('ratio', 'Learners per seat', null, null, true), col('seat_short', 'Seat shortage')],
    perSchool: (r, lv) => { const l = sumKeys(r.m, /^enrollment_(es|jhs|shs)$/, lv); const s = sumKeys(r.m, /^total_seat_/, lv); return { seat_short: Math.max(0, l - s) }; },
    derive: (r) => ({ ratio: r.seats && r.learners ? r.learners / r.seats : null }) },

  { group: 'Validation', id: 'progress', title: 'Validation Progress', loader: 'tally',
    columns: [col('schools', 'Schools', () => 1), col('records', 'Buildings and rooms', (r) => Number(r.co_buildings) + Number(r.co_rooms)),
      col('with_status', 'With a status', (r) => Number(r.buildings_with_status) + Number(r.rooms_with_status)), col('pct', 'Validated', null, null, true),
      col('complete', 'Schools complete', (r) => (r.dpo_complete ? 1 : 0)), col('returned', 'Returned to DE', (r) => (r.dpo_result === 'returned' && !r.dpo_complete ? 1 : 0)),
      col('sent_back', 'Sent back to school')],
    derive: (r) => ({ pct: r.records ? `${Math.floor((r.with_status / r.records) * 100)}%` : '0%' }) },
  { group: 'Validation', id: 'nsbivsvalid', title: 'NSBI vs Validated', loader: 'facilities',
    columns: [col('buildings_nsbi', 'Buildings, NSBI'), col('buildings_validated', 'Buildings, validated'), col('rooms_nsbi', 'Rooms, NSBI'), col('rooms_validated', 'Rooms, validated'),
      col('buildings_for_deletion', 'Buildings for deletion'), col('rooms_for_deletion', 'Rooms for deletion'), col('buildings_added', 'Buildings added'), col('rooms_added', 'Rooms added')] },
  { group: 'Validation', id: 'deletions', title: 'Records for Deletion', list: 'report_deletions',
    listCols: [['record', 'Record'], ['code', 'Code'], ['nsbi_condition', 'NSBI condition'], ['reason', 'Reason'], ['remarks', 'Remarks'], ['recorded_by', 'Recorded by'], ['recorded_at', 'Recorded']] },
  { group: 'Validation', id: 'sentback', title: 'Schools Sent Back', list: 'return_status', listFilter: (q) => q.eq('kind', 'de_to_school').neq('state', 'closed'),
    listCols: [['note', 'What to fix'], ['raised_by_name', 'Sent by'], ['raised_at', 'Sent'], ['state', 'State'], ['last_note', 'School answer']] },
];

function signed(v) { return v > 0 ? `+${n(v)}` : n(v); }
function mcol(key, label, re) { return { key, label, re }; }

export default function Reports({ db, me }) {
  const isRegion = REGION_ROLES.includes(me.role);
  const [years, setYears] = useState([]);
  const [sdos, setSdos] = useState([]);
  const [schools, setSchools] = useState(null);
  const [lists, setLists] = useState(null);
  const [avail, setAvail] = useState({});
  const [f, setF] = useState({ year: CYCLE, from: '', sdo: me.sdo_code ?? '', district: '', level: 'all', group: isRegion ? 'sdo' : 'district', zero: false });
  const [pick, setPick] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      db.from('source_loads').select('cycle_id, co_table'),
      db.from('enrollment_loads').select('school_year'),
      db.from('sdos').select('code, name').order('name'),
      fetchAll(() => db.from('school_places').select(PLACE).eq('cycle_id', CYCLE).order('school_id')),
      fetchAll(() => db.from('cycle_schools').select('school_id').neq('cycle_id', CYCLE).order('school_id').order('cycle_id')),
      db.from('building_conditions').select('name, sort').order('sort'),
      db.from('room_conditions').select('name, sort').order('sort'),
    ]).then(async ([y, e, s, cs, past, bc, rc]) => {
      // The school years each source has: CO's tables by cycle, LIS by school year; SEAT, the years
      // whose Table 5 gives total seats; now, the tables with entries validated this cycle.
      const a = { LIS: (e.data ?? []).map((x) => x.school_year), now: {} };
      (y.data ?? []).forEach((x) => { (a[x.co_table] ??= []).push(x.cycle_id); });
      const count = (q) => q.then((r) => { if (r.error) throw r.error; return r.count ?? 0; });
      const seats = await Promise.all((a.T5 ?? []).map((c) => count(db.from('co_school_records').select('id', { count: 'exact', head: true })
        .eq('cycle_id', c).eq('co_table', 'T5').or('measures->total_seat_es.not.is.null,measures->total_seat_ss.not.is.null,measures->total_seat_jhs.not.is.null'))));
      a.SEAT = (a.T5 ?? []).filter((_, i) => seats[i] > 0);
      const now = await Promise.all(['T3', 'T4', 'T5', 'T6'].map((t) => count(db.from('school_table_status').select('school_id', { count: 'exact', head: true })
        .eq('cycle_id', CYCLE).eq('co_table', t).not('validated', 'is', null))));
      ['T3', 'T4', 'T5', 'T6'].forEach((t, i) => { a.now[t] = now[i] > 0; });
      setAvail(a);
      const ids = [...new Set([CYCLE, ...a.LIS, ...REPORTS.filter((r) => r.src && r.src !== 'LIS').flatMap((r) => a[r.src] ?? [])])].sort().reverse();
      setYears(ids.map((id) => ({ cycle_id: id, label: yearText(id) })));
      setSdos(s.data ?? []);
      // Schools no longer listed this year take their place from the latest year they were listed,
      // so their earlier-year figures still group by place.
      const places = Object.fromEntries(cs.map((x) => [x.school_id, x]));
      const gone = [...new Set(past.map((x) => x.school_id).filter((id) => !places[id]))];
      for (let i = 0; i < gone.length; i += 100) {
        const r = await db.from('school_places').select(PLACE).in('school_id', gone.slice(i, i + 100)).order('cycle_id', { ascending: false });
        if (r.error) throw r.error;
        r.data.forEach((x) => { places[x.school_id] ??= x; });
      }
      // Earlier lists may leave the province out; take it from the division's schools this year.
      const prov = {};
      cs.forEach((x) => { if (x.province) prov[x.sdo_code] ??= x.province; });
      gone.forEach((id) => { const x = places[id]; if (x && !x.province) places[id] = { ...x, province: prov[x.sdo_code] ?? null }; });
      setSchools(places);
      setLists({ bcond: (bc.data ?? []).map((c) => c.name), rcond: (rc.data ?? []).map((c) => c.name) });
    }, setError);
  }, [db]);

  // The years the picked report has, latest first (all years before a report is picked).
  const yearsOf = (r) => (r ? yearsFor(r, avail) : years.map((y) => y.cycle_id));
  const shown = yearsOf(pick);
  const choose = (r) => {
    const ys = yearsOf(r);
    setPick(r);
    if (!ys.includes(f.year)) setF({ ...f, year: ys[0] ?? CYCLE, from: '' });
    else if (f.from && !ys.includes(f.from)) setF({ ...f, from: '' });
  };
  // Multi-year: "3 (2023–2026)" covers the chosen year and the two before it that the report has.
  const asc = shown.filter((y) => y <= f.year).sort();
  const spans = asc.slice(0, -1).map((from, i) => ({ from, count: asc.length - i })).reverse();

  const districts = useMemo(() => [...new Set(Object.values(schools ?? {}).filter((s) => !f.sdo || s.sdo_code === f.sdo).map((s) => s.district).filter(Boolean))].sort(), [schools, f.sdo]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, ...(k === 'sdo' ? { district: '' } : {}), ...(k === 'year' && f.from >= e.target.value ? { from: '' } : {}) });

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!schools || !lists) return <main className="page"><Loading /></main>;

  const groups = [...new Set(REPORTS.map((r) => r.group))];
  return (
    <main className="page reports">
      <h1>Summary Reports</h1>
      <section className="card noprint">
        <h2>Filter</h2>
        <div className="filters">
          <label className="f">School year
            <select value={f.year} onChange={set('year')}>
              {shown.map((y) => <option key={y} value={y}>{yearText(y)}</option>)}
            </select>
          </label>
          <label className="f">Multi-year
            <select value={f.from} onChange={set('from')} disabled={!spans.length}>
              <option value="">Single year</option>
              {spans.map((x) => <option key={x.from} value={x.from}>{x.count} ({spanText(x.from, f.year)})</option>)}
            </select>
          </label>
          <label className="f">Level
            <select value={f.level} onChange={set('level')}>
              {Object.entries(LEVELS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="f">Group by
            <select value={f.group} onChange={set('group')}>
              {Object.entries(GROUPS).filter(([k]) => isRegion || k !== 'sdo').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          {isRegion && (
            <label className="f">SDO
              <select value={f.sdo} onChange={set('sdo')}>
                <option value="">All SDOs</option>
                {sdos.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
          )}
          <label className="f">District
            <select value={f.district} onChange={set('district')}>
              <option value="">All districts</option>
              {districts.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="check small"><input type="checkbox" checked={f.zero} onChange={set('zero')} /> Exclude zero data</label>
        </div>
      </section>

      <div className="report-list noprint">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <ul>
              {REPORTS.filter((r) => r.group === g).map((r) => (
                <li key={r.id}><button type="button" className={`linkish${pick?.id === r.id ? ' on' : ''}`} onClick={() => choose(r)}>{r.title}</button></li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {pick && <Report key={pick.id} db={db} report={pick} f={{ ...f, range: shown.filter((y) => f.from && y >= f.from && y <= f.year).sort() }} schools={schools} sdos={sdos} lists={lists} />}
    </main>
  );
}

function Report({ db, report, f, schools, sdos, lists }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const level = LEVELS[f.level][1];
  const ref = React.useRef(null);

  // Which years this report shows: the chosen year, or each year of the range; years without data
  // for it are left out. Instructional and Non-Instructional Rooms read CO's classroom summary for
  // an earlier year. A report without earlier years is SY 2025-2026 only.
  const multi = !!report.src && f.range.length > 1;
  const years = (multi ? f.range : [report.src ? f.year : CYCLE]).map((y) => (report.prior && y < CYCLE ? `cls:${y}` : y));

  useEffect(() => {
    let live = true; // a filter changed while the last one was loading: drop the older answer
    setData(null); setError(null);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (async () => {
      if (report.list) {
        // A stable order, so the pages of a long list neither repeat nor skip lines.
        let q = () => scoped(db.from(report.list).select('*').eq('cycle_id', CYCLE), f, report.list !== 'return_status').order(report.list === 'return_status' ? 'id' : 'recorded_at').order('school_id').order(report.list === 'return_status' ? 'id' : 'code');
        if (report.listFilter) { const base = q; q = () => report.listFilter(base()); }
        const list = await fetchAll(q);
        if (live) setData({ list, source: 'RIVET validation record, SY 2025–2026' });
        return;
      }
      const loader = report.loader === 'rcond' ? load.byCondition('room')
        : report.table ? load.table(report.loader.toUpperCase()) : load[report.loader];
      const parts = await Promise.all(years.map(async (y) => {
        if (y.startsWith('cls:')) {
          // Instructional rooms in a past year: CO's classroom summary.
          const year = y.slice(4);
          const rows = await fetchAll(() => scoped(db.from('co_school_records').select('school_id, sdo_code, measures').eq('cycle_id', year).eq('co_table', 'CLS').order('school_id'), f, false));
          return { year, prior: true, rows: rows.map((r) => ({ school_id: r.school_id, sdo_code: r.sdo_code, prior: Math.round(sumKeys(r.measures, report.prior, level)) })), source: `${yearText(year)}: CO's number of classrooms` };
        }
        const x = await loader(db, { ...f, year: y });
        return { year: y, ...x };
      }));
      // Leave out the years with nothing for this report (a table CO did not release that year).
      const needs = report.needs ?? (report.columns?.some((c) => c.re) ? new RegExp(report.columns.filter((c) => c.re).map((c) => c.re.source).join('|')) : null);
      const has = (p) => p.rows.length > 0 && (!needs || p.rows.some((r) => Object.keys(r.m ?? {}).some((k) => needs.test(k))));
      const kept = parts.filter(has);
      if (live) setData({ parts: kept, missing: parts.filter((p) => !has(p)).map((p) => p.year) });
    })().catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [db, report, f.year, f.range.join(), f.sdo, f.district, f.level]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = useMemo(() => (data?.parts?.length ? build(report, data.parts, f, level, schools, sdos, lists) : null), [data, report, f, level, schools, sdos, lists]);

  async function excel() {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const head = (v) => ({ value: v, fontWeight: 'bold' });
    let sheet;
    if (data.list) {
      const cols = [['sdo_code', 'SDO'], ['district', 'District'], ['school_id', 'School ID'], ['school_name', 'School'], ...report.listCols];
      sheet = [cols.map(([, l]) => head(l)), ...data.list.map((r) => cols.map(([k]) => cell(k === 'district' || k === 'school_name' ? r[k] ?? schools[r.school_id]?.[k] : r[k])))];
    } else {
      sheet = [out.header.map(head), ...out.rows.map((r) => r.cells.map(cell)), out.total.cells.map((v, i) => (i === 0 ? head(v) : cell(v)))];
    }
    const title = [[head(`${report.title} · ${filterText(f, sdos)}`)], [{ value: data.list ? data.source : out.source }], []];
    await writeXlsxFile([...title, ...sheet], { columns: (sheet[0] || []).map((_, i) => ({ width: i < 4 ? 22 : 16 })) })
      .toFile(`RIVET ${report.title} ${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <section className="card report" ref={ref}>
      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>{report.title}</h2>
          <div className="small muted">{filterText(f, sdos)}</div>
        </div>
        {(out || data?.list) && (
          <div className="btns noprint" style={{ margin: 0 }}>
            <button type="button" className="btn sm secondary" onClick={() => window.print()}>Print</button>
            <button type="button" className="btn sm" onClick={excel}>Download Excel</button>
          </div>
        )}
      </div>
      {report.note && <p className="small muted" style={{ margin: 0 }}>{report.note}</p>}
      {multi && years.includes(CYCLE) && <p className="small muted" style={{ margin: 0 }}>SY 2025–2026: the validated record so far, while the SDO validation is under way.</p>}
      {data?.missing?.length > 0 && (
        <div className="notice info"><span>No data for {data.missing.map((y) => yearText(y.replace('cls:', ''))).join(', ')}{report.needs ? ' (CO gave no total seats that year)' : ''}{data.parts.length ? ', so not shown.' : '.'}</span></div>
      )}
      {error && <ErrorNote error={error} />}
      {!data && !error && <Loading />}
      {data?.list && <ListTable rows={data.list} cols={report.listCols} schools={schools} source={data.source} />}
      {out && <SumTable out={out} />}
    </section>
  );
}

const cell = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? { value: v, type: Number } : { value: String(v) });

function filterText(f, sdos) {
  const sdo = f.sdo ? sdos.find((s) => s.code === f.sdo)?.name ?? f.sdo : 'Region VII';
  return [sdo, f.district || null, f.range?.length > 1 ? `${yearText(f.range[0])} to ${yearText(f.range[f.range.length - 1])}` : yearText(f.year),
    f.level !== 'all' ? LEVELS[f.level][0] : null, `by ${GROUPS[f.group].toLowerCase()}`].filter(Boolean).join(' · ');
}

// Adds the per-school lines up by the chosen grouping. Returns header, rows of cells and a total.
function build(report, parts, f, level, schools, sdos, lists) {
  const sdoName = Object.fromEntries(sdos.map((s) => [s.code, s.name]));
  const multi = parts.length > 1;
  // A year's columns: CO's own counts for a past year of Buildings by Condition, else the report's.
  // Beside earlier years, SY 2025-2026 stands for its validated record (no NSBI total).
  const columnsOf = (p) => {
    if (!report.conditions) return report.columns;
    const names = lists[report.conditions].map((c) => col(`v:${c}`, c));
    if (p.co) return [...names.filter((c) => p.rows.some((r) => c.key in r)), col('total_nsbi', 'Total')];
    return multi ? [...names, col('v:Blank', 'Blank'), col('total_validated', 'Total')]
      : [...names, col('v:Blank', 'Blank'), col('total_validated', 'Total, validated'), col('total_nsbi', 'Total, NSBI')];
  };
  const cols = parts.map(columnsOf);
  const columns = cols[cols.length - 1];
  const sdoOf = (s) => sdoName[s.sdo_code] ?? s.sdo_code;
  const none = '(not given)';
  const idCols = { region: ['Region'], sdo: ['Division'], district: ['Division', 'District'], province: ['Province'],
    municipality: ['Province', 'Municipality'], legislative: ['Province', 'Legislative District'], school: ['Division', 'District', 'School ID', 'School'] }[f.group];
  const idOf = (s) => ({ region: ['Region VII'], sdo: [sdoOf(s)], district: [sdoOf(s), s.district ?? ''], province: [s.province || none],
    municipality: [s.province || none, s.municipality || none], legislative: [s.province || none, s.legislative_district || none],
    school: [sdoOf(s), s.district ?? '', s.school_id, s.school_name] })[f.group];
  const keyOf = (s) => (f.group === 'school' ? s.school_id : idOf(s).join('|'));

  // The value a column takes for one school line.
  const valueOf = (c, r) => (c.re ? sumKeys(r.m, c.re, level) : c.get(r));
  const sumCols = (cs) => cs.filter((c) => !c.computed && !(c.fmt && c.key === 'ratio') && c.key !== 'ratio' && c.key !== 'pct');

  const groups = new Map();
  parts.forEach((p, pi) => {
    p.rows.forEach((r) => {
      const s = schools[r.school_id] ?? { school_id: r.school_id, sdo_code: r.sdo_code, district: '', school_name: r.school_name ?? `${r.school_id} (not in NSBI 2025–2026)` };
      if ((f.sdo && s.sdo_code !== f.sdo) || (f.district && s.district !== f.district)) return;
      const k = keyOf(s);
      const g = groups.get(k) ?? { id: idOf(s), sums: parts.map(() => ({})) };
      groups.set(k, g);
      const sums = g.sums[pi];
      const extra = report.perSchool ? report.perSchool(r, level) : {};
      const line = { ...r, ...extra };
      if (p.prior) { sums.prior = (sums.prior ?? 0) + r.prior; return; }
      sumCols(cols[pi]).forEach((c) => { sums[c.key] = (sums[c.key] ?? 0) + Number(valueOf(c, line) || 0); });
    });
  });

  const fmtOf = (c, v) => {
    if (c.key === 'ratio') return v === null || v === undefined ? '—' : ratio(v);
    if (c.key === 'pct') return v;
    return c.fmt ? c.fmt(v) : v;
  };
  const yearLabel = (y) => y.replace('SY', 'SY ').replace('-', '–');
  const priors = parts.filter((p) => p.prior).length;

  // Rooms by year: one column a year; SY 2025-2026 alone keeps its NSBI and validated columns.
  const current = parts.length > priors;
  const curCols = report.validated ? columns.filter((c) => c.key === report.validated) : columns;
  let header;
  if (priors) header = [...idCols, ...parts.slice(0, priors).map((p) => yearLabel(p.year)), ...(current ? [yearLabel(CYCLE)] : [])];
  else if (multi) header = [...idCols, ...parts.flatMap((p, pi) => cols[pi].map((c) => `${c.label}, ${yearLabel(p.year)}`))];
  else header = [...idCols, ...columns.map((c) => c.label)];

  const cellsOf = (sums) => {
    const derived = sums.map((s) => ({ ...s, ...(report.derive ? report.derive(s) : {}) }));
    if (priors) return [...sums.slice(0, priors).map((x) => x.prior ?? 0), ...(current ? curCols.map((c) => fmtOf(c, derived[priors][c.key] ?? 0)) : [])];
    return derived.flatMap((d, pi) => cols[pi].map((c) => fmtOf(c, d[c.key] ?? (c.key === 'ratio' ? null : 0))));
  };
  const isZero = (sums) => sums.every((s) => Object.values(s).every((v) => !v));

  let rows = [...groups.values()];
  if (f.zero) rows = rows.filter((g) => !isZero(g.sums));
  rows.sort((a, b) => a.id.join('|').localeCompare(b.id.join('|')));
  const totalSums = parts.map((_, pi) => rows.reduce((t, g) => {
    Object.entries(g.sums[pi]).forEach(([k, v]) => { t[k] = (t[k] ?? 0) + v; });
    return t;
  }, {}));
  return {
    header,
    idCount: idCols.length,
    rows: rows.map((g) => ({ key: g.id.join('|'), cells: [...g.id, ...cellsOf(g.sums)] })),
    total: { cells: ['Total', ...Array(idCols.length - 1).fill(''), ...cellsOf(totalSums)] },
    source: parts.map((p) => p.source).join(' · '),
  };
}

function SumTable({ out }) {
  const shown = out.rows.slice(0, 500);
  const show = (v) => (typeof v === 'number' ? n(v) : v);
  return (
    <>
      <div className="scroll">
        <table className="report-table">
          <thead><tr>{out.header.map((h, i) => <th key={h} className={i >= out.idCount ? 'num' : ''}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((r) => <tr key={r.key}>{r.cells.map((v, i) => <td key={i} className={i >= out.idCount ? 'num' : ''}>{show(v)}</td>)}</tr>)}
          </tbody>
          <tfoot><tr>{out.total.cells.map((v, i) => <td key={i} className={i >= out.idCount ? 'num' : ''}>{show(v)}</td>)}</tr></tfoot>
        </table>
      </div>
      {out.rows.length > 500 && <p className="small muted noprint">Showing 500 of {n(out.rows.length)} lines; the Excel file has all of them.</p>}
      {out.rows.length === 0 && <p className="muted">No data for these filters.</p>}
      <p className="small muted" style={{ margin: 0 }}>Source: {out.source}. Generated by RIVET on {new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}.</p>
    </>
  );
}

function ListTable({ rows, cols, schools, source }) {
  const fmt = (k, v) => (k.endsWith('_at') && v ? new Date(v).toLocaleDateString('en-PH') : v);
  return (
    <>
      <div className="scroll">
        <table className="report-table">
          <thead><tr><th>SDO</th><th>School</th>{cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 500).map((r, i) => (
              <tr key={i}>
                <td>{r.sdo_code}</td>
                <td>{r.school_name ?? schools[r.school_id]?.school_name}<div className="mono muted">{r.school_id}</div></td>
                {cols.map(([k]) => <td key={k}>{fmt(k, r[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">None so far.</p>}
      <p className="small muted" style={{ margin: 0 }}>Source: {source}. {n(rows.length)} line(s).</p>
    </>
  );
}
