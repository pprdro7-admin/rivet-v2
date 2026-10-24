import React, { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Loading } from '../components/ui.jsx';
import { n, pct } from '../lib/labels.js';
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
  const isRegion = me.role === 'ro' || me.role === 'admin';

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
    if (!year) return;
    setData(null);
    const scoped = (q) => (sdo ? q.eq('sdo_code', sdo) : q);
    Promise.all([
      fetchAll(() => scoped(db.from('dash_conditions').select('*').eq('cycle_id', year))),
      fetchAll(() => scoped(db.from('dash_room_usage').select('*').eq('cycle_id', year))),
      fetchAll(() => scoped(db.from('dash_school_totals').select('*').eq('cycle_id', year))),
      scoped(db.from('sdo_progress').select('*').eq('cycle_id', year)),
    ]).then(([c, u, s, p]) => {
      if (p.error) { setError(p.error); return; }
      setData({ cond: c, usage: u, totals: s, progress: p.data });
    }).catch(setError);
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
      {!data ? <Loading /> : y?.has_buildings ? <ValidationView data={data} label={y.label} /> : <SchoolTablesView data={data} label={y?.label} />}
    </main>
  );
}

const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);

function ValidationView({ data, label }) {
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
        <Pairs title="Buildings by condition" rows={b} labelKey="condition" order={BUILDING_ORDER} />
        <Pairs title="Rooms by condition" rows={r} labelKey="condition" order={ROOM_ORDER} />
      </div>
      <Pairs wide title="Rooms by usage" rows={usage} labelKey="usage" order={USAGE_ORDER}
        note="Usage locked: rooms that are condemned or under construction, or in such a building. They are counted on their own, neither instructional nor non-instructional." />
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
function Pairs({ title, rows, labelKey, order, note, wide }) {
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
      {lines.length === 0 ? <p className="muted">No records.</p> : (
        <div className="pairs" role="table" aria-label={title}>
          {lines.map((l) => (
            <div className="pair" role="row" key={l.label}>
              <span className="pair-label" role="rowheader">{l.label}</span>
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
  data.totals.forEach((x) => { t[x.measure] = (t[x.measure] ?? 0) + Number(x.total); });
  const w = (x) => n(Math.round(x));
  const has = data.totals.length > 0;
  if (!has) return <div className="notice info">The NSBI {label} school-level tables are not loaded yet.</div>;
  const lv = (base) => ['es', 'jhs', 'shs'].reduce((a, k) => a + (t[`${base}_${k}`] ?? 0), 0);
  const enrol = t.enrollment_k12 ?? lv('enrollment');
  const rooms = lv('instructional_rooms');
  const levels = [['Elementary', 'es'], ['Junior High', 'jhs'], ['Senior High', 'shs']];
  return (
    <>
      <p className="small muted">As reported in the NSBI {label}: CO's classroom summary and Tables 3 to 5. Not validated in RIVET.</p>
      <div className="grid tiles">
        <Tile big={n(enrol)} text="learners enrolled" />
        <Tile big={w(rooms)} text="instructional rooms" />
        <Tile big={rooms ? (enrol / rooms).toFixed(1) : '—'} text="learners per instructional room" />
        <Tile big={n((t.tls_count_es ?? 0) + (t.tls_count_ss ?? 0))} text="temporary learning spaces" />
        <Tile big={n((t.makeshift_count_es ?? 0) + (t.makeshift_count_ss ?? 0))} text="makeshift rooms" />
        <Tile big={n(lv('total_seat'))} text="seats (Table 5)" />
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
                    <td className="num" data-label="Learners per room">{ir ? (e / ir).toFixed(1) : '—'}</td>
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
