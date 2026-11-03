import React, { useCallback, useEffect, useState } from 'react';
import { ErrorNote } from './ui.jsx';
import { CYCLE, n, problem } from '../lib/labels.js';

// Table 4A, one row per building (Ada, 2026-11-03): the WATSAN attached to a building is counted on
// that building's row, the Building Number being the one in Table 1, so the school's total is always
// the sum of its buildings and cannot be over or under declared. A building set for deletion carries
// none; one condemned or demolished is flagged. Rules live in record_building_watsan.

export const WATSAN_COLS = [
  ['toilet_male', 'Male'], ['toilet_female', 'Female'], ['toilet_pwd', 'PWD'], ['toilet_shared', 'Shared'],
  ['nonfunc_toilet', 'Non-functional toilet bowls'], ['sink', 'Sinks / washbasins'], ['urinal', 'Urinals'],
  ['urinal_trough', 'Urinal troughs'], ['septic_tank', 'With septic tank'], ['faucet_with_water', 'With water'],
  ['faucet_without_water', 'Without water'],
];
const YESNO = 'septic_tank';
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
  async function save(removed = false) {
    setBusy(true);
    const r = rows.find((x) => x.no === edit.no);
    const measures = removed ? null : Object.fromEntries(Object.entries(edit.form).map(([k, v]) => [k, v === '' ? null : Number(v)]));
    const { error: e } = await db.rpc('record_building_watsan', { p_cycle: CYCLE, p_school: schoolId, p_building_no: edit.no,
      p_seen: r.w?.last_step_id ?? null, p_measures: measures, p_removed: removed, p_remarks: edit.remarks || null });
    setBusy(false);
    if (e) { setErr(problem(e)); return; }
    setEdit(null); load();
    onSaved?.(isSchool ? 'Update sent to the Division Engineer.' : `Building ${edit.no} WATSAN saved.`);
  }

  return (
    <details className="card other" open={!!edit || undefined}>
      <summary><h3>Table 4A · Water and sanitation attached to a building</h3>
        {anyEntered ? <span className="chip green">Filled in</span> : <span className="chip gray">Blank</span>}</summary>
      <p className="small muted" style={{ margin: 0 }}>
        One row per building, by its Building Number in Table 1. The school's total is the sum of its buildings.
        A building set for deletion carries no WATSAN.
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
                      <div className="small">{r.gone ? 'For deletion' : r.condition}</div></td>
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
                      <button type="button" className="btn sm secondary" onClick={() => start(r)}>{v ? 'Update' : 'Fill in'}</button>)}</td>
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
                          <button type="button" className="btn sm" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : isSchool ? 'Send to the SDO' : 'Save'}</button>
                          {v && <button type="button" className="btn sm danger" disabled={busy} onClick={() => save(true)}>This building has no WATSAN</button>}
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
