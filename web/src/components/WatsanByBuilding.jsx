import React, { useCallback, useEffect, useState } from 'react';
import { ErrorNote } from './ui.jsx';
import { CYCLE, n, problem } from '../lib/labels.js';

// Table 4A, one row per building (Ada, 2026-11-03): the WATSAN attached to a building is counted on
// that building's row, the Building Number being the one in Table 1, so the school's total is always
// the sum of its buildings and cannot be over or under declared. A building set for deletion carries
// none; one condemned or demolished is flagged. Rules live in record_building_watsan.
// Every other building is answered, with its counts or "No WATSAN" (all 0), so that a blank never
// passes for none; an unanswered building keeps the school from being marked Complete.

export const WATSAN_COLS = [
  ['toilet_male', 'Male'], ['toilet_female', 'Female'], ['toilet_pwd', 'PWD'], ['toilet_shared', 'Shared'],
  ['nonfunc_toilet', 'Non-functional toilet bowls'], ['sink', 'Sinks / washbasins'], ['urinal', 'Urinals'],
  ['urinal_trough', 'Urinal troughs'], ['septic_tank', 'With septic tank'], ['faucet_with_water', 'With water'],
  ['faucet_without_water', 'Without water'],
];
const YESNO = 'septic_tank';
const ZEROS = Object.fromEntries(WATSAN_COLS.map(([k]) => [k, 0]));
const allZero = (m) => !!m && WATSAN_COLS.every(([k]) => m[k] != null && Number(m[k]) === 0);
const show = (v, k) => (v === null || v === undefined ? <span className="muted">—</span>
  : k === YESNO ? (Number(v) === 1 ? 'Yes' : 'No') : n(v));

export default function WatsanByBuilding({ db, schoolId, canEdit, isSchool, isSDO, was, wasLabel, onSaved }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(null); // { no, form, remarks }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    const [b, nb, w] = await Promise.all([
      db.from('building_status').select('building_no, building_type, final_condition, status').eq('cycle_id', CYCLE).eq('school_id', schoolId),
      db.from('live_new_buildings').select('building_no, building_type, building_condition').eq('cycle_id', CYCLE).eq('school_id', schoolId),
      db.from('building_watsan_status').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId),
    ]);
    const e = b.error || nb.error || w.error;
    if (e) { setError(e); return; }
    const ws = Object.fromEntries(w.data.map((r) => [r.building_no, r]));
    const list = [
      ...b.data.map((x) => ({ no: x.building_no, type: x.building_type, condition: x.final_condition, gone: x.status === 'for_deletion' })),
      ...nb.data.map((x) => ({ no: x.building_no, type: x.building_type, condition: x.building_condition, isNew: true })),
    ].sort((a, c) => a.no - c.no).map((x) => ({ ...x, w: ws[x.no] }));
    setRows(list);
  }, [db, schoolId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!rows) return null;

  const total = (k) => rows.reduce((a, r) => a + (r.w?.validated?.[k] != null ? Number(r.w.validated[k]) : 0), 0);
  const anyEntered = rows.some((r) => r.w?.validated);
  const wasTotal = (k) => {
    if (!was) return null;
    const vals = Object.entries(was).filter(([key]) => key.startsWith(`attached_${k === YESNO ? 'septic_tank' : k.startsWith('toilet_') ? `func_${k}` : k}_`));
    return vals.length ? vals.reduce((a, [, v]) => a + Number(v ?? 0), 0) : null;
  };

  function start(r, from) {
    const src = from ?? r.w?.validated ?? {};
    setEdit({ no: r.no, remarks: '', form: Object.fromEntries(WATSAN_COLS.map(([k]) => [k, src[k] == null ? '' : String(src[k])])) });
    setErr(null);
  }
  async function save(how = 'counts', no = edit?.no, remarks = edit?.remarks) {
    setBusy(true);
    const r = rows.find((x) => x.no === no);
    const measures = how === 'clear' ? null : how === 'none' ? ZEROS
      : Object.fromEntries(Object.entries(edit.form).map(([k, v]) => [k, v === '' ? null : Number(v)]));
    const { error: e } = await db.rpc('record_building_watsan', { p_cycle: CYCLE, p_school: schoolId, p_building_no: no,
      p_seen: r.w?.last_step_id ?? null, p_measures: measures, p_removed: how === 'clear', p_remarks: remarks || null });
    setBusy(false);
    if (e) { if (edit) setErr(problem(e)); else setError(e); return; }
    setEdit(null); load();
    onSaved?.(isSchool ? 'Update sent to the Division Engineer.'
      : how === 'none' ? `Building ${no}: No WATSAN (all 0).` : `Building ${no} WATSAN saved.`);
  }
  const asked = rows.filter((r) => !r.gone);
  const answered = asked.filter((r) => r.w?.validated).length;

  return (
    <details className="card other" open={!!edit || undefined}>
      <summary><h3>Table 4A · Water and sanitation attached to a building</h3>
        {answered === asked.length ? <span className="chip green">All {asked.length} buildings answered</span>
          : <span className="chip amber">{asked.length - answered} of {asked.length} buildings not yet reported</span>}</summary>
      <p className="small muted" style={{ margin: 0 }}>
        One row per building, by its Building Number in Table 1. Answer every building: give its counts, or
        mark <b>No WATSAN</b> and it is reported as 0 in every column. The school cannot be marked Complete while
        a building is not yet reported. A building set for deletion carries no WATSAN.
      </p>
      <div className="scroll">
        <table className="watsan">
          <thead>
            <tr><th rowSpan={2}>Building</th><th colSpan={4}>Functional toilet bowls</th>
              {WATSAN_COLS.slice(4, 9).map(([k, l]) => <th key={k} rowSpan={2} className="num">{l}</th>)}
              <th colSpan={2}>Faucets</th><th rowSpan={2} /></tr>
            <tr>{[...WATSAN_COLS.slice(0, 4), ...WATSAN_COLS.slice(9)].map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const editing = edit?.no === r.no;
              const v = r.w?.validated;
              return (
                <React.Fragment key={r.no}>
                  <tr className={r.gone ? 'muted' : ''}>
                    <td><b>Building {r.no}</b><div className="small muted">{r.type}{r.isNew ? ' · not in the NSBI' : ''}</div>
                      <div className="small">{r.gone ? 'For deletion' : r.condition}</div>
                      {!r.gone && !v && <span className="chip amber">Not yet reported</span>}
                      {allZero(v) && <span className="chip gray">No WATSAN</span>}</td>
                    {WATSAN_COLS.map(([k, l]) => (
                      <td key={k} className="num">
                        {editing ? (k === YESNO
                          ? <select value={edit.form[k]} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, [k]: e.target.value } })} aria-label={l}>
                              <option value="">—</option><option value="1">Yes</option><option value="0">No</option></select>
                          : <input inputMode="numeric" value={edit.form[k]} aria-label={l} style={{ width: 56, textAlign: 'right' }}
                              onChange={(e) => setEdit({ ...edit, form: { ...edit.form, [k]: e.target.value.replace(/[^0-9]/g, '') } })} />)
                          : show(v?.[k], k)}
                        {!editing && r.w?.school_update && <div className="small" style={{ color: 'var(--amber, #a15c00)' }}>{show(r.w.school_update[k], k)}</div>}
                      </td>
                    ))}
                    <td>{canEdit && !editing && !r.gone && (
                      <div className="btns" style={{ flexWrap: 'nowrap' }}>
                        <button type="button" className="btn sm secondary" onClick={() => start(r)}>{v ? 'Update' : 'Fill in'}</button>
                        {!v && !isSchool && <button type="button" className="btn sm secondary" disabled={busy} onClick={() => save('none', r.no, '')}>No WATSAN</button>}
                      </div>)}
                      {canEdit && !editing && r.gone && v && !isSchool && (
                        <button type="button" className="btn sm danger" disabled={busy} onClick={() => save('clear', r.no, '')}>Clear the row</button>)}</td>
                  </tr>
                  {r.w?.flag && <tr><td colSpan={WATSAN_COLS.length + 2}><div className="flags">{r.w.flag}</div></td></tr>}
                  {r.w?.school_update && !editing && (
                    <tr><td colSpan={WATSAN_COLS.length + 2}>
                      <div className="notice warn small">{isSchool ? 'Your update (in amber), waiting for the Division Engineer.' : 'Update from the school (in amber).'}
                        {r.w.school_update_remarks && <> Remarks: {r.w.school_update_remarks}</>}
                        {isSDO && <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => start(r, r.w.school_update)}>Review</button>}</div>
                    </td></tr>
                  )}
                  {editing && (
                    <tr><td colSpan={WATSAN_COLS.length + 2}>
                      <div className="stack">
                        <label className="f">Remarks (optional)<textarea rows={2} value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} /></label>
                        {err && <ErrorNote error={err} />}
                        <div className="btns">
                          <button type="button" className="btn sm" disabled={busy} onClick={() => save('counts')}>{busy ? 'Saving…' : isSchool ? 'Send to the SDO' : 'Save'}</button>
                          <button type="button" className="btn sm secondary" disabled={busy} onClick={() => save('none')}>No WATSAN in this building (all 0)</button>
                          <button type="button" className="btn sm secondary" onClick={() => setEdit(null)}>Cancel</button>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
            <tr className="total"><td><b>School total</b>{was && <div className="small muted">was ({wasLabel})</div>}</td>
              {WATSAN_COLS.map(([k]) => <td key={k} className="num"><b>{k === YESNO ? (total(k) > 0 ? 'Yes' : anyEntered ? 'No' : '—') : anyEntered ? n(total(k)) : '—'}</b>
                {wasTotal(k) != null && <div className="small muted">{k === YESNO ? (wasTotal(k) > 0 ? 'Yes' : 'No') : n(wasTotal(k))}</div>}</td>)}<td /></tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
