import React, { useCallback, useEffect, useState } from 'react';
import { ErrorNote } from './ui.jsx';
import { CYCLE, n, problem } from '../lib/labels.js';

// The rest of the SY 2025-2026 template for one school. Tables 3 to 7 start blank and are filled in
// by the SDO (a school's entry waits for the SDO), with the latest NSBI values CO released shown beside
// for reference only (school_other_data). The classroom summary is shown read-only. Keys are those
// written by scripts/load_co_school_tables.py.

const ES_SS = [['es', 'Elementary'], ['ss', 'Secondary']];
const ES_JHS_SHS = [['es', 'ES'], ['jhs', 'JHS'], ['shs', 'SHS']];

const watsanRows = (loc) => [
  ['Functional toilet bowls, male', `${loc}_func_toilet_male`, ES_JHS_SHS],
  ['Functional toilet bowls, female', `${loc}_func_toilet_female`, ES_JHS_SHS],
  ['Functional toilet bowls, PWD', `${loc}_func_toilet_pwd`, ES_JHS_SHS],
  ['Functional toilet bowls, shared', `${loc}_func_toilet_shared`, ES_JHS_SHS],
  ['Non-functional toilet bowls', `${loc}_nonfunc_toilet`, ES_SS],
  ['Sinks / washbasins', `${loc}_sink`, ES_SS],
  ['Urinals', `${loc}_urinal`, ES_SS],
  ['Urinal troughs', `${loc}_urinal_trough`, ES_SS],
  ['With septic tank', `${loc}_septic_tank`, ES_SS],
  ['Faucets with water supply', `${loc}_faucet_with_water`, ES_SS],
  ['Faucets without water supply', `${loc}_faucet_without_water`, ES_SS],
];

const SECTIONS = [
  { table: 'CLS', title: 'Enrollment and rooms by usage', groups: [
    { rows: [
      ['Enrollment', 'enrollment', [...ES_JHS_SHS, ['k12', 'K to 12']]],
      ['Instructional rooms', 'instructional_rooms', ES_JHS_SHS],
      ['Non-instructional rooms', 'noninstructional_rooms', ES_JHS_SHS],
    ] },
  ] },
  { table: 'T3', title: 'Table 3 · Temporary learning spaces and makeshift rooms', groups: [
    { rows: [
      ['Temporary learning spaces', 'tls_count', ES_SS],
      ['Classes/sections using them', 'tls_classes', ES_SS],
      ['Makeshift rooms', 'makeshift_count', ES_SS],
      ['Classes/sections using them', 'makeshift_classes', ES_SS],
    ] },
  ] },
  { table: 'T4', title: 'Table 4a/4b · Water and sanitation (DepEd managed)', groups: [
    { name: 'Attached to a building', rows: watsanRows('attached') },
    { name: 'Stand-alone', rows: watsanRows('standalone') },
  ] },
  { table: 'T5', title: 'Table 5 · Usable furniture', groups: [
    { rows: [
      ['Kinder modular tables', 'num_kinder_modtable', null],
      ['Kinder chairs', 'num_kinder_chair', null],
      ['Armchairs', 'num_armchair', ES_JHS_SHS],
      ['School desks', 'num_schooldesk', ES_JHS_SHS],
      ['Other classroom tables', 'num_otherclasstable', ES_JHS_SHS],
      ['Other classroom chairs', 'num_otherclasschair', ES_JHS_SHS],
      ['1-seater table and chair (new in SY 2025-2026)', 'num_oneseater', ES_JHS_SHS],
      ['New design 2-seater table and chair', 'num_newtnc', [['elem', 'ES'], ['jhs', 'JHS'], ['shs', 'SHS']]],
      ['Total seats (computed in the NSBI)', 'total_seat', ES_JHS_SHS, true],
    ] },
  ] },
  { table: 'T6', title: 'Table 6 · Other facilities and amenities (present in campus)', yesNo: true, groups: [
    { rows: [
      ['Covered court', 'covered_court'], ['Gymnasium', 'gymnasium'], ['Solar panel', 'solar_panel'],
      ['Permanent perimeter fence', 'permanent_fence'], ['Temporary perimeter fence', 'temporary_fence'],
      ['Flood marker', 'flood_marker'], ['Playground', 'playground'], ['School garden', 'school_garden'],
      ['Entrance gate', 'entrance_gate'], ['Exit gate', 'exit_gate'], ['Bike racks', 'bike_racks'],
      ['Paved pathway from entrance gate to building', 'paved_pathway'], ['Pathway cover / roofing', 'pathway_cover'],
    ] },
  ] },
  { table: 'T7', title: 'Table 7 · Access going to school', yesNo: true, groups: [
    { name: 'Type of access road', rows: [
      ['Paved', 'is_road_paved', ES_SS], ['Unpaved', 'is_road_unpaved', ES_SS],
      ['Levelled', 'is_road_levelled', ES_SS], ['Unlevelled / rough road', 'is_road_unlevelled', ES_SS],
      ['On-going construction', 'is_road_ongoing_construction', ES_SS],
    ] },
    { name: 'Accessible by', rows: [
      ['Private 4-wheel vehicle', 'is_trans_prvtfourwheel', ES_SS], ['Private motorcycle', 'is_trans_prvtmotorcycle', ES_SS],
      ['Boat', 'is_trans_boat', ES_SS], ['UV Express', 'is_trans_uvexpress', ES_SS], ['Pedicab', 'is_trans_pedicab', ES_SS],
      ['Tricycle', 'is_trans_tricycle', ES_SS], ['Jeepney', 'is_trans_jeepney', ES_SS], ['Habal-habal', 'is_trans_habal', ES_SS],
      ['Train', 'is_trans_train', ES_SS], ['Bus', 'is_trans_bus', ES_SS], ['Biking', 'is_trans_bike', ES_SS],
      ['Walking / hiking', 'is_trans_walkhike', ES_SS],
    ] },
  ] },
];

const keysOf = (s) => s.groups.flatMap((g) => g.rows.filter((r) => !r[3])
  .flatMap(([, key, levels]) => (levels ? levels.map(([lv]) => `${key}_${lv}`) : [key])));

function show(v, yesNo) {
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (yesNo) return Number(v) === 1 ? 'Yes' : Number(v) === 0 ? 'No' : String(v);
  return typeof v === 'number' ? n(v) : String(v);
}

// One cell: the SY 2025-2026 value (validated, or the form's input) with the earlier NSBI value under it.
function Cell({ k, s, entered, ref0, form, setForm, label }) {
  return (
    <td className="num" data-label={label}>
      {form ? (
        s.yesNo ? (
          <select value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-label={`${label} ${k}`}>
            <option value="">—</option><option value="1">Yes</option><option value="0">No</option>
          </select>
        ) : (
          <input inputMode="numeric" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value.replace(/[^0-9]/g, '') })}
            aria-label={`${label} ${k}`} style={{ width: 80, textAlign: 'right' }} />
        )
      ) : show(entered?.[k], s.yesNo)}
      {ref0 && ref0[k] !== undefined && ref0[k] !== null && <div className="small muted">was {show(ref0[k], s.yesNo)}</div>}
    </td>
  );
}

function Section({ s, refRec, st, db, schoolId, canEdit, isSchool, isSDO, onSaved }) {
  const [form, setForm] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const editable = s.table !== 'CLS';
  const entered = editable ? st?.validated : refRec?.measures;
  const ref0 = editable ? refRec?.measures : null;
  const pending = st?.school_update;

  function startEdit(from) {
    const src = from ?? st?.validated ?? {};
    setForm(Object.fromEntries(keysOf(s).map((k) => [k, src[k] === null || src[k] === undefined ? '' : String(src[k])])));
    setRemarks(''); setErr(null);
  }
  async function save() {
    setBusy(true);
    const measures = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : Number(v)]));
    const { error } = await db.rpc('record_school_table', { p_cycle: CYCLE, p_school: schoolId, p_table: s.table,
      p_seen: st?.last_step_id ?? null, p_measures: measures, p_remarks: remarks || null });
    setBusy(false);
    if (error) setErr(problem(error)); else { setForm(null); onSaved(isSchool ? 'Update sent to the Division Engineer.' : `${s.title.split(' · ')[0]} saved.`); }
  }

  const chip = !editable ? <span className="muted small">NSBI {refRec.cycle_label}, for reference</span>
    : pending ? <span className="chip amber">{isSchool ? 'Your update, waiting for the SDO' : 'Update from the school'}</span>
      : st?.validated ? <span className="chip green">Filled in</span> : <span className="chip gray">Blank</span>;

  return (
    <details className="card other" open={!!form || undefined}>
      <summary><h3>{s.title}</h3>{chip}</summary>
      {editable && (
        <p className="small muted" style={{ margin: 0 }}>
          SY 2025–2026{refRec ? `; "was" is the NSBI ${refRec.cycle_label} value, for reference only` : ''}.
          {st?.validated_remarks && <> Remarks: {st.validated_remarks}</>}
        </p>
      )}
      {s.groups.map((g, gi) => (
        <div key={gi} className="stack">
          {g.name && <h4>{g.name}</h4>}
          <table className="cards">
            <tbody>
              {g.rows.filter((r) => !(form && r[3])).map(([label, key, levels]) => (
                <tr key={key + label}>
                  <td>{label}</td>
                  {levels
                    ? levels.map(([lv, name]) => <Cell key={lv} k={`${key}_${lv}`} s={s} entered={entered} ref0={ref0} form={form} setForm={setForm} label={name} />)
                    : <Cell k={key} s={s} entered={entered} ref0={ref0} form={form} setForm={setForm} label={s.yesNo ? 'Present' : 'All levels'} />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {pending && !form && (
        <div className="notice warn small">
          {isSchool ? 'You sent an update; the Division Engineer will review it.' : 'The school sent an update to this table.'}
          {st.school_update_remarks && <> Remarks: {st.school_update_remarks}</>}
          {isSDO && <div className="btns"><button type="button" className="btn sm" onClick={() => startEdit(pending)}>Review the school's update</button></div>}
        </div>
      )}
      {editable && canEdit && !form && (
        <div className="btns"><button type="button" className="btn sm secondary" onClick={() => startEdit()}>{st?.validated ? 'Update' : 'Fill in'}</button></div>
      )}
      {form && (
        <div className="stack">
          <label className="f">Remarks (optional)<textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
          {err && <ErrorNote error={err} />}
          <div className="btns">
            <button type="button" className="btn sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : isSchool ? 'Send to the SDO' : 'Save'}</button>
            <button type="button" className="btn sm secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
    </details>
  );
}

export default function OtherNsbiData({ db, schoolId, canEdit, isSchool, isSDO, onSaved }) {
  const [recs, setRecs] = useState(null);
  const [status, setStatus] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      db.from('school_other_data').select('*').eq('school_id', schoolId),
      db.from('school_table_status').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId),
    ]).then(([o, t]) => {
      if (o.error || t.error) { setError(o.error || t.error); return; }
      setRecs(Object.fromEntries(o.data.map((r) => [r.co_table, r])));
      setStatus(Object.fromEntries(t.data.map((r) => [r.co_table, r])));
    });
  }, [db, schoolId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!recs) return null;
  const shown = SECTIONS.filter((s) => s.table !== 'CLS' || recs.CLS);
  return (
    <section className="stack" style={{ gap: 12 }}>
      <h2>Other tables of the SY 2025–2026 template</h2>
      <p className="muted small" style={{ margin: 0 }}>
        The NSBI has no SY 2025–2026 data yet for Tables 3 to 7, so each starts blank. The SDO fills in what it has;
        a school's entry waits for the SDO. Where the NSBI has an earlier school year, its value is shown under each item for
        reference only and is not copied in.
      </p>
      {shown.map((s) => (
        <Section key={s.table} s={s} refRec={recs[s.table]} st={status[s.table]} db={db} schoolId={schoolId}
          canEdit={canEdit} isSchool={isSchool} isSDO={isSDO} onSaved={(m) => { load(); onSaved?.(m); }} />
      ))}
    </section>
  );
}
