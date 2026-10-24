import React, { useCallback, useEffect, useState } from 'react';
import { Bar, ErrorNote, Loading, go } from '../components/ui.jsx';
import { CYCLE, n, pct, problem } from '../lib/labels.js';

// Regional Office home: where each SDO stands, sign-off, and freezing the cycle.
export default function RegionProgress({ db, me }) {
  const [rows, setRows] = useState(null);
  const [cycle, setCycle] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      db.from('sdo_progress').select('*').eq('cycle_id', CYCLE).order('sdo_name'),
      db.from('cycles').select('*').eq('id', CYCLE).single(),
    ]);
    if (p.error || c.error) { setError(p.error || c.error); return; }
    setRows(p.data);
    setCycle(c.data);
  }, [db]);
  useEffect(() => { load(); }, [load]);

  async function signOff(sdo) {
    const remarks = window.prompt(`Sign off ${sdo.sdo_name}? Nothing more can be recorded for this SDO.\n\nRemarks (e.g. certification received):`);
    if (remarks === null) return;
    const { error: e } = await db.rpc('sign_off_sdo', { p_cycle: CYCLE, p_sdo: sdo.sdo_code, p_remarks: remarks });
    setNote(e ? { err: problem(e) } : { ok: `${sdo.sdo_name} signed off.` });
    load();
  }

  async function freeze() {
    if (!window.confirm('Freeze SY 2025–2026? Its validated record becomes the baseline for later NSBI reporting, and nothing more can be recorded.')) return;
    const { error: e } = await db.rpc('freeze_cycle', { p_cycle: CYCLE });
    setNote(e ? { err: problem(e) } : { ok: 'SY 2025–2026 is frozen as the baseline.' });
    load();
  }

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!rows) return <main className="page"><Loading /></main>;

  const t = rows.reduce((a, r) => ({
    schools: a.schools + Number(r.schools), done: a.done + Number(r.schools_complete),
    records: a.records + Number(r.co_buildings) + Number(r.co_rooms),
    withStatus: a.withStatus + Number(r.buildings_with_status) + Number(r.rooms_with_status),
    signed: a.signed + (r.signed_at ? 1 : 0),
  }), { schools: 0, done: 0, records: 0, withStatus: 0, signed: 0 });

  return (
    <main className="page">
      <div className="spread">
        <h1>SY 2025–2026 validation, Region VII</h1>
        <span className="muted">CO raw data as of 21 October 2026</span>
      </div>
      {cycle?.frozen_at && <div className="notice ok">Frozen on {new Date(cycle.frozen_at).toLocaleDateString('en-PH')}: this is the baseline for later NSBI reporting.</div>}
      {note?.ok && <div className="notice ok">{note.ok}</div>}
      {note?.err && <ErrorNote error={note.err} />}
      <div className="today-top">
        <div className="tile"><strong>{pct(t.records ? t.withStatus / t.records : 0)}</strong><span className="muted">of {n(t.records)} buildings and rooms have a status</span></div>
        <div className="tile"><strong>{n(t.done)}</strong><span className="muted">of {n(t.schools)} schools complete (DPO checked)</span></div>
        <div className="tile"><strong>{t.signed}</strong><span className="muted">of {rows.length} SDOs signed off</span></div>
      </div>
      <div className="card">
        <div className="scroll">
          <table>
            <thead><tr>
              <th>SDO</th><th className="num">Schools</th><th className="num">Buildings</th><th className="num">Rooms</th>
              <th className="num">Flagged rooms</th><th>Validated</th><th className="num">Schools complete</th><th className="num">Returned</th><th>Sign-off</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sdo_code} className="click" onClick={() => go(`#/sdo/${r.sdo_code}`)}>
                  <td><a href={`#/sdo/${r.sdo_code}`}>{r.sdo_name}</a></td>
                  <td className="num">{n(r.schools)}</td>
                  <td className="num">{n(r.co_buildings)}</td>
                  <td className="num">{n(r.co_rooms)}</td>
                  <td className="num">{n(r.flagged_rooms)}</td>
                  <td><div className="stack" style={{ gap: 4 }}><span>{pct(r.share_validated)}</span><Bar share={r.share_validated} /></div></td>
                  <td className="num">{n(r.schools_complete)}</td>
                  <td className="num">{n(r.schools_returned)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.signed_at ? <span className="chip green">Signed off</span>
                      : me.role === 'ro' && <button type="button" className="btn sm secondary" disabled={Number(r.schools_complete) < Number(r.schools)} onClick={() => signOff(r)}>Sign off</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {me.role === 'ro' && !cycle?.frozen_at && (
        <div className="btns"><button type="button" className="btn secondary" disabled={t.signed < rows.length} onClick={freeze}>Freeze SY 2025–2026 as the baseline</button></div>
      )}
    </main>
  );
}
