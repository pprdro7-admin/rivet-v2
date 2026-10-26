import React, { useCallback, useEffect, useState } from 'react';
import { ErrorNote, Loading, StatusChip } from '../components/ui.jsx';
import { CYCLE, SOURCE, n, pct, problem, STATUS } from '../lib/labels.js';
import OtherNsbiData from '../components/OtherNsbiData.jsx';
import { CoNotes, SendBack, loadSendBack } from '../components/Returns.jsx';
import Relocation from '../components/Relocation.jsx';

// One school: every building with its rooms, the SDO's step on each, the school's updates waiting for
// the SDO, new records, the DPO's check.
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
      eqs('school_updates'),
      eqs('school_relocation').maybeSingle(),
    ]);
    const bad = res.find((r) => r.error);
    if (bad) { setError(bad.error); return; }
    const [tally, buildings, rooms, newBuildings, newRooms, openItems, updates, relocation] = res.map((r) => r.data);
    const [bf, rf, sendBack] = await Promise.all([
      db.from('building_flag_text').select('*').in('building_id', buildings.map((b) => b.building_id)),
      db.from('room_flag_text').select('*').in('room_id', rooms.map((r) => r.room_id)),
      loadSendBack(db, schoolId),
    ]);
    const flagsOf = (rows, key) => Object.fromEntries((rows.data || []).map((x) => [x[key], x.flags]));
    setData({ tally, buildings, rooms, newBuildings, newRooms, openItems, sendBack, relocation,
      updates: Object.fromEntries(updates.map((u) => [`${u.kind === 'building' ? 'b' : 'r'}:${u.record_id}`, u])),
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
  if (!data.tally) return <main className="page"><ErrorNote error="This school is not in your SDO, or not in the NSBI 2025–2026 data." /></main>;

  const t = data.tally;
  // Pilot: the DE and the DPO both record steps; a school account updates its own records.
  const isSDO = ['de', 'dpo'].includes(me.role) && me.sdo_code === t.sdo_code;
  const isSchool = me.role === 'school';
  const canEdit = isSDO || isSchool;
  const isDPO = me.role === 'dpo' && me.sdo_code === t.sdo_code;
  const done = (msg) => { setNote({ ok: msg }); setOpen(null); load(); };
  const fail = (e) => { setNote({ err: problem(e) }); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  async function markRestCorrect() {
    const bs = data.buildings.filter((b) => !b.status && !data.bflags[b.building_id] && !data.updates[`b:${b.building_id}`]);
    // A room takes a status only once its building has one (given before, or in this same pass).
    const given = new Set([...data.buildings.filter((b) => b.status), ...bs].map((b) => b.building_id));
    const rs = data.rooms.filter((r) => !r.status && !data.rflags[r.room_id] && !r.building_for_deletion && !data.updates[`r:${r.room_id}`]
      && given.has(r.building_id));
    if (!window.confirm(`Mark ${bs.length} building(s) and ${rs.length} room(s) that have no status and no flag as Correct as is?`)) return;
    let count = 0;
    for (const b of bs) {
      const { error: e } = await db.rpc('record_building_validation', { p_building: b.building_id, p_seen: b.last_step_id, p_status: 'correct' });
      if (e) { fail(`Building ${b.building_code}: ${problem(e)}`); load(); return; }
      count += 1;
    }
    for (const r of rs) {
      const { error: e } = await db.rpc('record_room_validation', { p_room: r.room_id, p_seen: r.last_step_id, p_status: 'correct' });
      if (e) { fail(`Room ${r.room_code ?? r.room_no}: ${problem(e)}`); load(); return; }
      count += 1;
    }
    done(`${count} record(s) marked Correct as is.`);
  }

  return (
    <main className="page">
      {!isSchool && <a href={`#/sdo/${t.sdo_code}`} className="small">← Validation</a>}
      <div className="spread">
        <div><h1>{t.school_name}</h1><span className="mono muted">{t.school_id} · {t.district}</span><div className="small muted">{SOURCE}, with the SDO's validation</div></div>
        {t.dpo_complete ? <span className="chip green">Complete</span>
          : t.dpo_result === 'returned' ? <span className="chip amber">Returned to DE</span> : null}
      </div>

      <div className="today-top">
        <div className="tile"><strong>{pct(t.share_validated)}</strong><span className="muted">validated ({n(t.buildings_with_status + t.rooms_with_status)} of {n(t.co_buildings + t.co_rooms)})</span></div>
        <div className="tile"><strong>{t.co_buildings} → {t.buildings_after}</strong><span className="muted">buildings, NSBI → validated</span></div>
        <div className="tile"><strong>{t.co_rooms} → {t.rooms_after}</strong><span className="muted">rooms, NSBI → validated</span></div>
        <div className="tile"><strong>{t.co_instructional_rooms} → {t.instructional_rooms_after}</strong><span className="muted">instructional rooms</span></div>
      </div>

      {t.dpo_result === 'returned' && !t.dpo_complete && <div className="notice warn"><b>Returned by the DPO:</b> {t.dpo_remarks}</div>}
      {note?.ok && <div className="notice ok">{note.ok}</div>}
      {note?.err && <ErrorNote error={note.err} />}

      <Relocation db={db} schoolId={schoolId} relocation={data.relocation} isSDO={isSDO} onDone={(m) => { setNote({ ok: m }); load(); }} />

      <SendBack db={db} schoolId={schoolId} sendBack={data.sendBack} buildings={data.buildings} rooms={data.rooms}
        isSDO={isSDO} isSchool={isSchool} onDone={(m) => { setNote({ ok: m }); load(); }} />

      {isSchool && (
        <div className="notice info">Check each building and room against the school as of 31 May 2026. Where something is wrong or missing, update it here: your update goes to the Division Engineer, who validates it.</div>
      )}
      {isSDO && (
        <div className="btns">
          <button type="button" className="btn secondary" onClick={markRestCorrect}>Mark unflagged records without a status as Correct as is</button>
        </div>
      )}

      {data.buildings.map((b) => {
        const rooms = data.rooms.filter((r) => r.building_id === b.building_id);
        const newRooms = data.newRooms.filter((r) => r.building_id === b.building_id);
        const bldgLocked = locks(lists.bcond, b.final_condition);
        return (
          <section key={b.building_id} className={`card${b.status === 'for_deletion' ? ' flagged' : ''}`}>
            <div className="bldg-head">
              <h2>Building {b.building_no} <span className="mono muted">{b.building_code}</span></h2>
              <StatusChip status={b.status} />
            </div>
            <div className="facts">
              <span>{b.building_type}</span>
              <span>Condition: <b>{b.final_condition}</b>{b.final_condition !== b.building_condition && <span className="co"> (NSBI: {b.building_condition ?? 'blank'})</span>}</span>
              <span>Tally: <b style={{ color: b.tally_check.startsWith('Changed') ? 'var(--red)' : undefined }}>{b.tally_check}</b></span>
              {b.final_longitude !== b.longitude && <span>Coordinates corrected: {b.final_longitude}, {b.final_latitude}</span>}
            </div>
            {data.bflags[b.building_id] && <div className="flags">{data.bflags[b.building_id]}</div>}
            {data.sendBack.notes[`building:${b.building_id}`] && <div className="note-row small"><b>Sent back:</b> {data.sendBack.notes[`building:${b.building_id}`]}</div>}
            {b.remarks && <div className="small"><b>Remarks:</b> {b.remarks}</div>}
            <SchoolUpdate u={data.updates[`b:${b.building_id}`]} rec={b} rooms={rooms} kind="building" isSchool={isSchool} canAccept={isSDO} db={db} lists={lists} onDone={done} onFail={fail} />
            {canEdit && open !== `b:${b.building_id}` && (
              <div className="btns"><button type="button" className="btn sm secondary" onClick={() => setOpen(`b:${b.building_id}`)}>{isSchool ? 'Update' : b.status ? 'Change status' : 'Give status'}</button>
                {!isSchool && !b.status && rooms.length > 0 && <span className="small muted">Give the building a status first, then its rooms.</span>}</div>
            )}
            {open === `b:${b.building_id}` && (
              <StepForm kind="building" rec={b} rooms={rooms} lists={lists} db={db} isSchool={isSchool} onDone={done} onFail={fail} onCancel={() => setOpen(null)} />
            )}

            <div className="scroll">
              <table className="cards">
                <thead><tr><th>Room</th><th>Condition</th><th>Usage</th><th>Actual usage</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rooms.map((r) => (
                    <React.Fragment key={r.room_id}>
                      <tr className={r.needs_room_decision ? 'red' : ''}>
                        <td>{r.room_no}<div className="mono muted">{r.room_code ?? 'no code'}</div></td>
                        <td data-label="Condition">{r.final_condition ?? '—'}{r.final_condition !== r.room_condition && <div className="co small">NSBI: {r.room_condition ?? 'blank'}</div>}</td>
                        <td data-label="Usage">{r.final_usage ?? '—'}{r.final_usage !== r.room_usage && <div className="co small">NSBI: {r.room_usage ?? 'blank'}</div>}</td>
                        <td data-label="Actual usage">{(r.final_actual_usages || []).join(', ')}
                          {r.usage_locked && <div className="small muted">Usage locked</div>}
                          {data.rflags[r.room_id] && <div className="flags">{data.rflags[r.room_id]}</div>}
                          {data.sendBack.notes[`room:${r.room_id}`] && <div className="note-row small"><b>Sent back:</b> {data.sendBack.notes[`room:${r.room_id}`]}</div>}
                          {r.needs_room_decision && <div className="small" style={{ color: 'var(--red)' }}>The building is for deletion: decide this room too.</div>}
                          {r.remarks && <div className="small"><b>Remarks:</b> {r.remarks}</div>}
                          <SchoolUpdate u={data.updates[`r:${r.room_id}`]} rec={r} kind="room" isSchool={isSchool} canAccept={isSDO} db={db} lists={lists} onDone={done} onFail={fail} />
                        </td>
                        <td data-label="Status"><StatusChip status={r.status} /></td>
                        <td>{canEdit && open !== `r:${r.room_id}` && (isSchool || b.status
                          ? <button type="button" className="btn sm secondary" onClick={() => setOpen(`r:${r.room_id}`)}>{isSchool ? 'Update' : r.status ? 'Change' : 'Status'}</button>
                          : <span className="small muted">Building first</span>)}</td>
                      </tr>
                      {open === `r:${r.room_id}` && (
                        <tr><td colSpan={6}><StepForm kind="room" rec={r} bldgLocked={bldgLocked} lists={lists} db={db} isSchool={isSchool} onDone={done} onFail={fail} onCancel={() => setOpen(null)} /></td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  {newRooms.map((r) => <NewRoomRow key={`n${r.id}`} r={r} />)}
                </tbody>
              </table>
            </div>
            {canEdit && <NewRoomForm db={db} lists={lists} building={b.building_id} bldgLocked={bldgLocked} onDone={done} onFail={fail} />}
          </section>
        );
      })}

      {data.newBuildings.map((nb) => (
        <section key={`nb${nb.id}`} className="card">
          <div className="bldg-head"><h2>New building {nb.building_no}</h2><span className="chip blue">{nb.by_school ? 'Added by the school' : 'Not in the NSBI'}</span></div>
          <div className="facts"><span>{nb.building_type}</span><span>Condition: <b>{nb.building_condition}</b></span></div>
          <div className="small"><b>Remarks:</b> {nb.remarks}</div>
          <table className="cards"><tbody>{data.newRooms.filter((r) => r.new_building_id === nb.id).map((r) => <NewRoomRow key={`n${r.id}`} r={r} />)}</tbody></table>
          {canEdit && <NewRoomForm db={db} lists={lists} newBuilding={nb.id} bldgLocked={locks(lists.bcond, nb.building_condition)} onDone={done} onFail={fail} />}
        </section>
      ))}

      {canEdit && <NewBuildingForm db={db} lists={lists} schoolId={schoolId} onDone={done} onFail={fail} />}
      <OtherNsbiData db={db} schoolId={schoolId} canEdit={canEdit} isSchool={isSchool} isSDO={isSDO} onSaved={(m) => setNote({ ok: m })} />
      <CoNotes db={db} me={me} schoolId={schoolId} schoolSdo={t.sdo_code} />
      {(isDPO || me.role === 'ro' || me.role === 'co') && <DpoCheck db={db} schoolId={schoolId} openItems={data.openItems} canAct={isDPO} onDone={done} onFail={fail} />}
    </main>
  );
}

function NewRoomRow({ r }) {
  return (
    <tr>
      <td>{r.room_no ?? 'new'}<div className="muted small">new room</div></td>
      <td data-label="Condition">{r.room_condition}</td><td data-label="Usage">{r.room_usage}</td>
      <td data-label="Actual usage">{r.actual_usages.join(', ')}<div className="small"><b>Remarks:</b> {r.remarks}</div></td>
      <td data-label="Status"><span className="chip blue">{r.by_school ? 'Added by the school' : 'Not in the NSBI'}</span></td><td />
    </tr>
  );
}

// A room that cannot be used (condemned, under construction, or in such a building) takes no usage entries.
const locks = (list, name) => !!list.find((c) => c.name === name)?.locks_usage;
const LOCK_NOTE = 'Usage is locked: the room or its building is condemned or under construction, so no usage is entered.';

// Deleting a building takes its rooms with it: the person confirms, seeing what goes.
function confirmDeletion(b, rooms = []) {
  const list = rooms.map((r) => `  Room ${r.room_no} (${r.room_code ?? 'no code'}), ${r.final_usage ?? 'usage blank'}`).join('\n');
  return window.confirm(`Delete Building ${b.building_no} (${b.building_code}) from the validated record?\n\n`
    + (rooms.length ? `Each of its ${rooms.length} room(s) then needs its own decision before the school can be complete:\n${list}\n\n` : 'It has no rooms listed.\n\n')
    + 'The NSBI data is kept and the deletion can be changed until the RO signs off the SDO.');
}

// What the database would refuse, said before Save so the button never seems to do nothing.
// Mirrors record_building_validation and record_room_validation; the database still has the last word.
function whyNot(kind, rec, status, f, locked, lists) {
  const B = (t) => <b>{t}</b>;
  if (kind === 'building') {
    if (status === 'correct' && !rec.building_condition) {
      return <>The NSBI left this building's condition blank, so it cannot be {B('Correct as is')}. Choose {B('With correction')} and give the condition.</>;
    }
    if (status === 'for_deletion' && rec.building_condition === 'Demolished') {
      return <>A Demolished building is kept, not deleted: its condition already records it. Choose {B('Correct as is')}.</>;
    }
    if (status === 'corrected') {
      if (!f.condition && !f.lon && !f.lat) return <>Give the corrected condition or coordinates, or choose {B('Correct as is')}.</>;
      if (!f.lon !== !f.lat) return <>Give both the correct longitude and latitude.</>;
    }
    return null;
  }
  const usage = status === 'corrected' && !locked && f.usage ? f.usage : rec.room_usage;
  const actual = status === 'corrected' && !locked && f.actual.length ? f.actual : (rec.actual_usages || []);
  if (status === 'correct') {
    if (!rec.room_condition) return <>The NSBI left this room's condition blank, so it cannot be {B('Correct as is')}. Choose {B('With correction')} and give the condition.</>;
    if (!locked && (!rec.room_usage || actual.length === 0)) {
      return <>The NSBI left the room usage or actual usage blank, so it cannot be {B('Correct as is')}. Choose {B('With correction')} and give them.</>;
    }
  }
  if (status === 'corrected' && !f.condition && (locked || (!f.usage && f.actual.length === 0))) {
    return <>Give the corrected value, or choose {B('Correct as is')}.</>;
  }
  if (status !== 'for_deletion' && !locked && usage === 'Instructional' && actual.includes('Not Currently Used')) {
    return status === 'correct'
      ? <>This room cannot be {B('Correct as is')}: the NSBI lists it as Instructional but Not Currently Used. Choose {B('With correction')} and set the room usage to Non-Instructional, or give the room's real current use.</>
      : <>A room not currently used is Non-Instructional: set the room usage to Non-Instructional, or give its real current use.</>;
  }
  return null;
}

// The step on one building or room. Corrections are written beside the NSBI value.
function StepForm({ kind, rec, rooms, bldgLocked, lists, db, isSchool, onDone, onFail, onCancel }) {
  const [status, setStatus] = useState(rec.status ?? 'correct');
  const [f, setF] = useState({ condition: '', usage: '', actual: [], lon: '', lat: '', reason: '', remarks: '' });
  const locked = kind === 'room' && (bldgLocked
    || locks(lists.rcond, status === 'corrected' && f.condition ? f.condition : rec.room_condition));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const block = whyNot(kind, rec, status, f, locked, lists);
  const nsbiCondition = kind === 'building' ? rec.building_condition : rec.room_condition;
  const needsRemarks = status === 'corrected'
    || (status === 'for_deletion' && lists.reasons.find((r) => r.code === f.reason)?.needs_remarks);

  async function save(e) {
    e.preventDefault();
    if (kind === 'building' && status === 'for_deletion' && !isSchool && !confirmDeletion(rec, rooms)) return;
    setBusy(true);
    setErr(null);
    const corr = status === 'corrected';
    const common = { p_seen: rec.last_step_id, p_status: status,
      p_condition: corr && f.condition ? f.condition : null,
      p_reason: status === 'for_deletion' && f.reason ? f.reason : null, p_remarks: f.remarks || null };
    const { error } = kind === 'building'
      ? await db.rpc('record_building_validation', { ...common, p_building: rec.building_id,
        p_longitude: corr && f.lon ? Number(f.lon) : null, p_latitude: corr && f.lat ? Number(f.lat) : null })
      : await db.rpc('record_room_validation', { ...common, p_room: rec.room_id,
        p_usage: corr && !locked && f.usage ? f.usage : null, p_actual_usages: corr && !locked && f.actual.length ? f.actual : null });
    setBusy(false);
    if (error) setErr(problem(error)); else onDone(isSchool ? 'Update sent to the Division Engineer.' : `${kind === 'building' ? 'Building' : 'Room'} saved.`);
  }

  return (
    <form className="step" onSubmit={save}>
      <fieldset className="choices">
        <legend>{isSchool ? 'Your update' : 'Validation status'}</legend>
        {[['correct', 'Correct as is'], ['corrected', 'With correction'], ['for_deletion', 'For deletion']].map(([v, label]) => (
          <label key={v}><input type="radio" name="status" checked={status === v} onChange={() => setStatus(v)} />{label}</label>
        ))}
      </fieldset>
      {status === 'corrected' && (
        <div className="grid">
          <label className="f">Validated condition (only if different)
            <select value={f.condition} onChange={set('condition')}>
              <option value="">Same as NSBI</option>
              {(kind === 'building' ? lists.bcond : lists.rcond).filter((c) => c.name !== nsbiCondition).map((c) => <option key={c.name}>{c.name}</option>)}
            </select>
          </label>
          {kind === 'building' ? (
            <>
              <label className="f">Correct longitude (only if wrong)<input inputMode="decimal" value={f.lon} onChange={set('lon')} placeholder="e.g. 123.9567" /></label>
              <label className="f">Correct latitude (only if wrong)<input inputMode="decimal" value={f.lat} onChange={set('lat')} placeholder="e.g. 9.6129" /></label>
            </>
          ) : locked ? (
            <p className="small muted">{LOCK_NOTE}</p>
          ) : (
            <>
              <label className="f">Validated room usage (only if different)
                <select value={f.usage} onChange={set('usage')}>
                  <option value="">Same as NSBI</option>
                  {lists.usage.filter((u) => u.name !== rec.room_usage).map((u) => <option key={u.name}>{u.name}</option>)}
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
      {block && <div className="notice warn small"><span>{block}</span></div>}
      {status !== 'correct' && (
        <label className="f">Remarks{needsRemarks ? ' (required)' : ''}<textarea rows={2} required={!!needsRemarks} value={f.remarks} onChange={set('remarks')} /></label>
      )}
      <div className="btns">
        <button type="submit" className="btn sm" disabled={busy || !!block}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn sm secondary" onClick={onCancel}>Cancel</button>
      </div>
      {err && <ErrorNote error={err} />}
    </form>
  );
}

function NewRoomForm({ db, lists, building, newBuilding, bldgLocked, onDone, onFail }) {
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ no: '', condition: '', usage: '', actual: [], remarks: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const locked = bldgLocked || locks(lists.rcond, f.condition);
  if (!show) return <div className="btns"><button type="button" className="btn sm secondary" onClick={() => setShow(true)}>Add a room not in the NSBI</button></div>;
  async function save(e) {
    e.preventDefault();
    const { error } = await db.rpc('add_new_room', { p_building: building ?? null, p_new_building: newBuilding ?? null,
      p_condition: f.condition, p_usage: locked ? null : f.usage, p_actual_usages: locked ? null : f.actual, p_remarks: f.remarks, p_room_no: f.no ? Number(f.no) : null });
    if (error) onFail(error); else { setShow(false); onDone('New room added.'); }
  }
  return (
    <form className="step" onSubmit={save}>
      <h3>New room (the room code stays blank until assigned in the NSBI)</h3>
      <div className="grid">
        <label className="f">Room no.<input inputMode="numeric" value={f.no} onChange={set('no')} /></label>
        <label className="f">Condition<select required value={f.condition} onChange={set('condition')}><option value="">Choose…</option>{lists.rcond.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
        {locked ? <p className="small muted">{LOCK_NOTE}</p> : <>
        <label className="f">Room usage<select required value={f.usage} onChange={set('usage')}><option value="">Choose…</option>{lists.usage.map((u) => <option key={u.name}>{u.name}</option>)}</select></label>
        <label className="f">Actual usage (Ctrl-click for several)
          <select multiple required size={5} value={f.actual} style={{ height: 'auto', padding: 6 }} onChange={(e) => setF({ ...f, actual: [...e.target.selectedOptions].map((o) => o.value) })}>
            {lists.actual.map((u) => <option key={u.name}>{u.name}</option>)}
          </select>
        </label>
        </>}
      </div>
      {!locked && f.usage === 'Instructional' && f.actual.includes('Not Currently Used') && (
        <div className="notice warn small"><span>A room not currently used is Non-Instructional: change the room usage, or give its real current use.</span></div>
      )}
      <label className="f">Remarks: why it is not in the NSBI<textarea rows={2} required value={f.remarks} onChange={set('remarks')} /></label>
      <div className="btns"><button type="submit" className="btn sm" disabled={!locked && f.usage === 'Instructional' && f.actual.includes('Not Currently Used')}>Add room</button><button type="button" className="btn sm secondary" onClick={() => setShow(false)}>Cancel</button></div>
    </form>
  );
}

function NewBuildingForm({ db, lists, schoolId, onDone, onFail }) {
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ no: '', type: '', condition: '', storeys: '', year: '', remarks: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!show) return <div className="btns"><button type="button" className="btn secondary" onClick={() => setShow(true)}>Add a building not in the NSBI</button></div>;
  async function save(e) {
    e.preventDefault();
    const { error } = await db.rpc('add_new_building', { p_cycle: CYCLE, p_school: schoolId, p_building_no: Number(f.no),
      p_condition: f.condition, p_remarks: f.remarks, p_type: f.type || null, p_storeys: f.storeys ? Number(f.storeys) : null, p_year: f.year || null });
    if (error) onFail(error); else { setShow(false); onDone('New building added. Now add its rooms.'); }
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>New building (the building code stays blank until assigned in the NSBI)</h2>
      <div className="grid">
        <label className="f">Building no. on site<input required inputMode="numeric" value={f.no} onChange={set('no')} /></label>
        <label className="f">Building type<input value={f.type} onChange={set('type')} /></label>
        <label className="f">Condition<select required value={f.condition} onChange={set('condition')}><option value="">Choose…</option>{lists.bcond.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
        <label className="f">Storeys<input inputMode="numeric" value={f.storeys} onChange={set('storeys')} /></label>
        <label className="f">Year completed<input inputMode="numeric" value={f.year} onChange={set('year')} /></label>
      </div>
      <label className="f">Remarks: why it is not in the NSBI<textarea rows={2} required value={f.remarks} onChange={set('remarks')} /></label>
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

// A school's update waiting beside the record. The DE or DPO accepts it by recording the same step,
// or answers with their own step through the usual form.
function SchoolUpdate({ u, rec, rooms, kind, isSchool, canAccept, db, onDone, onFail }) {
  const [busy, setBusy] = useState(false);
  if (!u) return null;
  const parts = [
    u.validated_condition && `condition ${u.validated_condition}`,
    u.validated_usage && `usage ${u.validated_usage}`,
    u.validated_actual_usages?.length && `actual usage ${u.validated_actual_usages.join(', ')}`,
    u.correct_longitude != null && `coordinates ${u.correct_longitude}, ${u.correct_latitude}`,
    u.deletion_reason && `reason: ${u.deletion_reason}`,
  ].filter(Boolean);
  async function accept() {
    if (kind === 'building' && u.status === 'for_deletion' && !confirmDeletion(rec, rooms)) return;
    setBusy(true);
    const common = { p_seen: rec.last_step_id, p_status: u.status, p_condition: u.validated_condition,
      p_reason: u.deletion_reason, p_remarks: u.remarks };
    const { error } = kind === 'building'
      ? await db.rpc('record_building_validation', { ...common, p_building: rec.building_id,
        p_longitude: u.correct_longitude, p_latitude: u.correct_latitude })
      : await db.rpc('record_room_validation', { ...common, p_room: rec.room_id,
        p_usage: u.validated_usage, p_actual_usages: u.validated_actual_usages });
    setBusy(false);
    if (error) onFail(error); else onDone('School update accepted.');
  }
  return (
    <div className="notice info small">
      <b>{isSchool ? 'Your update, waiting for the Division Engineer:' : 'Update from the school:'}</b>{' '}
      {STATUS[u.status].label}{parts.length > 0 && ` · ${parts.join(' · ')}`}{u.remarks && ` · "${u.remarks}"`}
      {canAccept && (
        <div className="btns" style={{ marginTop: 8 }}>
          <button type="button" className="btn sm" disabled={busy} onClick={accept}>{busy ? 'Saving…' : 'Accept'}</button>
        </div>
      )}
    </div>
  );
}
