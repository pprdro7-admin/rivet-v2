import React, { useCallback, useEffect, useState } from 'react';
import { Bar, ErrorNote, Loading, go } from '../components/ui.jsx';
import { CYCLE, n, pct, problem } from '../lib/labels.js';
import { CoNotes } from '../components/Returns.jsx';

// Regional home: where each Division stands, clearing a Division, and freezing the cycle.
// The ESSD Engineers clear a Division ("Cleared by the Region"); PPRD may undo it with a reason
// (Ada, 2026-11-03).
export default function RegionProgress({ db, me }) {
  const [rows, setRows] = useState(null);
  const [cycle, setCycle] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [hist, setHist] = useState({});
  const isEssd = me.role === 'co' && /^ESSD/i.test(me.office || '');

  const load = useCallback(async () => {
    const [p, c, h] = await Promise.all([
      db.from('sdo_progress').select('*').eq('cycle_id', CYCLE).order('sdo_name'),
      db.from('cycles').select('*').eq('id', CYCLE).single(),
      db.from('sdo_clearance_history').select('*').eq('cycle_id', CYCLE).order('cleared_at', { ascending: false }),
    ]);
    if (p.error || c.error || h.error) { setError(p.error || c.error || h.error); return; }
    const byS = {};
    h.data.forEach((x) => { (byS[x.sdo_code] ||= []).push(x); });
    setHist(byS);
    setRows(p.data);
    setCycle(c.data);
  }, [db]);
  useEffect(() => { load(); }, [load]);

  async function signOff(sdo) {
    const remarks = window.prompt(`Clear ${sdo.sdo_name}? Its schools can then print their pre-filled forms, and nothing more can be recorded for this Division unless PPRD undoes the clearance.\n\nRemarks (optional):`);
    if (remarks === null) return;
    const { error: e } = await db.rpc('sign_off_sdo', { p_cycle: CYCLE, p_sdo: sdo.sdo_code, p_remarks: remarks });
    setNote(e ? { err: problem(e) } : { ok: `${sdo.sdo_name} is cleared by the Region.` });
    load();
  }
  async function undo(sdo) {
    const reason = window.prompt(`Undo the clearance of ${sdo.sdo_name}? Its schools can be updated again, and the pre-filled forms close until it is cleared again.\n\nReason (kept on record):`);
    if (reason === null) return;
    const { error: e } = await db.rpc('undo_sdo_clearance', { p_cycle: CYCLE, p_sdo: sdo.sdo_code, p_reason: reason });
    setNote(e ? { err: problem(e) } : { ok: `The clearance of ${sdo.sdo_name} is undone.` });
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
      <h1>SY 2025–2026 validation, Region VII</h1>
      {cycle?.frozen_at && <div className="notice ok">Frozen on {new Date(cycle.frozen_at).toLocaleDateString('en-PH')}: this is the baseline for later NSBI reporting.</div>}
      {note?.ok && <div className="notice ok">{note.ok}</div>}
      {note?.err && <ErrorNote error={note.err} />}
      <div className="today-top">
        <div className="tile"><strong>{pct(t.records ? t.withStatus / t.records : 0)}</strong><span className="muted">of {n(t.records)} buildings and rooms have a status from the Engineers</span></div>
        <div className="tile"><strong>{n(t.done)}</strong><span className="muted">of {n(t.schools)} schools marked Complete by the DPO</span></div>
        <div className="tile"><strong>{t.signed}</strong><span className="muted">of {rows.length} Divisions cleared by the Region</span></div>
      </div>
      <div className="card">
        <div className="scroll">
          <table className="cards">
            <thead><tr>
              <th>SDO</th><th className="num">Schools</th><th className="num">Buildings</th><th className="num">Rooms</th>
              <th className="num">Flagged rooms</th><th>With a status</th><th className="num">Schools complete</th><th className="num">Returned</th><th>Cleared by the Region</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sdo_code} className="click" onClick={() => go(`#/sdo/${r.sdo_code}`)}>
                  <td><a href={`#/sdo/${r.sdo_code}`}>{r.sdo_name}</a></td>
                  <td className="num" data-label="Schools">{n(r.schools)}</td>
                  <td className="num" data-label="Buildings">{n(r.co_buildings)}</td>
                  <td className="num" data-label="Rooms">{n(r.co_rooms)}</td>
                  <td className="num" data-label="Flagged rooms">{n(r.flagged_rooms)}</td>
                  <td data-label="With a status"><div className="stack" style={{ gap: 4 }}><span>{pct(r.share_validated)}</span><Bar share={r.share_validated} /></div></td>
                  <td className="num" data-label="Schools complete" onClick={(e) => e.stopPropagation()}>
                    <a href={`#/sdo/${r.sdo_code}?show=complete`} title="List the complete schools">{n(r.schools_complete)} of {n(r.schools)}</a></td>
                  <td className="num" data-label="Returned">{n(r.schools_returned)}</td>
                  <td data-label="Cleared by the Region" onClick={(e) => e.stopPropagation()}>
                    {r.signed_at ? (
                      <div className="stack" style={{ gap: 4 }}>
                        <span className="chip green">Cleared {new Date(r.signed_at).toLocaleDateString('en-PH')}</span>
                        {hist[r.sdo_code]?.[0]?.cleared_by && <span className="small muted">by {hist[r.sdo_code][0].cleared_by}</span>}
                        {me.role === 'ro' && !cycle?.frozen_at && <button type="button" className="btn sm danger" onClick={() => undo(r)}>Undo clearance</button>}
                      </div>
                    ) : (
                      <div className="stack" style={{ gap: 4 }}>
                        {isEssd ? <button type="button" className="btn sm secondary" disabled={Number(r.schools_complete) < Number(r.schools)}
                          title={Number(r.schools_complete) < Number(r.schools) ? 'Every school must be marked Complete first' : undefined} onClick={() => signOff(r)}>Clear the Division</button>
                          : <span className="small muted">Not yet</span>}
                        {hist[r.sdo_code]?.find((x) => x.undone_at) && (() => { const u = hist[r.sdo_code].find((x) => x.undone_at);
                          return <span className="small" style={{ color: 'var(--amber)' }}>Clearance undone {new Date(u.undone_at).toLocaleDateString('en-PH')}: {u.undo_reason}</span>; })()}
                      </div>
                    )}
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
      <CoNotes db={db} me={me} />
    </main>
  );
}
