import React, { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Loading } from '../components/ui.jsx';
import { n, pct, ratio, REGION_ROLES } from '../lib/labels.js';
import { fetchAll } from '../lib/fetchAll.js';

// Dashboard: the NSBI as reported beside the validated record, for the viewer's own scope
// (Region VII for the RO, one SDO for a DE or DPO). A school year with school-level tables only
// (SY 2024-2025) shows CO's classroom summary and Tables 3 to 5.
export default function Dashboard({ db, me }) {
  const [years, setYears] = useState(null);
  const [sdos, setSdos] = useState([]);
  const [year, setYear] = useState(null);
  const [sdo, setSdo] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const isRegion = REGION_ROLES.includes(me.role);

  useEffect(() => {
    Promise.all([db.from('dash_years').select('*').order('cycle_id', { ascending: false }), db.from('sdos').select('code, name').order('name')])
      .then(([y, s]) => {
        if (y.error) { setError(y.error); return; }
        setYears(y.data);
        setSdos(s.data ?? []);
        setYear((y.data.find((r) => r.role === 'current') ?? y.data[0])?.cycle_id ?? null);
      });
  }, [db]);

  useEffect(() => {
    if (!year) return undefined;
    let live = true; // the year changed while the last one was loading: drop the older answer
    setData(null);
    const scoped = (q) => (sdo ? q.eq('sdo_code', sdo) : q);
    Promise.all([
      fetchAll(() => scoped(db.from('dash_conditions').select('*').eq('cycle_id', year).order('sdo_code').order('kind').order('condition'))),
      fetchAll(() => scoped(db.from('dash_room_usage').select('*').eq('cycle_id', year).order('sdo_code').order('usage'))),
      fetchAll(() => scoped(db.from('dash_school_totals').select('*').eq('cycle_id', year).order('sdo_code').order('co_table').order('measure'))),
      scoped(db.from('sdo_progress').select('*').eq('cycle_id', year)),
      fetchAll(() => scoped(db.from('classroom_gap').select('*').eq('cycle_id', year).order('school_id'))),
    ]).then(([c, u, s, p, g]) => {
      if (!live) return;
      if (p.error) { setError(p.error); return; }
      setData({ cond: c, usage: u, totals: s, progress: p.data, gap: g });
    }).catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [db, year, sdo]);

  const y = years?.find((r) => r.cycle_id === year);
  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!years) return <main className="page"><Loading /></main>;

  return (
    <main className="page">
      <div className="spread">
        <h1>Dashboard</h1>
        <div className="filters">
          <label className="f inline">School year
            <select value={year ?? ''} onChange={(e) => setYear(e.target.value)}>
              {years.map((r) => <option key={r.cycle_id} value={r.cycle_id}>{r.label}</option>)}
            </select>
          </label>
          {isRegion && (
            <label className="f inline">SDO
              <select value={sdo} onChange={(e) => setSdo(e.target.value)}>
                <option value="">All of Region VII</option>
                {sdos.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      {years.length < 2 && <p className="small muted">Earlier school years appear here once their NSBI tables are loaded.</p>}
      {!data ? <Loading /> : y?.has_buildings ? <ValidationView db={db} data={data} label={y.label} year={year} sdo={sdo} isRegion={isRegion} sdos={sdos} /> : <SchoolTablesView data={data} label={y?.label} />}
    </main>
  );
}

const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);

function ValidationView({ db, data, label, year, sdo, isRegion, sdos }) {
  const [drill, setDrill] = useState(null);
  const open = (kind, title) => (line) => setDrill({ kind, label: line, title: `${title}: ${line}` });
  const { cond, usage, progress } = data;
  const b = cond.filter((r) => r.kind === 'building');
  const r = cond.filter((x) => x.kind === 'room');
  const iu = usage.filter((x) => x.usage === 'Instructional');
  const instr = { nsbi: sum(iu, 'nsbi'), validated: sum(iu, 'validated') };
  const p = progress.reduce((a, x) => ({
    schools: a.schools + Number(x.schools), done: a.done + Number(x.schools_complete),
    records: a.records + Number(x.co_buildings) + Number(x.co_rooms),
    withStatus: a.withStatus + Number(x.buildings_with_status) + Number(x.rooms_with_status),
  }), { schools: 0, done: 0, records: 0, withStatus: 0 });

  return (
    <>
      <p className="small muted">NSBI {label} (as of 31 May 2026), beside the validated record. A building or room without a status yet keeps its NSBI value.</p>
      <div className="grid tiles">
        <Tile big={n(p.schools)} text={`schools · ${n(p.done)} complete`} />
        <Tile big={pct(p.records ? p.withStatus / p.records : 0)} text="of buildings and rooms validated" />
        <Tile big={`${n(sum(b, 'nsbi'))} → ${n(sum(b, 'validated'))}`} text="buildings, NSBI → validated" />
        <Tile big={`${n(sum(r, 'nsbi'))} → ${n(sum(r, 'validated'))}`} text="rooms, NSBI → validated" />
        <Tile big={`${n(instr.nsbi)} → ${n(instr.validated)}`} text="instructional rooms, NSBI → validated" />
      </div>
      <div className="row">
        <Pairs title="Buildings by condition" rows={b} labelKey="condition" order={BUILDING_ORDER} onPick={open('building', 'Buildings')} />
        <Pairs title="Rooms by condition" rows={r} labelKey="condition" order={ROOM_ORDER} onPick={open('room', 'Rooms')} />
      </div>
      {drill && drill.kind !== 'usage' && <Drill db={db} year={year} sdo={sdo} drill={drill} onClose={() => setDrill(null)} />}
      <Pairs wide title="Rooms by usage" rows={usage} labelKey="usage" order={USAGE_ORDER} onPick={open('usage', 'Rooms by usage')}
        note="Usage locked: rooms that are condemned or under construction, or in such a building. They are counted on their own, neither instructional nor non-instructional." />
      {drill && drill.kind === 'usage' && <Drill db={db} year={year} sdo={sdo} drill={drill} onClose={() => setDrill(null)} />}
      <Gap rows={data.gap} isRegion={isRegion && !sdo} sdos={sdos} />
    </>
  );
}

const BUILDING_ORDER = ['Good Condition', 'Needs Minor Repair', 'Needs Major Repair', 'For Completion', 'On-going Construction',
  'For Condemnation', 'Condemned / For Demolition', 'Demolished', 'Blank'];
const ROOM_ORDER = ['Good Condition', 'Needs Minor Repair', 'Needs Major Repair', 'On-going Construction',
  'For Condemnation/For Demolition', 'Condemned / For Demolition', 'Condemned', 'Blank'];
const USAGE_ORDER = ['Instructional', 'Non-Instructional', 'Combination', 'Usage locked', 'Blank'];

function Tile({ big, text }) {
  return <div className="tile"><strong>{big}</strong><span>{text}</span></div>;
}

// Two bars per line: the NSBI as reported, and after validation. Every value is written out.
function Pairs({ title, rows, labelKey, order, note, wide, onPick }) {
  const lines = useMemo(() => {
    const m = new Map();
    rows.forEach((x) => {
      const k = x[labelKey];
      const cur = m.get(k) ?? { label: k, nsbi: 0, validated: 0 };
      cur.nsbi += Number(x.nsbi); cur.validated += Number(x.validated);
      m.set(k, cur);
    });
    const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length - 1 : i; };
    return [...m.values()].filter((l) => l.nsbi || l.validated).sort((a, c) => rank(a.label) - rank(c.label));
  }, [rows, labelKey, order]);
  const max = Math.max(1, ...lines.flatMap((l) => [l.nsbi, l.validated]));
  return (
    <section className={`card chart${wide ? '' : ' grow'}`}>
      <div className="spread"><h2>{title}</h2><Legend /></div>
      {onPick && <p className="small muted">Click a line to see the schools behind it.</p>}
      {lines.length === 0 ? <p className="muted">No records.</p> : (
        <div className="pairs" role="table" aria-label={title}>
          {lines.map((l) => (
            <div className={`pair${onPick ? ' pick' : ''}`} role="row" key={l.label} tabIndex={onPick ? 0 : undefined}
              onClick={onPick ? () => onPick(l.label) : undefined}
              onKeyDown={onPick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(l.label); } } : undefined}>
              <span className="pair-label" role="rowheader">{onPick ? <u>{l.label}</u> : l.label}</span>
              <div className="pair-bars" role="cell">
                <BarLine value={l.nsbi} max={max} cls="s1" what={`${l.label}, NSBI`} />
                <BarLine value={l.validated} max={max} cls="s2" what={`${l.label}, validated`} />
              </div>
            </div>
          ))}
        </div>
      )}
      {note && <p className="small muted">{note}</p>}
    </section>
  );
}

function BarLine({ value, max, cls, what }) {
  return (
    <div className="barline" title={`${what}: ${n(value)}`}>
      <i className={cls} style={{ width: `${(value / max) * 100}%` }} />
      <span>{n(value)}</span>
    </div>
  );
}

function Legend({ a = 'NSBI', b = 'Validated' }) {
  return (
    <div className="legend small">
      <span><i className="s1" />{a}</span>
      {b && <span><i className="s2" />{b}</span>}
    </div>
  );
}

// SY 2024-2025 and other years with school-level tables only.
function SchoolTablesView({ data, label }) {
  const t = {};
  // Tables 4 and 5 repeat the enrollment columns: read each figure from its own table only, and
  // learners from the classroom summary, or from the first other table that has them (CO's
  // SY 2023-2024 classroom summary has none).
  const FROM = { T3: /^(tls|makeshift)_/, T5: /^total_seat_/, CLS: /^(enrollment|instructional_rooms|noninstructional_rooms)_/ };
  data.totals.forEach((x) => { if (FROM[x.co_table]?.test(x.measure)) t[x.measure] = (t[x.measure] ?? 0) + Number(x.total); });
  const learnersFrom = ['CLS', 'T3', 'T4', 'T5', 'BLD'].find((tb) => data.totals.some((x) => x.co_table === tb && x.measure.startsWith('enrollment_')));
  if (learnersFrom && learnersFrom !== 'CLS') {
    data.totals.forEach((x) => { if (x.co_table === learnersFrom && x.measure.startsWith('enrollment_')) t[x.measure] = (t[x.measure] ?? 0) + Number(x.total); });
  }
  const w = (x) => n(Math.round(x));
  const has = data.totals.length > 0;
  if (!has) return <div className="notice info">The NSBI {label} school-level tables are not loaded yet.</div>;
  const lv = (base) => ['es', 'jhs', 'shs'].reduce((a, k) => a + (t[`${base}_${k}`] ?? 0), 0);
  const enrol = t.enrollment_k12 ?? lv('enrollment');
  const got = (tb) => data.totals.some((x) => x.co_table === tb); // '—' for a table CO did not release that year
  const rooms = lv('instructional_rooms');
  const levels = [['Elementary', 'es'], ['Junior High', 'jhs'], ['Senior High', 'shs']];
  return (
    <>
      <p className="small muted">As reported in the NSBI {label}: CO's classroom summary and Tables 3 to 5. Not validated in RIVET.</p>
      <div className="grid tiles">
        <Tile big={n(enrol)} text="learners enrolled" />
        <Tile big={w(rooms)} text="instructional rooms" />
        <Tile big={rooms && enrol ? ratio(enrol / rooms) : '—'} text="learners per instructional room" />
        <Tile big={got('T3') ? n((t.tls_count_es ?? 0) + (t.tls_count_ss ?? 0)) : '—'} text="temporary learning spaces" />
        <Tile big={got('T3') ? n((t.makeshift_count_es ?? 0) + (t.makeshift_count_ss ?? 0)) : '—'} text="makeshift rooms" />
        <Tile big={Object.keys(t).some((k) => k.startsWith('total_seat_')) ? n(lv('total_seat') + (t.total_seat_ss ?? 0)) : '—'} text="seats (Table 5)" />
      </div>
      <section className="card chart">
        <div className="spread"><h2>Instructional rooms and learners per room, by level</h2></div>
        <div className="scroll">
          <table className="cards">
            <thead><tr><th>Level</th><th className="num">Learners</th><th className="num">Instructional rooms</th><th className="num">Non-instructional rooms</th><th className="num">Learners per instructional room</th></tr></thead>
            <tbody>
              {levels.map(([name, k]) => {
                const e = t[`enrollment_${k}`] ?? 0; const ir = t[`instructional_rooms_${k}`] ?? 0;
                return (
                  <tr key={k}>
                    <td>{name}</td>
                    <td className="num" data-label="Learners">{n(e)}</td>
                    <td className="num" data-label="Instructional rooms">{w(ir)}</td>
                    <td className="num" data-label="Non-instructional rooms">{w(t[`noninstructional_rooms_${k}`] ?? 0)}</td>
                    <td className="num" data-label="Learners per room">{ir && e ? ratio(e / ir) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">CO counts a room shared by two levels as part of each, so room counts are rounded to whole rooms.</p>
      </section>
    </>
  );
}

// The schools behind one line of a chart.
function Drill({ db, year, sdo, drill, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [all, setAll] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    setRows(null);
    fetchAll(() => {
      let q = db.from('dash_by_school').select('*').eq('cycle_id', year).eq('kind', drill.kind).eq('label', drill.label);
      if (sdo) q = q.eq('sdo_code', sdo);
      return q.order('validated', { ascending: false }).order('nsbi', { ascending: false }).order('school_id');
    }).then(setRows).catch(setErr);
  }, [db, year, sdo, drill]);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [drill]);
  const what = drill.kind === 'building' ? 'Buildings' : 'Rooms';
  return (
    <section className="card" ref={ref}>
      <div className="spread">
        <h2>{drill.title}</h2>
        <button type="button" className="btn sm secondary" onClick={onClose}>Close</button>
      </div>
      {err && <ErrorNote error={err} />}
      {!rows ? <Loading /> : (
        <>
          <p className="small muted">{n(rows.length)} schools. {what} in the NSBI and after validation; open a school to see its records.</p>
          <div className="scroll">
            <table className="cards">
              <thead><tr><th>School</th><th>SDO · District</th><th className="num">{what}, NSBI</th><th className="num">Validated</th></tr></thead>
              <tbody>
                {(all ? rows : rows.slice(0, 50)).map((x) => (
                  <tr key={x.school_id}>
                    <td><a href={`#/school/${x.school_id}`}>{x.school_name}</a><div className="mono muted">{x.school_id}</div></td>
                    <td data-label="SDO · District">{x.sdo_code} · {x.district}</td>
                    <td className="num" data-label="NSBI">{n(x.nsbi)}</td>
                    <td className="num" data-label="Validated">{n(x.validated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <div className="btns"><button type="button" className="btn sm secondary" onClick={() => setAll(!all)}>{all ? 'Show the first 50' : `Show all ${n(rows.length)} schools`}</button></div>}
        </>
      )}
    </section>
  );
}

const SORTS = {
  gap: ['Largest shortage', (a, b) => (b.gap ?? -1e9) - (a.gap ?? -1e9)],
  ratio: ['Most learners per room', (a, b) => (b.learners_per_room ?? -1) - (a.learners_per_room ?? -1)],
  unsafe: ['Most locked or major-repair rooms', (a, b) => (b.locked_rooms + b.usable_major_repair) - (a.locked_rooms + a.usable_major_repair)],
};

// Classroom gap and priority schools: MATATAG class sizes against usable instructional rooms.
function Gap({ rows, isRegion, sdos }) {
  const [sort, setSort] = useState('gap');
  const [district, setDistrict] = useState('');
  const [onlyShort, setOnlyShort] = useState(false);
  const [all, setAll] = useState(false);
  const ref = React.useRef(null);
  const withE = rows.filter((x) => x.has_enrollment);
  const short = withE.filter((x) => x.gap > 0);
  const t = { needed: sum(withE, 'rooms_needed'), usable: sum(withE, 'usable_rooms'), shortage: sum(short, 'gap') };
  const source = withE[0] ? `${withE[0].enrollment_source} (${withE[0].enrollment_year.replace('SY', 'SY ')})` : null;
  const districts = [...new Set(rows.map((x) => x.district).filter(Boolean))].sort();
  const list = rows.filter((x) => (!district || x.district === district) && (!onlyShort || x.gap > 0)).sort(SORTS[sort][1]);
  const shown = all ? list : list.slice(0, 30);
  const bySdo = isRegion ? sdos.map((s) => {
    const r = withE.filter((x) => x.sdo_code === s.code);
    return { ...s, needed: sum(r, 'rooms_needed'), usable: sum(r, 'usable_rooms'), shortage: sum(r.filter((x) => x.gap > 0), 'gap'), schools: r.filter((x) => x.gap > 0).length };
  }).filter((s) => s.needed) : [];
  const showShort = () => { setOnlyShort(true); setSort('gap'); ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return (
    <>
      <h2 className="section-h">Classroom gap</h2>
      {!source ? <div className="notice info">The classroom gap needs enrollment by grade. It appears once LIS enrollment is loaded.</div> : (
        <>
          <p className="small muted">
            Classrooms needed under the MATATAG class sizes (Kindergarten 30 a session, two sessions a room; Grades 1–3, 35; Grades 4–6 and 7–10, 45; Grades 11–12, 40),
            from {source}, against usable instructional rooms in the validated record: Instructional, not for deletion, and not condemned or under construction.
            Combination rooms are not counted. Shortage adds up only the schools short of rooms; a surplus in one school does not cover another.
          </p>
          <div className="grid tiles">
            <Tile big={n(t.needed)} text="classrooms needed" />
            <Tile big={n(t.usable)} text="usable instructional rooms" />
            <Tile big={n(t.shortage)} text="classrooms short" />
            <button type="button" className="tile" onClick={showShort}><strong>{n(short.length)}</strong><span>schools short of classrooms</span></button>
          </div>
          {bySdo.length > 0 && (
            <section className="card">
              <h2>By SDO</h2>
              <div className="scroll">
                <table className="cards">
                  <thead><tr><th>SDO</th><th className="num">Needed</th><th className="num">Usable</th><th className="num">Short</th><th className="num">Schools short</th></tr></thead>
                  <tbody>
                    {bySdo.sort((a, b) => b.shortage - a.shortage).map((s) => (
                      <tr key={s.code}>
                        <td>{s.name}</td>
                        <td className="num" data-label="Needed">{n(s.needed)}</td>
                        <td className="num" data-label="Usable">{n(s.usable)}</td>
                        <td className="num" data-label="Short">{n(s.shortage)}</td>
                        <td className="num" data-label="Schools short">{n(s.schools)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="card" ref={ref}>
            <div className="spread">
              <h2>Priority schools</h2>
              <div className="filters">
                <label className="f inline">Order by
                  <select value={sort} onChange={(e) => setSort(e.target.value)}>
                    {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
                <label className="f inline">District
                  <select value={district} onChange={(e) => setDistrict(e.target.value)}>
                    <option value="">All districts</option>
                    {districts.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <label className="small check"><input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} /> Only schools short of classrooms</label>
            <div className="scroll">
              <table className="cards">
                <thead><tr>
                  <th>School</th><th className="num">Learners</th><th className="num">Needed</th><th className="num">Usable</th>
                  <th className="num">Short</th><th className="num">Learners per room</th><th className="num">Major repair</th><th className="num">Locked</th><th className="num">Validated</th>
                </tr></thead>
                <tbody>
                  {shown.map((x) => (
                    <tr key={x.school_id}>
                      <td><a href={`#/school/${x.school_id}`}>{x.school_name}</a><div className="small muted">{x.sdo_code} · {x.district}</div></td>
                      <td className="num" data-label="Learners">{x.has_enrollment ? n(x.learners) : 'No enrollment record'}</td>
                      <td className="num" data-label="Needed">{x.has_enrollment ? n(x.rooms_needed) : '—'}</td>
                      <td className="num" data-label="Usable">{n(x.usable_rooms)}</td>
                      <td className="num" data-label="Short">{x.gap > 0 ? <b>{n(x.gap)}</b> : x.has_enrollment ? 0 : '—'}</td>
                      <td className="num" data-label="Learners per room">{x.learners_per_room == null ? '—' : ratio(x.learners_per_room)}</td>
                      <td className="num" data-label="Major repair">{n(x.usable_major_repair)}</td>
                      <td className="num" data-label="Locked">{n(x.locked_rooms)}</td>
                      <td className="num" data-label="Validated">{pct(x.rooms_listed ? x.rooms_with_status / x.rooms_listed : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">Major repair: usable instructional rooms that need major repair. Locked: rooms that are condemned or under construction. Validated: share of the school's rooms with a status.</p>
            {list.length > 30 && <div className="btns"><button type="button" className="btn sm secondary" onClick={() => setAll(!all)}>{all ? 'Show the first 30' : `Show all ${n(list.length)} schools`}</button></div>}
          </section>
        </>
      )}
    </>
  );
}
