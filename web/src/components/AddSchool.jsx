import React, { useState } from 'react';
import { ErrorNote, go } from './ui.jsx';
import { CYCLE, problem } from '../lib/labels.js';

// The DPO adds a school that is new, or that did not submit its NSBI SY 2025-2026 (Ada, 2026-11-03).
// It joins the Division's list like any school: the DE and the school add its buildings and rooms.
export default function AddSchool({ db }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ id: '', name: '', reason: '', district: '', municipality: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: k === 'id' ? e.target.value.replace(/[^0-9]/g, '').slice(0, 6) : e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await db.rpc('add_school', { p_cycle: CYCLE, p_school_id: f.id, p_name: f.name, p_reason: f.reason,
      p_district: f.district || null, p_municipality: f.municipality || null, p_remarks: f.remarks || null });
    setBusy(false);
    if (error) { setErr(problem(error)); return; }
    go(`#/school/${f.id}`);
  }

  if (!open) {
    return (
      <div className="btns">
        <button type="button" className="btn secondary" onClick={() => setOpen(true)}>Add a school not in this list</button>
        <span className="small muted">A new school, or one that did not submit its NSBI SY 2025–2026.</span>
      </div>
    );
  }
  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>Add a school not in this list</h2>
      <fieldset className="f">
        <legend>Why is it not in the list?</legend>
        <label className="tick"><input type="radio" name="why" checked={f.reason === 'new_school'} onChange={() => setF({ ...f, reason: 'new_school' })} /> A new school</label>
        <label className="tick"><input type="radio" name="why" checked={f.reason === 'no_nsbi_report'} onChange={() => setF({ ...f, reason: 'no_nsbi_report' })} /> It did not submit its NSBI SY 2025–2026</label>
      </fieldset>
      <div className="grid2">
        <label className="f">School ID<input inputMode="numeric" value={f.id} onChange={set('id')} placeholder="6 digits" required /></label>
        <label className="f">School name<input value={f.name} onChange={set('name')} required /></label>
        <label className="f">District (optional)<input value={f.district} onChange={set('district')} /></label>
        <label className="f">City / Municipality (optional)<input value={f.municipality} onChange={set('municipality')} /></label>
      </div>
      <label className="f">Remarks (optional)<textarea rows={2} value={f.remarks} onChange={set('remarks')} /></label>
      {err && <ErrorNote error={err} />}
      <div className="btns">
        <button type="submit" className="btn" disabled={busy || f.id.length !== 6 || !f.name.trim() || !f.reason}>{busy ? 'Adding…' : 'Add the school'}</button>
        <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>The school then appears in your list. The Division Engineer and the school add its buildings and rooms, and you can create its school account under School access.</p>
    </form>
  );
}
