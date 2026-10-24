import React, { useEffect, useState } from 'react';
import { ErrorNote } from './ui.jsx';
import { n } from '../lib/labels.js';

// The rest of the NSBI for one school: CO's school-level tables, read-only, from the latest cycle
// that has each table (school_other_data). Keys are those written by scripts/load_co_school_tables.py.

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
      ['New design 2-seater table and chair', 'num_newtnc', [['elem', 'ES'], ['jhs', 'JHS'], ['shs', 'SHS']]],
      ['Total seats (CO computed)', 'total_seat', ES_JHS_SHS],
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

function show(v, yesNo) {
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (yesNo) return Number(v) === 1 ? 'Yes' : Number(v) === 0 ? 'No' : String(v);
  return typeof v === 'number' ? n(v) : String(v);
}

function Section({ s, rec }) {
  const m = rec.measures;
  return (
    <details className="card other">
      <summary><h3>{s.title}</h3><span className="muted small">CO {rec.cycle_label}</span></summary>
      {s.groups.map((g, gi) => (
        <div key={gi} className="stack">
          {g.name && <h4>{g.name}</h4>}
          <table className="cards">
            <tbody>
              {g.rows.map(([label, key, levels]) => (
                <tr key={key + label}>
                  <td>{label}</td>
                  {levels
                    ? levels.map(([lv, name]) => <td key={lv} className="num" data-label={name}>{show(m[`${key}_${lv}`], s.yesNo)}</td>)
                    : <td className="num" data-label="All levels">{show(m[key], s.yesNo)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}

export default function OtherNsbiData({ db, schoolId }) {
  const [recs, setRecs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    db.from('school_other_data').select('*').eq('school_id', schoolId).then(({ data, error: e }) => {
      if (e) setError(e); else setRecs(Object.fromEntries(data.map((r) => [r.co_table, r])));
    });
  }, [db, schoolId]);

  if (error) return <ErrorNote error={error} />;
  if (!recs) return null;
  const present = SECTIONS.filter((s) => recs[s.table]);
  return (
    <section className="stack" style={{ gap: 12 }}>
      <h2>Other NSBI data</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Exactly as CO released them, from the latest school year CO has released each table for. These are
        for reference and are not validated here; only buildings and rooms are. Table 6 (other facilities)
        has no regional data from CO yet.
      </p>
      {present.length === 0 && <div className="notice info">CO has not released these tables for this School ID.</div>}
      {present.map((s) => <Section key={s.table} s={s} rec={recs[s.table]} />)}
    </section>
  );
}
