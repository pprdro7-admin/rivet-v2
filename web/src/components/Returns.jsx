import React, { useCallback, useEffect, useState } from 'react';
import { ErrorNote } from './ui.jsx';
import { CYCLE, problem } from '../lib/labels.js';

const STATE = {
  open: ['chip amber', 'Waiting for an answer'],
  answered: ['chip blue', 'Answered'],
  closed: ['chip green', 'Closed'],
};
const when = (t) => (t ? new Date(t).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function StateChip({ state }) {
  const [cls, label] = STATE[state] ?? STATE.open;
  return <span className={cls}>{label}</span>;
}

// The open send-back for one school, keyed for the school page: { ret, notes: { 'building:12': '...', ... } }.
export async function loadSendBack(db, schoolId) {
  const { data } = await db.from('return_status').select('*').eq('kind', 'de_to_school').eq('cycle_id', CYCLE)
    .eq('school_id', schoolId).neq('state', 'closed').order('id', { ascending: false }).limit(1);
  const ret = data?.[0] ?? null;
  const notes = {};
  (ret?.items ?? []).forEach((i) => { notes[`${i.kind}:${i.id}`] = i.note || 'Sent back'; });
  return { ret, notes };
}

// The DE (or DPO) sends a school's records back with notes; the school answers; the DE closes.
export function SendBack({ db, schoolId, sendBack, buildings, rooms, isSDO, isSchool, onDone }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ret = sendBack?.ret;

  const items = [
    ...buildings.map((b) => ({ kind: 'building', id: b.building_id, label: `Building ${b.building_no} (${b.building_code})` })),
    ...rooms.map((r) => ({ kind: 'room', id: r.room_id,
      label: `Building ${buildings.find((b) => b.building_id === r.building_id)?.building_no ?? '?'}, Room ${r.room_no} (${r.room_code ?? 'no code'})` })),
    ...[['T3', 'Table 3'], ['T4', 'Table 4a/4b'], ['T5', 'Table 5'], ['T6', 'Table 6'], ['T7', 'Table 7']]
      .map(([id, label]) => ({ kind: 'table', id, label })),
  ];

  async function run(fn, args, msg) {
    setBusy(true); setErr(null);
    const { error } = await db.rpc(fn, args);
    setBusy(false);
    if (error) setErr(problem(error)); else { setForm(null); onDone(msg); }
  }
  function send() {
    const picked = items.filter((i) => form.picked[`${i.kind}:${i.id}`] !== undefined)
      .map((i) => ({ ...i, note: form.picked[`${i.kind}:${i.id}`] || null }));
    run('send_back_to_school', { p_cycle: CYCLE, p_school: schoolId, p_note: form.note, p_items: picked }, 'Sent back to the school.');
  }

  if (!ret) {
    if (!isSDO) return null;
    if (!form) {
      return <div className="btns"><button type="button" className="btn secondary" onClick={() => setForm({ note: '', picked: {} })}>Send back to school</button></div>;
    }
    return (
      <section className="card">
        <h2>Send back to school</h2>
        <label className="f">What should the school check or correct?<textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <details>
          <summary className="small">Pick the records to return (optional), each with its own note</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {items.map((i) => {
              const k = `${i.kind}:${i.id}`;
              const on = form.picked[k] !== undefined;
              const set = (v) => { const p = { ...form.picked }; if (v === null) delete p[k]; else p[k] = v; setForm({ ...form, picked: p }); };
              return (
                <div key={k} className="pickrow">
                  <label className="check small"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked ? '' : null)} /> {i.label}</label>
                  {on && <input value={form.picked[k]} onChange={(e) => set(e.target.value)} placeholder="Note for this record" />}
                </div>
              );
            })}
          </div>
        </details>
        {err && <ErrorNote error={err} />}
        <div className="btns">
          <button type="button" className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send back'}</button>
          <button type="button" className="btn secondary" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </section>
    );
  }

  return (
    <section className="notice warn stack">
      <div className="spread">
        <b>{isSchool ? 'Returned by the Division Engineer' : 'Sent back to the school'}</b>
        <StateChip state={ret.state} />
      </div>
      <div>{ret.note} <span className="small muted">({ret.raised_by_name}, {when(ret.raised_at)})</span></div>
      {ret.items.length > 0 && (
        <ul className="small" style={{ margin: 0 }}>
          {ret.items.map((i) => <li key={`${i.kind}:${i.id}`}><b>{i.label}</b>{i.note ? `: ${i.note}` : ''}</li>)}
        </ul>
      )}
      {ret.state === 'answered' && <div><b>School's answer:</b> {ret.last_note} <span className="small muted">({ret.last_by_name}, {when(ret.last_at)})</span></div>}
      {isSchool && ret.state === 'open' && (
        form ? (
          <div className="stack">
            <label className="f">Your answer (after updating the records below)<textarea rows={2} value={form.note} onChange={(e) => setForm({ note: e.target.value })} /></label>
            {err && <ErrorNote error={err} />}
            <div className="btns">
              <button type="button" className="btn sm" disabled={busy} onClick={() => run('answer_return', { p_return: ret.id, p_note: form.note }, 'Answer sent to the Division Engineer.')}>Send answer</button>
              <button type="button" className="btn sm secondary" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </div>
        ) : <div className="btns"><button type="button" className="btn sm" onClick={() => setForm({ note: '' })}>Answer the Division Engineer</button></div>
      )}
      {isSDO && (
        <div className="btns">
          <button type="button" className="btn sm secondary" disabled={busy} onClick={() => run('close_return', { p_return: ret.id, p_note: null }, 'Closed.')}>
            {ret.state === 'answered' ? 'Accept and close' : 'Close without an answer'}
          </button>
        </div>
      )}
      {err && !form && <ErrorNote error={err} />}
    </section>
  );
}

// Notes from the Central Office to the Regional Office: CO writes and closes, the RO answers.
// Scope: the whole region (RegionProgress), one SDO (School Tally) or one school (school page).
export function CoNotes({ db, me, sdoCode, schoolId, schoolSdo }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [answer, setAnswer] = useState({});
  const [err, setErr] = useState(null);
  const isCO = me.role === 'co' && !me.office; // a view-only regional office (ESSD) does not write CO notes
  const isRO = me.role === 'ro';

  const load = useCallback(() => {
    let q = db.from('return_status').select('*').eq('kind', 'co_to_ro').eq('cycle_id', CYCLE).order('id', { ascending: false });
    if (schoolId) q = q.eq('school_id', schoolId);
    else if (sdoCode) q = q.eq('sdo_code', sdoCode);
    q.then(({ data, error }) => (error ? setErr(problem(error)) : setRows(data)));
  }, [db, sdoCode, schoolId]);
  useEffect(() => { if (isCO || isRO || me.role === 'admin') load(); }, [load, isCO, isRO, me.role]);

  if (!(isCO || isRO || me.role === 'admin') || !rows) return null;
  const canRaise = isCO && (sdoCode || schoolId);
  if (!canRaise && rows.length === 0) return null;

  async function rpc(fn, args) {
    setErr(null);
    const { error } = await db.rpc(fn, args);
    if (error) setErr(problem(error)); else { setForm(null); setAnswer({}); load(); }
  }

  return (
    <section className="card">
      <div className="spread">
        <h2>Notes from the Central Office</h2>
        {canRaise && !form && <button type="button" className="btn sm secondary" onClick={() => setForm({ note: '' })}>Send a note to the RO</button>}
      </div>
      {form && (
        <div className="stack">
          <label className="f">Note for the Regional Office{schoolId ? ' about this school' : ' about this SDO'}<textarea rows={2} value={form.note} onChange={(e) => setForm({ note: e.target.value })} /></label>
          <div className="btns">
            <button type="button" className="btn sm" onClick={() => rpc('poke_ro', { p_cycle: CYCLE, p_sdo: schoolId ? schoolSdo : sdoCode, p_school: schoolId ?? null, p_note: form.note })}>Send</button>
            <button type="button" className="btn sm secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {err && <ErrorNote error={err} />}
      {rows.length === 0 && !form && <p className="muted small" style={{ margin: 0 }}>No notes yet.</p>}
      {rows.map((r) => (
        <div key={r.id} className="stack note-row">
          <div className="spread">
            <span><b>{r.sdo_code}{r.school_id ? ` · School ${r.school_id}` : ''}</b> <span className="small muted">{r.raised_by_name}, {when(r.raised_at)}</span></span>
            <StateChip state={r.state} />
          </div>
          <div>{r.note}</div>
          {r.last_note && <div className="small"><b>{r.state === 'closed' ? 'Closed' : 'RO answer'}:</b> {r.last_note} <span className="muted">({r.last_by_name})</span></div>}
          {isRO && r.state === 'open' && (
            <div className="pickrow">
              <input value={answer[r.id] ?? ''} onChange={(e) => setAnswer({ ...answer, [r.id]: e.target.value })} placeholder="Answer for the Central Office" />
              <button type="button" className="btn sm" onClick={() => rpc('answer_return', { p_return: r.id, p_note: answer[r.id] ?? '' })}>Answer</button>
            </div>
          )}
          {isCO && r.state !== 'closed' && (
            <div className="btns"><button type="button" className="btn sm secondary" onClick={() => rpc('close_return', { p_return: r.id })}>Close</button></div>
          )}
        </div>
      ))}
    </section>
  );
}
