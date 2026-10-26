import React, { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Loading, go } from '../components/ui.jsx';
import { CYCLE, n, REGION_ROLES } from '../lib/labels.js';
import { fetchAll } from '../lib/fetchAll.js';

// Infrastructure Inventory: every school's buildings and rooms as the validated record has them,
// for anyone who needs to look a school up rather than work through the validation list.
export default function Inventory({ db, me }) {
  const isRegion = REGION_ROLES.includes(me.role);
  const [rows, setRows] = useState(null);
  const [sdos, setSdos] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [sdo, setSdo] = useState(me.sdo_code ?? '');
  const [district, setDistrict] = useState('');

  useEffect(() => {
    Promise.all([
      fetchAll(() => db.from('report_facilities').select('*').eq('cycle_id', CYCLE).order('school_name').order('school_id')),
      db.from('sdos').select('code, name').order('name'),
    ]).then(([r, s]) => { setRows(r); setSdos(s.data ?? []); }, setError);
  }, [db]);

  const sdoName = useMemo(() => Object.fromEntries(sdos.map((s) => [s.code, s.name])), [sdos]);
  const districts = useMemo(() => [...new Set((rows ?? []).filter((r) => !sdo || r.sdo_code === sdo).map((r) => r.district).filter(Boolean))].sort(), [rows, sdo]);
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!sdo || r.sdo_code === sdo) && (!district || r.district === district)
      && (!w || r.school_name.toLowerCase().includes(w) || r.school_id.includes(w)));
  }, [rows, q, sdo, district]);

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!rows) return <main className="page"><Loading /></main>;

  const t = shown.reduce((a, r) => ({ b: a.b + r.buildings_validated, r: a.r + r.rooms_validated, i: a.i + r.instructional_validated }), { b: 0, r: 0, i: 0 });
  return (
    <main className="page">
      <h1>Infrastructure Inventory</h1>
      <p className="muted" style={{ margin: 0 }}>
        Each school's buildings and rooms as validated in RIVET (NSBI 2025–2026 as of 31 May 2026, with the SDO's validation so far).
        Open a school to see every building, room and step recorded.
      </p>
      <div className="filters">
        <label className="f">Find a school<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or School ID" /></label>
        {isRegion && (
          <label className="f">SDO<select value={sdo} onChange={(e) => { setSdo(e.target.value); setDistrict(''); }}>
            <option value="">All SDOs</option>
            {sdos.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select></label>
        )}
        <label className="f">District<select value={district} onChange={(e) => setDistrict(e.target.value)}>
          <option value="">All districts</option>
          {districts.map((d) => <option key={d}>{d}</option>)}
        </select></label>
      </div>
      <div className="today-top">
        <div className="tile"><strong>{n(shown.length)}</strong><span className="muted">schools</span></div>
        <div className="tile"><strong>{n(t.b)}</strong><span className="muted">buildings, validated</span></div>
        <div className="tile"><strong>{n(t.r)}</strong><span className="muted">rooms, validated</span></div>
        <div className="tile"><strong>{n(t.i)}</strong><span className="muted">usable instructional rooms</span></div>
      </div>
      <div className="card">
        <div className="scroll">
          <table className="cards">
            <thead><tr>
              <th>School</th>{isRegion && <th>SDO</th>}<th>District</th>
              <th className="num">Buildings</th><th className="num">Rooms</th><th className="num">Instructional</th>
              <th className="num">Non-instructional</th><th className="num">Usage locked</th>
            </tr></thead>
            <tbody>
              {shown.slice(0, 200).map((r) => (
                <tr key={r.school_id} className="click" onClick={() => go(`#/school/${r.school_id}`)}>
                  <td><a href={`#/school/${r.school_id}`}>{r.school_name}</a><div className="mono muted">{r.school_id}</div></td>
                  {isRegion && <td data-label="SDO">{sdoName[r.sdo_code] ?? r.sdo_code}</td>}
                  <td data-label="District">{r.district}</td>
                  <td className="num" data-label="Buildings">{n(r.buildings_validated)}</td>
                  <td className="num" data-label="Rooms">{n(r.rooms_validated)}</td>
                  <td className="num" data-label="Instructional">{n(r.instructional_validated)}</td>
                  <td className="num" data-label="Non-instructional">{n(r.noninstructional_validated)}</td>
                  <td className="num" data-label="Usage locked">{r.rooms_locked ? n(r.rooms_locked) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > 200 && <p className="muted small">Showing 200 of {n(shown.length)}. Search to narrow the list.</p>}
        {shown.length === 0 && <p className="muted">No schools match.</p>}
      </div>
    </main>
  );
}
