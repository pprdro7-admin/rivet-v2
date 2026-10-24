import React, { useCallback, useEffect, useState } from 'react';
import { ErrorNote, Loading, StatusChip } from '../components/ui.jsx';
import { CYCLE, n, pct, problem } from '../lib/labels.js';

// One school: every building with its rooms, the DE's step on each, new records, the DPO's check.
export default function School({ db, me, schoolId }) {
  const [data, setData] = useState(null);
  const [lists, setLists] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [open, setOpen] = useState(null);   // 'b:<id>' or 'r:<id>': which record's step form is open

  const load = useCallback(async () => {
    const eqs = (t, sel = '*') => db.from(t).select(sel).eq('cycle_id', CYCLE).eq('school_id', schoolId);
    const res = await Promise.all([
      eqs('school_tally').maybeSingle(),
      eqs('building_status').order('building_no'),
      eqs('room_status').order('building_code').order('room_no'),
      eqs('live_new_buildings').order('id'),
      eqs('live_new_rooms').order('id'),
      db.rpc('school_open_items', { p_cycle: CYCLE, p_school: schoolId }),
    ]);
    const bad = res.find((r) => r.error);
    if (bad) { setError(bad.error); return; }
    const [tally, buildings, rooms, newBuildings, newRooms, openItems] = res.map((r) => r.data);
    const [bf, rf] = await Promise.all([
      db.from('building_flag_text').select('*').in('building_id', buildings.map((b) => b.building_id)),
      db.from('room_flag_text').select('*').in('room_id', rooms.map((r) => r.room_id)),
    ]);
    const flagsOf = (rows, key) => Object.fromEntries((rows.data || []).map((x) => [x[key], x.flags]));
    setData({ tally, buildings, rooms, newBuildings, newRooms, openItems,
      bflags: flagsOf(bf, 'building_id'), rflags: flagsOf(rf, 'room_id') });
  }, [db, schoolId]);

  useEffect(() => {
    load();
    Promise.all(['building_conditions', 'room_conditions', 'room_usages', 'actual_usages', 'deletion_reasons']
      .map((t) => db.from(t).select('*').order(t === 'actual_usages' ? 'name' : 'sort')))
      .then((r) => setLists({ bcond: r[0].data, rcond: r[1].data, usage: r[2].data, actual: r[3].data, reasons: r[4].data }));
  }, [db, load]);

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!data || !lists) return <main className="page"><Loading /></main>;
  if (!data.tally) return <main className="page"><ErrorNote error="This school is not in your SDO, or not in the SY 2025–2026 CO file." /></main>;

  const t = data.tally;
  const isDE = me.role === 'de' && me.sdo_code === t.sdo_code;
  const isDPO = me.role === 'dpo' && me.sdo_code === t.sdo_code;
  const done = (msg) => { setNote({ ok: msg }); setOpen(null); load(); };
  const fail = (e) => setNote({ err: problem(e) });

  async function markRestCorrect() {
    const bs = data.buildings.filter((b) => !b.status && !data.bflags[b.building_id]);
    const rs = data.rooms.filter((r) => !r.status && !data.rflags[r.room_id] && !r.building_for_deletion);
    if (!window.confirm(`Mark ${bs.length} building(s) and ${rs.length} room(s) that have no status and no flag as Correct as is?`)) return;
    let count = 0;
    for (const b of bs) {
      const { error: e } = await db.rpc('record_building_validation', { p_building: b.building_id, p_seen: b.last_validation_id, p_status: 'correct' });
      if (e) { fail(`Building ${b.building_code}: ${problem(e)}`); load(); return; }
      count += 1;
    }
    for (const r of rs) {
      const { error: e } = await db.rpc('record_room_validation', { p_room: r.room_id, p_seen: r.last_validation_id, p_status: 'correct' });
      if (e) { fail(`Room ${r.room_code ?? r.room_no}: ${problem(e)}`); load(); return; }
      count += 1;
    }
    done(`${count} record(s) marked Correct as is.`);
  }

  return (
    <main className="page">
      <a href={`#/sdo/${t.sdo_code}`} className="small">← School Tally</a>
      <div className="spread">
        <div><h1>{t.school_name}</h1><span className="mono muted">{t.school_id} · {t.district}</span></div>
        {t.dpo_complete ? <span className="chip green">Complete</span>
          : t.dpo_result === 'returned' ? <span className="chip amber">Returned to DE</span> : null}
      </div>

      <div className="today-top">
        <div className="tile"><strong>{pct(t.share_validated)}</strong><span className="muted">validated ({n(t.buildings_with_status + t.rooms_with_status)} of {n(t.co_buildings + t.co_rooms)})</span></div>
        <div className="tile"><strong>{t.co_buildings} → {t.buildings_after}</strong><span className="muted">buildings, CO → after validation</span></div>
        <div className="tile"><strong>{t.co_rooms} → {t.rooms_after}</strong><span className="muted">rooms, CO → after validation</span></div>
        <div className="tile"><strong>{t.co_instructional_rooms} → {t.instructional_rooms_after}</strong><span className="muted">instructional rooms</span></div>
      </div>

      {t.dpo_result === 'returned' && !t.dpo_complete && <div className="notice warn"><b>Returned by the DPO:</b> {t.dpo_remarks}</div>}
      {note?.ok && <div className="notice ok">{note.ok}</div>}
      {note?.err && <ErrorNote error={note.err} />}

      {isDE && (
        <div className="btns">
          <button type="button" className="btn secondary" onClick={markRestCorrect}>Mark unflagged records without a status as Correct as is</button>
        </div>
      )}

      {data.buildings.map((b) => {
        const rooms = data.rooms.filter((r) => r.building_id === b.building_id);
        const newRooms = data.newRooms.filter((r) => r.building_id === b.building_id);
        return (
          <section key={b.building_id} className={`card${b.status === 'for_deletion' ? ' flagged' : ''}`}>
            <div className="bldg-head">
              <h2>Building {b.building_no} <span className="mono muted">{b.building_code}</span></h2>
              <StatusChip status={b.status} />
            </div>
            <div className="facts">
              <span>{b.building_type}</span>
              <span>Condition: <b>{b.final_condition}</b>{b.final_condition !== b.building_condition && <span className="co"> (CO: {b.building_condition ?? 'blank'})</span>}</span>
              <span>Tally: <b style={{ color: b.tally_check.startsWith('Changed') ? 'var(--red)' : undefined }}>{b.tally_check}</b></span>
              {b.final_longitude !== b.longitude && <span>Coordinates corrected: {b.final_longitude}, {b.final_latitude}</span>}
            </div>
            {data.bflags[b.building_id] && <div className="flags">{data.bflags[b.building_id]}</div>}
            {b.remarks && <div className="small"><b>Remarks:</b> {b.remarks}</div>}
            {isDE && open !== `b:${b.building_id}` && (
              <div className="btns"><button type="button" className="btn sm secondary" onClick={() => setOpen(`b:${b.building_id}`)}>{b.status ? 'Change status' : 'Give status'}</button></div>
            )}
            {open === `b:${b.building_id}` && (
              <StepForm kind="building" rec={b} lists={lists} db={db} onDone={done} onFail={fail} onCancel={() => setOpen(null)} />
            )}

            <div className="scroll">
              <table className="cards">
                <thead><tr><th>Room</th><th>Condition</th><th>Usage</th><th>Actual usage</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rooms.map((r) => (
                    <React.Fragment key={r.room_id}>
                      <tr className={r.needs_room_decision ? 'red' : ''}>
                        <td>{r.room_no}<div className="mono muted">{r.room_code ?? 'no code'}</div></td>
                        <td data-label="Condition">{r.final_condition ?? '—'}{r.final_condition !== r.room_condition && <div className="co small">CO: {r.room_condition ?? 'blank'}</div>}</td>
                        <td data-label="Usage">{r.final_usage ?? '—'}{r.final_usage !== r.room_usage && <div className="co small">CO: {r.room_usage ?? 'blank'}</div>}</td>
                        <td data-label="Actual usage">{(r.final_actual_usages || []).join(', ')}
                          {data.rflags[r.room_id] && <div className="flags">{data.rflags[r.room_id]}</div>}
                          {r.needs_room_decision && <div className="small" style={{ color: 'var(--red)' }}>The building is for deletion: decide this room too.</div>}
                          {r.remarks && <div className="small"><b>Remarks:</b> {r.remarks}</div>}
                        </td>
                        <td data-label="Status"><StatusChip status={r.status} /></td>
                        <td>{isDE && open !== `r:${r.room_id}` && <button type="button" className="btn sm secondary" onClick={() => setOpen(`r:${r.room_id}`)}>{r.status ? 'Change' : 'Status'}</button>}</td>
                      </tr>
                      {open === `r:${r.room_id}` && (
                        <tr><td colSpan={6}><StepForm kind="room" rec={r} lists={lists} db={db} onDone={done} onFail={fail} onCancel={() => setOpen(null)} /></td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  {newRooms.map((r) => <NewRoomRow key={`n${r.id}`} r={r} />)}
                </tbody>
              </table>
            </div>
            {isDE && <NewRoomForm db={db} lists={lists} building={b.building_id} onDone={done} onFail={fail} />}
          </section>
        );
      })}

      {data.newBuildings.map((nb) => (
        <section key={`nb${nb.id}`} className="card">
          <div className="bldg-head"><h2>New building {nb.building_no}</h2><span className="chip blue">Missing from CO file</span></div>
          <div className="facts"><span>{nb.building_type}</span><span>Condition: <b>{nb.building_condition}</b></span></div>
          <div className="small"><b>Remarks:</b> {nb.remarks}</div>
          <table className="cards"><tbody>{data.newRooms.filter((r) => r.new_building_id === nb.id).map((r) => <NewRoomRow key={`n${r.id}`} r={r} />)}</tbody></table>
          {isDE && <NewRoomForm db={db} lists={lists} newBuilding={nb.id} onDone={done} onFail={fail} />}
        </section>
      ))}

      {isDE && <NewBuildingForm db={db} lists={lists} schoolId={schoolId} onDone={done} onFail={fail} />}
      {(isDPO || me.role === 'ro') && <DpoCheck db={db} schoolId={schoolId} openItems={data.openItems} canAct={isDPO} onDone={done} onFail={fail} />}
    </main>
  );
}

function NewRoomRow({ r }) {
  return (
    <tr>
      <td>{r.room_no ?? 'new'}<div className="muted small">new room</div></td>
      <td data-label="Condition">{r.room_condition}</td><td data-label="Usage">{r.room_usage}</td>
      <td data-label="Actual usage">{r.actual_usages.join(', ')}<div className="small"><b>Remarks:</b> {r.remarks}</div></td>
      <td data-label="Status"><span className="chip blue">Missing from CO file</span></td><td />
    </tr>
  );
}

// The DE's step on one building or room. Corrections are written beside the CO value.
function StepForm({ kind, rec, lists, db, onDone, onFail, onCancel }) {
  const [status, setStatus] = useState(rec.status ?? 'correct');
  const [f, setF] = useState({ condition: '', usage: '', actual: [], lon: '', lat: '', reason: '', remarks: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const corr = status === 'corrected';
    const common = { p_seen: rec.last_validation_id, p_status: status,
      p_condition: corr && f.condition ? f.condition : null,
      p_reason: status === 'for_deletion' && f.reason ? f.reason : null, p_remarks: f.remarks || null };
    const { error } = kind === 'building'
      ? await db.rpc('record_building_validation', { ...common, p_building: rec.building_id,
        p_longitude: corr && f.lon ? Number(f.lon) : null, p_latitude: corr && f.lat ? Number(f.lat) : null })
      : await db.rpc('record_room_validation', { ...common, p_room: rec.room_id,
        p_usage: corr && f.usage ? f.usage : null, p_actual_usages: corr && f.actual.length ? f.actual : null });
    setBusy(false);
    if (error) onFail(error); else onDone(`${kind === 'building' ? 'Building' : 'Room'} saved.`);
  }

  return (
    <form className="step" onSubmit={save}>
      <fieldset className="choices">
        <legend>Validation status</legend>
        {[['correct', 'Correct as is'], ['corrected', 'With correction'], ['for_deletion', 'For deletion']].map(([v, label]) => (
          <label key={v}><input type="radio" name="status" checked={status === v} onChange={() => setStatus(v)} />{label}</label>
        ))}
      </fieldset>
      {status === 'corrected' && (
        <div className="grid">
          <label className="f">Validated condition (only if different)
            <select value={f.condition} onChange={set('condition')}>
              <option value="">Same as CO</option>
              {(kind === 'building' ? lists.bcond : lists.rcond).map((c) => <option key={c.name}>{c.name}</option>)}
            </select>
          </label>
          {kind === 'building' ? (
            <>
              <label className="f">Correct longitude (only if wrong)<input inputMode="decimal" value={f.lon} onChange={set('lon')} placeholder="e.g. 123.9567" /></label>
              <label className="f">Correct latitude (only if wrong)<input inputMode="decimal" value={f.lat} onChange={set('lat')} placeholder="e.g. 9.6129" /></label>
            </>
          ) : (
            <>
              <label className="f">Validated room usage (only if different)
                <select value={f.usage} onChange={set('usage')}>
                  <option value="">Same as CO</option>
                  {lists.usage.map((u) => <option key={u.name}>{u.name}</option>)}
                </select>
              </label>
              <label className="f">Validated actual usage (only if different; Ctrl-click for several)
                <select multiple size={6} value={f.actual} style={{ height: 'auto', padding: 6 }}
                  onChange={(e) => setF({ ...f, actual: [...e.target.selectedOptions].map((o) => o.value) })}>
                  {lists.actual.map((u) => <option key={u.name}>{u.name}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
      )}
      {status === 'for_deletion' && (
        <label className="f">Reason for deletion
          <select value={f.reason} onChange={set('reason')} required>
            <option value="">Choose…</option>
            {lists.reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </label>
      )}
      {status !== 'correct' && (
        <label className="f">Remarks{status === 'corrected' ? ' (required)' : ''}<textarea rows={2} value={f.remarks} onChange={set('remarks')} /></label>
      )}
      <div className="btns">
        <button type="submit" className="btn sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn sm secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function NewRoomForm({ db, lists, building, newBuilding, onDone, onFail }) {
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ no: '', condition: '', usage: '', actual: [], remarks: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!show) return <div className="btns"><button type="button" className="btn sm secondary" onClick={() => setShow(true)}>Add a room missing from CO's file</button></div>;
  async function save(e) {
    e.preventDefault();
    const { error } = await db.rpc('add_new_room', { p_building: building ?? null, p_new_building: newBuilding ?? null,
      p_condition: f.condition, p_usage: f.usage, p_actual_usages: f.actual, p_remarks: f.remarks, p_room_no: f.no ? Number(f.no) : null });
    if (error) onFail(error); else { setShow(false); onDone('New room added.'); }
  }
  return (
    <form className="step" onSubmit={save}>
      <h3>New room (the code stays blank; CO assigns it)</h3>
      <div className="grid">
        <label className="f">Room no.<input inputMode="numeric" value={f.no} onChange={set('no')} /></label>
        <label className="f">Condition<select required value={f.condition} onChange={set('condition')}><option value="">Choose…</option>{lists.rcond.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
        <label className="f">Room usage<select required value={f.usage} onChange={set('usage')}><option value="">Choose…</option>{lists.usage.map((u) => <option key={u.name}>{u.name}</option>)}</select></label>
        <label className="f">Actual usage (Ctrl-click for several)
          <select multiple required size={5} value={f.actual} style={{ height: 'auto', padding: 6 }} onChange={(e) => setF({ ...f, actual: [...e.target.selectedOptions].map((o) => o.value) })}>
            {lists.actual.map((u) => <option key={u.name}>{u.name}</option>)}
          </select>
        </label>
      </div>
      <label className="f">Remarks: why it is missing from CO's file<textarea rows={2} required value={f.remarks} onChange={set('remarks')} /></label>
      <div className="btns"><button type="submit" className="btn sm">Add room</button><button type="button" className="btn sm secondary" onClick={() => setShow(false)}>Cancel</button></div>
    </form>
  );
}

function NewBuildingForm({ db, lists, schoolId, onDone, onFail }) {
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ no: '', type: '', condition: '', storeys: '', year: '', remarks: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!show) return <div className="btns"><button type="button" className="btn secondary" onClick={() => setShow(true)}>Add a building missing from CO's file</button></div>;
  async function save(e) {
    e.preventDefault();
    const { error } = await db.rpc('add_new_building', { p_cycle: CYCLE, p_school: schoolId, p_building_no: Number(f.no),
      p_condition: f.condition, p_remarks: f.remarks, p_type: f.type || null, p_storeys: f.storeys ? Number(f.storeys) : null, p_year: f.year || null });
    if (error) onFail(error); else { setShow(false); onDone('New building added. Now add its rooms.'); }
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>New building (the code stays blank; CO assigns it)</h2>
      <div className="grid">
        <label className="f">Building no. on site<input required inputMode="numeric" value={f.no} onChange={set('no')} /></label>
        <label className="f">Building type<input value={f.type} onChange={set('type')} /></label>
        <label className="f">Condition<select required value={f.condition} onChange={set('condition')}><option value="">Choose…</option>{lists.bcond.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
        <label className="f">Storeys<input inputMode="numeric" value={f.storeys} onChange={set('storeys')} /></label>
        <label className="f">Year completed<input inputMode="numeric" value={f.year} onChange={set('year')} /></label>
      </div>
      <label className="f">Remarks: why it is missing from CO's file<textarea rows={2} required value={f.remarks} onChange={set('remarks')} /></label>
      <div className="btns"><button type="submit" className="btn">Add building</button><button type="button" className="btn secondary" onClick={() => setShow(false)}>Cancel</button></div>
    </form>
  );
}

function DpoCheck({ db, schoolId, openItems, canAct, onDone, onFail }) {
  const [remarks, setRemarks] = useState('');
  const pending = (openItems || []).filter((o) => Number(o.n) > 0);
  async function check(result) {
    const { error } = await db.rpc('record_dpo_check', { p_cycle: CYCLE, p_school: schoolId, p_result: result, p_remarks: remarks || null });
    if (error) onFail(error); else { setRemarks(''); onDone(result === 'complete' ? 'School marked complete.' : 'Returned to the DE.'); }
  }
  return (
    <section className="card">
      <h2>DPO check</h2>
      {pending.length === 0
        ? <div className="notice ok">Every building and room has a status, and no room is left in a building for deletion.</div>
        : <div className="notice warn">{pending.map((o) => <span key={o.item}>{o.item}: {o.n}</span>)}</div>}
      {canAct && (
        <>
          <label className="f">DPO remarks (required when returning)<textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
          <div className="btns">
            <button type="button" className="btn go" disabled={pending.length > 0} onClick={() => check('complete')}>Complete</button>
            <button type="button" className="btn danger" onClick={() => check('returned')}>Return to DE</button>
          </div>
        </>
      )}
    </section>
  );
}
