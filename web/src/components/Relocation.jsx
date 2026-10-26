import React, { useState } from 'react';
import { CYCLE, problem } from '../lib/labels.js';

export const RELOCATION = { temporary_site: 'Relocated to a temporary site', new_site: 'Relocated to a new school site' };
const REASONS = { unsafe: 'Previous site declared unsafe', other: 'Other reason' };
const when = (t) => new Date(t).toLocaleDateString('en-PH', { dateStyle: 'medium' });

// A school that moved since SY 2024-2025 still lists the previous site's buildings (carried over).
// The DE or DPO marks the school as relocated; each building of the previous site is then marked
// For deletion with the reason "At the previous site", so it leaves the count but stays on record.
export default function Relocation({ db, schoolId, relocation: r, isSDO, onDone }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await db.rpc('record_school_relocation', { p_cycle: CYCLE, p_school: schoolId, p_kind: form.kind,
      p_reason: form.kind === 'not_relocated' ? null : form.reason || null, p_remarks: form.remarks || null });
    setBusy(false);
    if (error) { setErr(problem(error)); return; }
    setForm(null);
    onDone(form.kind === 'not_relocated' ? 'The relocation mark is cleared.' : `Saved: ${RELOCATION[form.kind].toLowerCase()}.`);
  }
  const start = () => setForm({ kind: r?.kind ?? 'temporary_site', reason: r?.reason ?? 'unsafe', remarks: r?.remarks ?? '' });

  return (
    <>
      {r && (
        <div className="notice info stack">
          <span><b>{RELOCATION[r.kind]}</b>{r.reason ? `: ${REASONS[r.reason].toLowerCase()}` : ''}{r.remarks ? `. ${r.remarks}` : ''}
            <span className="small muted"> (recorded by {r.recorded_by_name}, {when(r.recorded_at)})</span></span>
          <span className="small">The list below was carried over from SY 2024–2025. Mark each building of the previous site <b>For deletion</b> with the reason
            <b> At the previous site (school relocated)</b>: it leaves the SY 2025–2026 count but stays on record. Structures at a temporary site go in Table 3 (temporary learning spaces and makeshift rooms).</span>
        </div>
      )}
      {isSDO && !form && (
        <div className="btns" style={{ margin: 0 }}>
          <button type="button" className="btn sm secondary" onClick={start}>{r ? 'Change relocation' : 'School relocated?'}</button>
        </div>
      )}
      {form && (
        <form className="card stack" onSubmit={save}>
          <h3 style={{ margin: 0 }}>Relocation</h3>
          <div className="stack">
            {Object.entries({ ...RELOCATION, ...(r ? { not_relocated: 'Not relocated (clear the mark)' } : {}) }).map(([k, label]) => (
              <label key={k} className="check"><input type="radio" name="kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} /> {label}</label>
            ))}
          </div>
          {form.kind !== 'not_relocated' && (
            <label className="f">Reason
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                {Object.entries(REASONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          )}
          <label className="f">Remarks{form.reason === 'other' && form.kind !== 'not_relocated' ? ' (say what the reason is)' : ' (optional)'}
            <textarea rows={2} value={form.remarks} required={form.reason === 'other' && form.kind !== 'not_relocated'}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="e.g. where the school now holds classes, since when" />
          </label>
          {err && <div className="notice err">{err}</div>}
          <div className="btns">
            <button type="submit" className="btn sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn sm secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}
    </>
  );
}
