import React, { useEffect, useMemo, useState } from 'react';
import { Bar, ErrorNote, Loading, go } from '../components/ui.jsx';
import { CYCLE, n, pct } from '../lib/labels.js';
import { fetchAll } from '../lib/fetchAll.js';

const SHOW = {
  all: ['All schools', () => true],
  todo: ['Not yet 100% validated', (s) => Number(s.share_validated) < 1],
  check: ['Ready for the DPO check', (s) => Number(s.share_validated) === 1 && !s.dpo_complete],
  returned: ['Returned to DE', (s) => s.dpo_result === 'returned' && !s.dpo_complete],
  complete: ['Complete', (s) => s.dpo_complete],
};

// The School Tally sheet: per school, NSBI counts, validated counts, progress. Start here.
export default function SchoolTally({ db, me, sdoCode }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState(me.role === 'dpo' ? 'check' : 'todo');

  useEffect(() => {
    setRows(null);
    fetchAll(() => db.from('school_tally').select('*').eq('cycle_id', CYCLE).eq('sdo_code', sdoCode)
      .order('flagged_rooms', { ascending: false }).order('school_name'))
      .then(setRows, setError);
  }, [db, sdoCode]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const words = q.trim().toLowerCase();
    return rows.filter(SHOW[show][1]).filter((s) => !words
      || s.school_name.toLowerCase().includes(words) || s.school_id.includes(words) || (s.district || '').toLowerCase().includes(words));
  }, [rows, q, show]);

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!rows) return <main className="page"><Loading /></main>;

  const done = rows.filter((s) => s.dpo_complete).length;
  return (
    <main className="page">
      <div className="spread">
        <h1>School Tally{me.sdo_code ? '' : ` · ${sdoCode}`}</h1>
        <span className="muted">{n(done)} of {n(rows.length)} schools complete</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Every building and room gets a status, not only the flagged ones. Schools with the most flagged rooms are listed first.
      </p>
      <div className="filters">
        <label className="f">Find a school<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, School ID or district" /></label>
        <label className="f">Show<select value={show} onChange={(e) => setShow(e.target.value)}>
          {Object.entries(SHOW).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select></label>
      </div>
      <div className="card">
        <div className="scroll">
          <table className="cards">
            <thead><tr>
              <th>School</th><th>District</th>
              <th className="num">Buildings NSBI → validated</th><th className="num">Rooms NSBI → validated</th>
              <th className="num">Flagged rooms</th><th>Validated</th><th>DPO check</th>
            </tr></thead>
            <tbody>
              {shown.slice(0, 300).map((s) => (
                <tr key={s.school_id} className="click" onClick={() => go(`#/school/${s.school_id}`)}>
                  <td><a href={`#/school/${s.school_id}`}>{s.school_name}</a><div className="mono muted">{s.school_id}</div></td>
                  <td data-label="District">{s.district}</td>
                  <td className="num" data-label="Buildings NSBI → validated">{s.co_buildings} → <b style={{ color: s.buildings_after !== s.co_buildings ? 'var(--red)' : undefined }}>{s.buildings_after}</b></td>
                  <td className="num" data-label="Rooms NSBI → validated">{s.co_rooms} → <b style={{ color: s.rooms_after !== s.co_rooms ? 'var(--red)' : undefined }}>{s.rooms_after}</b></td>
                  <td className="num" data-label="Flagged rooms">{s.flagged_rooms || ''}</td>
                  <td data-label="Validated"><div className="stack" style={{ gap: 4 }}><span>{pct(s.share_validated)}</span><Bar share={s.share_validated} /></div></td>
                  <td data-label="DPO check">{s.dpo_complete ? <span className="chip green">Complete</span>
                    : s.dpo_result === 'returned' ? <span className="chip amber">Returned to DE</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > 300 && <p className="muted small">Showing 300 of {n(shown.length)}. Search to narrow the list.</p>}
        {shown.length === 0 && <p className="muted">No schools in this list.</p>}
      </div>
    </main>
  );
}
