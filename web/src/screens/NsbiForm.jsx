import React, { useEffect, useState } from 'react';
import { ErrorNote, Loading } from '../components/ui.jsx';
import { CYCLE } from '../lib/labels.js';
import { isLocal } from '../lib/supabase.js';

// The NSBI School Building Inventory Form (CO memo of 24 July 2026), pre-filled from the validated record.
// It opens only when the school is Complete and its SDO is signed off, so no unvalidated form is printed.
// Columns RIVET does not keep (floor number) stay blank for the school to write in.

const AS_OF = 'May 31, 2026';
const CO = (b, k) => (b.co?.[k] ?? '') === null ? '' : (b.co?.[k] ?? '');
const sumLv = (m, key, lvs = ['es', 'jhs', 'shs', 'ss', 'elem']) => {
  if (!m) return '';
  const vals = lvs.map((l) => m[`${key}_${l}`]).concat(m[key]).filter((v) => v !== undefined && v !== null && v !== '');
  return vals.length ? vals.reduce((a, v) => a + Number(v), 0) : '';
};
const peso = (v) => (v === '' || v == null || isNaN(Number(v)) ? (v ?? '') : Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const yes = (v) => (v === '' ? null : Number(v) > 0);

export default function NsbiForm({ db, me, schoolId, preview }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const q = (p) => p.then(({ data, error: e }) => { if (e) throw e; return data; });
      try {
        const [tally] = await q(db.from('school_tally').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId));
        if (!tally) throw new Error('This school is not in your SDO, or not in the NSBI 2025–2026 data.');
        const [sdo, signed, bs, cob, nbs, rs, cor, nrs, tables, wb] = await Promise.all([
          q(db.from('sdos').select('name').eq('code', tally.sdo_code)),
          q(db.from('sdo_signoffs').select('signed_at').eq('cycle_id', CYCLE).eq('sdo_code', tally.sdo_code)),
          q(db.from('building_status').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
          q(db.from('co_buildings').select('id, co_record').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
          q(db.from('live_new_buildings').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
          q(db.from('room_status').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
          q(db.from('co_rooms').select('id, width_m, length_m').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
          q(db.from('live_new_rooms').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
          q(db.from('school_table_status').select('co_table, validated').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
          q(db.from('building_watsan_status').select('building_no, validated').eq('cycle_id', CYCLE).eq('school_id', schoolId)),
        ]);
        const co = Object.fromEntries(cob.map((b) => [b.id, b.co_record]));
        const dims = Object.fromEntries(cor.map((r) => [r.id, r]));
        const roomsOf = (id) => rs.filter((r) => r.building_id === id && r.status !== 'for_deletion').length
          + nrs.filter((r) => r.building_id === id).length;
        const buildings = [
          ...bs.filter((b) => b.status !== 'for_deletion').map((b) => ({
            no: b.building_no, type: b.building_type, condition: b.final_condition, rooms: roomsOf(b.building_id),
            lon: b.final_longitude, lat: b.final_latitude, co: co[b.building_id] ?? {}, id: b.building_id })),
          ...nbs.map((b) => ({ no: b.building_no, type: b.building_type, condition: b.building_condition, isNew: true,
            rooms: nrs.filter((r) => r.new_building_id === b.id).length, storeys: b.storeys, year: b.year_completed, co: {}, nid: b.id })),
        ].sort((a, b) => (a.no ?? 999) - (b.no ?? 999));
        const noOf = Object.fromEntries(bs.map((b) => [b.building_id, b.building_no]));
        const newNo = Object.fromEntries(nbs.map((b) => [b.id, b.building_no]));
        const rooms = [
          ...rs.filter((r) => r.status !== 'for_deletion' && !r.building_for_deletion).map((r) => ({
            bno: noOf[r.building_id], no: r.room_no, condition: r.final_condition,
            usage: r.usage_locked ? '' : r.final_usage, actual: r.usage_locked ? [] : (r.final_actual_usages || []),
            w: dims[r.room_id]?.width_m, l: dims[r.room_id]?.length_m })),
          ...nrs.map((r) => ({ bno: r.building_id ? noOf[r.building_id] : newNo[r.new_building_id], no: r.room_no,
            condition: r.room_condition, usage: r.room_usage, actual: r.actual_usages || [], w: r.width_m, l: r.length_m })),
        ].sort((a, b) => (a.bno ?? 999) - (b.bno ?? 999) || (a.no ?? 999) - (b.no ?? 999));
        const t = Object.fromEntries(tables.map((x) => [x.co_table, x.validated]));
        const first = buildings.find((b) => b.lon != null) ?? {};
        setD({ watsan: wb.filter((w) => w.validated).sort((a, b) => a.building_no - b.building_no), tally, sdoName: sdo[0]?.name ?? tally.sdo_code, signed: signed.length > 0, buildings, rooms, t,
          lon: first.lon ?? '', lat: first.lat ?? '' });
      } catch (e) { setError(e); }
    })();
  }, [db, schoolId]);

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!d) return <main className="page"><Loading /></main>;

  const open = d.tally.dpo_complete && d.signed;
  if (!open && !(isLocal && preview)) {
    return (
      <main className="page">
        <h1>NSBI form · {d.tally.school_name}</h1>
        <div className="notice warn">Available once the school is marked Complete by the DPO and its SDO is signed off by the RO,
          so that only a validated record is printed.</div>
      </main>
    );
  }

  const head = (withCoords) => (
    <>
      <div className="nf-title"><b>Department of Education</b><b>School Building Inventory Form</b><b>(as of {AS_OF})</b></div>
      <table className="nf-id"><tbody>
        <tr><td><b>Region :</b> Region VII</td><td><b>School ID :</b> {d.tally.school_id}</td></tr>
        <tr><td><b>Division :</b> {d.sdoName}</td><td><b>School Name :</b> {d.tally.school_name}</td></tr>
        {withCoords && <tr><td><b>Longitude:</b> {d.lon}</td><td><b>Latitude:</b> {d.lat}</td></tr>}
      </tbody></table>
    </>
  );
  const sign = (supply) => (
    <div className="nf-sign">
      <div><span>Prepared &amp; Certified True and Correct by:</span><i />School Head</div>
      <div><span>Verified by:</span><i />Planning Officer III<br />(Schools Division Office)</div>
      {supply && <div><span>Verified by:</span><i />Supply Officer<br />(Schools Division Office)</div>}
      <div><span>Validated by:</span><i />Engineer III<br />(Schools Division Office)</div>
    </div>
  );
  const mark = <div className="nf-mark">Pre-filled from the RIVET validated record, DepEd RO7 · Printed {new Date().toLocaleDateString('en-PH')}</div>;
  const pad = (rows, min) => rows.concat(Array.from({ length: Math.max(0, min - rows.length) }, () => null));
  const T = d.t;
  const w4 = (loc) => [
    sumLv(T.T4, `${loc}_func_toilet_male`), sumLv(T.T4, `${loc}_func_toilet_female`), sumLv(T.T4, `${loc}_func_toilet_pwd`),
    sumLv(T.T4, `${loc}_func_toilet_shared`), sumLv(T.T4, `${loc}_nonfunc_toilet`), sumLv(T.T4, `${loc}_sink`),
    sumLv(T.T4, `${loc}_urinal`), sumLv(T.T4, `${loc}_urinal_trough`),
    T.T4 ? (yes(sumLv(T.T4, `${loc}_septic_tank`)) === null ? '' : yes(sumLv(T.T4, `${loc}_septic_tank`)) ? 'Yes' : 'No') : '',
    sumLv(T.T4, `${loc}_faucet_with_water`), sumLv(T.T4, `${loc}_faucet_without_water`)];
  const yn = (v) => (v === '' || v === undefined || v === null ? <><span className="nf-o" /> Yes <span className="nf-o" /> No</>
    : yes(v) ? <><span className="nf-o on" /> Yes <span className="nf-o" /> No</> : <><span className="nf-o" /> Yes <span className="nf-o on" /> No</>);
  const box = (v) => <span className={`nf-box${yes(v) ? ' on' : ''}`} />;
  const T6 = [['Covered Court', 'covered_court'], ['Gymnasium', 'gymnasium'], ['Solar Panel', 'solar_panel'],
    ['Permanent Perimeter Fence', 'permanent_fence'], ['Temporary Perimeter Fence', 'temporary_fence'], ['Flood Marker', 'flood_marker'],
    ['Playground', 'playground'], ['School Garden', 'school_garden'], ['Entrance Gate', 'entrance_gate'], ['Exit Gate', 'exit_gate'],
    ['Bike Racks', 'bike_racks'], ['Paved Pathway from Entrance Gate to Building', 'paved_pathway'], ['Pathway Cover/Roofing', 'pathway_cover']];
  const t6 = (k) => (T.T6 ? T.T6[k] ?? '' : '');
  const t7 = (k) => sumLv(T.T7, k);

  return (
    <main className="nf">
      <div className="nf-bar noprint">
        <a href={`#/school/${schoolId}`} className="small">← School page</a>
        {!open && <span className="chip amber">Local preview: the school or its SDO is not yet signed off</span>}
        <button type="button" className="btn" onClick={() => window.print()}>Print or save as PDF</button>
      </div>

      <section className="nf-page">
        {head(true)}
        <h3>Table 1. Summary of Existing Building</h3>
        <table className="nf-t t1"><thead>
          <tr>{['Building Name/ Number', 'Building Type', 'Fund Source/s', 'Specific Fund Source/s', 'Building Condition', 'Number of Storeys',
            'Number of Rooms', 'Year Completed', 'Classification of Building', 'Is building PWD accessible?', 'Have undergone major repair for the last 5 years? (Yes/No)',
            'With Certificate of Acceptance? (Yes/No)', 'Is the school building included in the DepEd Book of Accounts? (Yes/No)', 'Building Materials',
            'Date of Acquisition', 'Acquisition Cost', 'Book Value', 'Insurance Information'].map((h) => <th key={h}>{h}</th>)}</tr>
          <tr className="col">{Array.from({ length: 18 }, (_, i) => <td key={i}>Col. {i + 1}</td>)}</tr>
        </thead><tbody>
          {pad(d.buildings, 6).map((b, i) => (b ? (
            <tr key={i}>
              <td className="c">{b.no}{b.isNew && <sup>new</sup>}</td><td>{b.type}</td><td>{CO(b, 'Fund Source')}</td><td>{CO(b, 'Specific Fund Source')}</td>
              <td>{b.condition}</td><td className="c">{b.storeys ?? CO(b, 'Number of Storeys')}</td><td className="c">{b.rooms}</td>
              <td className="c">{b.year ?? CO(b, 'Year Completed/ Implemented')}</td><td>{CO(b, 'Classification of Building')}</td>
              <td className="c">{CO(b, 'Is building PWD accessible? (Yes/No)')}</td><td className="c">{CO(b, 'Have undergone major repair for the last 5 years? (Yes/No)')}</td>
              <td className="c">{CO(b, 'With Certificate of Acceptance? (Yes/No)')}</td><td className="c">{CO(b, 'Is the school building included in the DepEd Book of Accounts? (Yes/No)')}</td>
              <td>{CO(b, 'Building Material')}</td><td>{CO(b, 'Date of Acquisition')}</td><td className="r">{peso(CO(b, 'Acquisition Cost'))}</td>
              <td className="r">{peso(CO(b, 'Book Value'))}</td><td>{CO(b, 'Insurance Information')}</td>
            </tr>) : <tr key={i} className="blank">{Array.from({ length: 18 }, (_, j) => <td key={j} />)}</tr>))}
        </tbody></table>
        {sign(true)}{mark}
      </section>

      <section className="nf-page">
        {head(false)}
        <h3>Table 2. Existing Rooms per Building</h3>
        <table className="nf-t t2"><thead>
          <tr><th rowSpan={2}>Building Number</th><th rowSpan={2}>Floor Number</th><th rowSpan={2}>Room Number</th><th rowSpan={2}>Room Condition</th>
            <th rowSpan={2}>Room Usage</th><th rowSpan={2}>Actual Usage/s</th><th colSpan={2}>Room Dimension (in Meters)</th></tr>
          <tr><th>Width</th><th>Length</th></tr>
          <tr className="col">{Array.from({ length: 8 }, (_, i) => <td key={i}>Col. {i + 1}</td>)}</tr>
        </thead><tbody>
          {pad(d.rooms, 8).map((r, i) => (r ? (
            <tr key={i}><td className="c">{r.bno}</td><td /><td className="c">{r.no}</td><td>{r.condition}</td><td>{r.usage}</td>
              <td>{r.actual.join(', ')}</td><td className="c">{r.w ?? ''}</td><td className="c">{r.l ?? ''}</td></tr>
          ) : <tr key={i} className="blank">{Array.from({ length: 8 }, (_, j) => <td key={j} />)}</tr>))}
        </tbody></table>
        {sign(false)}{mark}
      </section>

      <section className="nf-page">
        {head(false)}
        <h3>Table 3. Number of Temporary Learning Space/s (TLS) &amp; Makeshift Room/s</h3>
        <table className="nf-t t3"><thead>
          <tr><th colSpan={2}>Temporary Learning Space/s</th><th colSpan={2}>Makeshift Room/s</th></tr>
          <tr><th>No. of Temporary Learning Space/s</th><th>No. of Classes/Sections using Temporary Learning Space/s</th>
            <th>No. of Makeshift Room/s</th><th>No. of Classes/Sections using Makeshift Room/s</th></tr>
          <tr className="col">{[1, 2, 3, 4].map((i) => <td key={i}>Col. {i}</td>)}</tr>
        </thead><tbody><tr>
          {['tls_count', 'tls_classes', 'makeshift_count', 'makeshift_classes'].map((k) => <td key={k} className="c">{sumLv(T.T3, k)}</td>)}
        </tr></tbody></table>

        <h3>Table 4A. Existing Number of Water and Sanitation Facilities</h3>
        <table className="nf-t t4"><thead>
          <tr><th rowSpan={2}>Building Number</th><th colSpan={4}>Number of Functional Toilet Bowls</th><th rowSpan={2}>Number of Non-Functional Toilet Bowls</th>
            <th rowSpan={2}>Number of Sink/ Washbasin</th><th rowSpan={2}>Number of Urinals</th><th rowSpan={2}>Number of Urinal Trough</th>
            <th rowSpan={2}>With Septic Tank (Yes/No)</th><th colSpan={2}>Number of Faucets</th></tr>
          <tr><th>Male</th><th>Female</th><th>PWD</th><th>Shared</th><th>With Water Supply</th><th>Without Water Supply</th></tr>
          <tr className="col">{Array.from({ length: 12 }, (_, i) => <td key={i}>Col. {i + 1}</td>)}</tr>
        </thead><tbody>
          {pad(d.watsan, 4).map((w, i) => (w ? (
            <tr key={i}><td className="c">{w.building_no}</td>
              {['toilet_male', 'toilet_female', 'toilet_pwd', 'toilet_shared', 'nonfunc_toilet', 'sink', 'urinal', 'urinal_trough', 'septic_tank',
                'faucet_with_water', 'faucet_without_water'].map((k) => {
                const v = w.validated[k];
                return <td key={k} className="c">{v == null ? '' : k === 'septic_tank' ? (Number(v) === 1 ? 'Yes' : 'No') : v}</td>;
              })}</tr>
          ) : <tr key={i} className="blank">{Array.from({ length: 12 }, (_, j) => <td key={j} />)}</tr>))}
        </tbody></table>
        {sign(false)}{mark}
      </section>

      <section className="nf-page">
        {head(false)}
        <h3>Table 4B. Existing Number of Stand-Alone Water and Sanitation Facilities</h3>
        <table className="nf-t t4"><thead>
          <tr><th colSpan={4}>Number of Functional Toilet Bowls</th><th rowSpan={2}>Number of Non-Functional Toilet Bowls</th>
            <th rowSpan={2}>Number of Sink/ Washbasin</th><th rowSpan={2}>Number of Urinals</th><th rowSpan={2}>Number of Urinal Trough</th>
            <th rowSpan={2}>With Septic Tank (Yes/No)</th><th colSpan={2}>Number of Faucets</th></tr>
          <tr><th>Male</th><th>Female</th><th>PWD</th><th>Shared</th><th>With Water Supply</th><th>Without Water Supply</th></tr>
          <tr className="col">{Array.from({ length: 11 }, (_, i) => <td key={i}>Col. {i + 1}</td>)}</tr>
        </thead><tbody><tr>{w4('standalone').map((v, i) => <td key={i} className="c">{v}</td>)}</tr></tbody></table>

        <h3>Table 5. Existing Number of Usable Furniture</h3>
        <table className="nf-t t5"><thead>
          <tr><th rowSpan={2}>Kinder Modular Table</th><th rowSpan={2}>Kinder Chair</th><th rowSpan={2}>Armchair</th><th rowSpan={2}>School Desk</th>
            <th rowSpan={2}>Other Classroom Table</th><th rowSpan={2}>Other Classroom Chair</th><th colSpan={3}>1-Seater Table &amp; Chair</th><th colSpan={3}>2-Seater Table &amp; Chair</th></tr>
          <tr><th>Elementary</th><th>Junior High School</th><th>Senior High School</th><th>Elementary</th><th>Junior High School</th><th>Senior High School</th></tr>
          <tr className="col">{Array.from({ length: 12 }, (_, i) => <td key={i}>Col. {i + 1}</td>)}</tr>
        </thead><tbody><tr>
          {[sumLv(T.T5, 'num_kinder_modtable'), sumLv(T.T5, 'num_kinder_chair'), sumLv(T.T5, 'num_armchair'), sumLv(T.T5, 'num_schooldesk'),
            sumLv(T.T5, 'num_otherclasstable'), sumLv(T.T5, 'num_otherclasschair'),
            sumLv(T.T5, 'num_oneseater', ['es']), sumLv(T.T5, 'num_oneseater', ['jhs']), sumLv(T.T5, 'num_oneseater', ['shs']),
            sumLv(T.T5, 'num_newtnc', ['elem']), sumLv(T.T5, 'num_newtnc', ['jhs']), sumLv(T.T5, 'num_newtnc', ['shs'])]
            .map((v, i) => <td key={i} className="c">{v}</td>)}
        </tr></tbody></table>

        <h3>Table 6. Other Facilities/Amenities</h3>
        <table className="nf-t t6"><thead>
          <tr><th>Type of Facilities/Amenities</th><th>Present in Campus? (Yes/No)</th><th>Type of Facilities/Amenities</th><th>Present in Campus? (Yes/No)</th>
            <th>Type of Facilities/Amenities</th><th>Present in Campus? (Yes/No)</th></tr>
        </thead><tbody>
          {[0, 1, 2, 3, 4].map((i) => (
            <tr key={i}>{[T6[i], T6[i + 5], T6[i + 10]].map((f, j) => (f
              ? <React.Fragment key={j}><td><b>{f[0]}</b></td><td className="c">{yn(t6(f[1]))}</td></React.Fragment>
              : <td key={j} colSpan={2} className="nf-dark" />))}</tr>
          ))}
        </tbody></table>
        {sign(false)}{mark}
      </section>

      <section className="nf-page">
        {head(false)}
        <h3>Table 7. Access going to School <i>(Check all applicable)</i></h3>
        <table className="nf-t t7"><thead><tr><th>Type of Access Road</th><th colSpan={2}>Accessible by type of transportation</th></tr></thead>
          <tbody><tr>
            <td>{[['Paved', 'is_road_paved'], ['Unpaved', 'is_road_unpaved'], ['Levelled', 'is_road_levelled'], ['Unlevelled / Rough road', 'is_road_unlevelled'],
              ['On-going construction', 'is_road_ongoing_construction']].map(([l, k]) => <div key={k} className="nf-check">{box(t7(k))} {l}</div>)}</td>
            <td>{[['Private 4-Wheel Vehicle', 'is_trans_prvtfourwheel'], ['Private Motorcycle', 'is_trans_prvtmotorcycle'], ['Boat', 'is_trans_boat'],
              ['UV Express', 'is_trans_uvexpress'], ['Pedicab', 'is_trans_pedicab'], ['Tricycle', 'is_trans_tricycle']].map(([l, k]) => <div key={k} className="nf-check">{box(t7(k))} {l}</div>)}</td>
            <td>{[['Jeepney', 'is_trans_jeepney'], ['Habal-habal', 'is_trans_habal'], ['Train', 'is_trans_train'], ['Bus', 'is_trans_bus'],
              ['Biking', 'is_trans_bike'], ['Walking/Hiking', 'is_trans_walkhike']].map(([l, k]) => <div key={k} className="nf-check">{box(t7(k))} {l}</div>)}</td>
          </tr></tbody></table>
        {sign(false)}{mark}
      </section>
    </main>
  );
}
