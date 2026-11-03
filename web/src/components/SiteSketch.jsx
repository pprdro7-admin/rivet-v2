import React, { useEffect, useRef, useState } from 'react';
import { CYCLE } from '../lib/labels.js';

// The school's site sketch (Ada: a plain sketch, not a satellite map). Every building box comes from
// Table 1 or a building added in RIVET, with its number and condition; only its place is new. An
// adjacent site under the same School ID is its own sketch. The DE or DPO drags the boxes; everyone
// who sees the school sees the sketch, and clicking a box opens that building's details.
const W = 800;
const H = 460;
const GRID = 10;
const LANDMARKS = [
  ['watsan', 'WATSAN', 70, 40], ['court', 'Covered court', 150, 100], ['gym', 'Gymnasium', 160, 100],
  ['grounds', 'Open grounds', 200, 120], ['playground', 'Playground', 110, 70], ['garden', 'Garden', 110, 70],
  ['guardhouse', 'Guardhouse', 100, 40], ['gate', 'Gate', 60, 30], ['flagpole', 'Flagpole', 40, 40],
  ['stage', 'Stage', 100, 50], ['canteen', 'Canteen', 90, 50], ['water_tank', 'Water tank', 50, 50],
  ['parking', 'Parking', 120, 60], ['pathway', 'Pathway / walk', 200, 30], ['other', 'Other', 80, 50],
];
const KIND_LABEL = Object.fromEntries(LANDMARKS.map(([k, l]) => [k, l]));

function tone(c) {
  if (c === 'Good Condition') return 'good';
  if (c === 'Needs Minor Repair') return 'minor';
  if (c === 'Needs Major Repair') return 'major';
  if (c === 'Demolished') return 'gone';
  if (!c) return 'none';
  return 'bad';
}
const snap = (v) => Math.round(v / GRID) * GRID;
const clampPt = ([x, y]) => [Math.max(0, Math.min(W, snap(x))), Math.max(0, Math.min(H, snap(y)))];
const RECT = [[10, 10], [W - 10, 10], [W - 10, H - 10], [10, H - 10]];
// Sides of a fence: side i runs from corner i to corner i + 1; the last closes the loop.
const sidesOf = (pts, closed = true) => pts.map((p, i) => [p, pts[(i + 1) % pts.length], i]).slice(0, closed ? pts.length : Math.max(0, pts.length - 1));

// The fence as drawn: solid where there is a fence, dashed where a side is open (no fence yet).
function Fence({ pts, open }) {
  return (
    <g className="sk-fenceg">
      <polygon points={pts.map((p) => p.join(',')).join(' ')} className="sk-fence-fill" data-bg="1" />
      {sidesOf(pts).map(([a, b, i]) => (
        <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={`sk-fence${open.includes(i) ? ' open' : ''}`} />
      ))}
    </g>
  );
}

// The school head may make the first placing; the Engineer checks it on site and confirms it
// (Ada, 2026-11-03). A school's change after the last confirmation shows as not yet confirmed.
export default function SiteSketch({ db, schoolId, data, canEdit, canConfirm, isSchool, onOpen, onDone, onFail }) {
  const [state, setState] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [fences, setFences] = useState({});
  const [lm, setLm] = useState('watsan');
  const [fe, setFe] = useState(null); // fence being drawn: { pts, open, closed }
  const fdrag = useRef(null);
  useEffect(() => {
    db.from('sketch_state').select('*').eq('cycle_id', CYCLE).eq('school_id', schoolId).maybeSingle()
      .then(({ data: st }) => setState(st ?? {}));
    db.from('site_fence_latest').select('site_no, points, open_sides').eq('cycle_id', CYCLE).eq('school_id', schoolId)
      .then(({ data: fs }) => setFences(Object.fromEntries((fs || []).map((f) => [f.site_no, f]))));
  }, [db, schoolId, data.sketch]);
  async function confirm() {
    setConfirming(true);
    const { error } = await db.rpc('confirm_sketch', { p_cycle: CYCLE, p_school: schoolId });
    setConfirming(false);
    if (error) { onFail(error); return; }
    onDone();
  }
  const buildings = [
    ...data.buildings.map((b) => ({ no: b.building_no, type: b.building_type, cond: b.final_condition, replaces: b.replaces_no })),
    ...data.newBuildings.map((b) => ({ no: b.building_no, type: b.building_type, cond: b.building_condition, replaces: b.replaces_no, isNew: true })),
  ].sort((a, b) => a.no - b.no);
  const sites = [{ site_no: 1, name: 'Main site' }, ...data.sites];
  const [site, setSite] = useState(1);
  const [items, setItems] = useState(() => Object.fromEntries(data.sketch.map((i) => [i.item_key, i])));
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const svg = useRef(null);
  const drag = useRef(null);
  const latest = useRef(items);
  latest.current = items;

  useEffect(() => { setItems(Object.fromEntries(data.sketch.map((i) => [i.item_key, i]))); }, [data.sketch]);
  useEffect(() => { if (!sites.find((s) => s.site_no === site)) setSite(1); }, [data.sites]); // eslint-disable-line react-hooks/exhaustive-deps

  const byNo = Object.fromEntries(buildings.map((b) => [b.no, b]));
  const here = Object.values(items).filter((i) => i.site_no === site);
  const unplaced = buildings.filter((b) => !items[`b:${b.no}`]);
  const selItem = sel ? items[sel] : null;

  async function put(i, extra = {}) {
    const it = { ...i, ...extra };
    setItems((m) => ({ ...m, [it.item_key]: it }));
    const { error } = await db.rpc('record_sketch_item', {
      p_cycle: CYCLE, p_school: schoolId, p_key: it.item_key, p_kind: it.kind, p_label: it.label ?? null,
      p_site_no: it.site_no, p_x: it.x, p_y: it.y, p_w: it.w, p_h: it.h, p_removed: !!it.removed,
    });
    if (error) { onFail(error); onDone(); return false; }
    return true;
  }

  function freeSpot(n) {
    const taken = here.length + n;
    return { x: 30 + (taken % 5) * 150, y: 40 + Math.floor(taken / 5) * 90 % (H - 120) };
  }

  async function place(b, n = 0) {
    const spot = freeSpot(n);
    const ok = await put({ item_key: `b:${b.no}`, kind: 'building', label: null, site_no: site, ...spot, w: 120, h: 60 });
    if (ok) setSel(`b:${b.no}`);
  }
  async function placeAll() {
    setBusy(true);
    const todo = unplaced.filter((b) => b.cond !== 'Demolished');
    for (let k = 0; k < todo.length; k += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await put({ item_key: `b:${todo[k].no}`, kind: 'building', label: null, site_no: site, ...freeSpot(k), w: 120, h: 60 }))) break;
    }
    setBusy(false);
    onDone();
  }
  async function addLandmark(kind) {
    const [, label, w, h] = LANDMARKS.find((l) => l[0] === kind);
    let name = label;
    if (kind === 'other') { name = window.prompt('What is it? (e.g. Clinic, Shed, Nursery)'); if (!name) return; }
    const next = Math.max(0, ...Object.keys(items).filter((k) => k.startsWith('m:')).map((k) => Number(k.slice(2)))) + 1;
    const n = here.filter((i) => i.kind !== 'building').length; // staggered, so a new landmark does not hide the last one
    const ok = await put({ item_key: `m:${next}`, kind, label: name, site_no: site, x: Math.min(W - w, 30 + (n % 6) * 90), y: Math.max(0, H - 30 - h - (n % 3) * 40), w, h });
    if (ok) setSel(`m:${next}`);
  }
  async function addSite() {
    const name = window.prompt('Name the adjacent site (e.g. "Across the road", "Annex lot")');
    if (!name) return;
    const no = Math.max(1, ...sites.map((s) => s.site_no)) + 1;
    const { error } = await db.rpc('record_school_site', { p_cycle: CYCLE, p_school: schoolId, p_site_no: no, p_name: name, p_removed: false });
    if (error) onFail(error); else { setSite(no); onDone(); }
  }
  async function removeSite() {
    if (!window.confirm('Remove this adjacent site from the sketch? It must have nothing on it.')) return;
    const { error } = await db.rpc('record_school_site', { p_cycle: CYCLE, p_school: schoolId, p_site_no: site, p_name: null, p_removed: true });
    if (error) onFail(error); else { setSite(1); onDone(); }
  }

  // The fence: the school (or the Engineer) traces the actual fence, corner by corner.
  const fence = fences[site];
  function startFence(from) {
    setSel(null);
    setFe(from === 'rect' ? { pts: RECT, open: [], closed: true }
      : from === 'edit' ? { pts: fence.points, open: fence.open_sides || [], closed: true }
        : { pts: [], open: [], closed: false });
  }
  async function saveFence(removed = false) {
    if (!removed && (!fe.closed || fe.pts.length < 3)) return;
    setBusy(true);
    const { error } = await db.rpc('record_site_fence', { p_cycle: CYCLE, p_school: schoolId, p_site_no: site,
      p_points: removed ? null : fe.pts, p_open_sides: removed ? [] : fe.open, p_removed: removed });
    setBusy(false);
    if (error) { onFail(error); return; }
    setFe(null); onDone();
  }
  function fenceDown(e) {
    if (!fe || fe.closed) return;
    const p = clampPt([toSketch(e).x, toSketch(e).y]);
    setFe((f) => ({ ...f, pts: [...f.pts, p] }));
  }
  function cornerDown(e, k) {
    e.stopPropagation();
    if (!fe.closed && k === 0 && fe.pts.length >= 3) { setFe({ ...fe, closed: true }); return; }
    fdrag.current = k;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function toggleSide(e, i) {
    e.stopPropagation();
    setFe({ ...fe, open: fe.open.includes(i) ? fe.open.filter((x) => x !== i) : [...fe.open, i].sort((a, b) => a - b) });
  }

  // Dragging: screen point to sketch units through the SVG's own transform.
  function toSketch(e) {
    const pt = svg.current.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.current.getScreenCTM().inverse());
  }
  function down(e, i) {
    setSel(i.item_key);
    if (!canEdit) return;
    const p = toSketch(e);
    drag.current = { key: i.item_key, dx: p.x - i.x, dy: p.y - i.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (fdrag.current != null) {
      const p = clampPt([toSketch(e).x, toSketch(e).y]);
      setFe((f) => ({ ...f, pts: f.pts.map((q, k) => (k === fdrag.current ? p : q)) }));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = toSketch(e);
    setItems((m) => {
      const i = m[d.key];
      const x = Math.max(0, Math.min(W - i.w, snap(p.x - d.dx)));
      const y = Math.max(0, Math.min(H - i.h, snap(p.y - d.dy)));
      if (x === i.x && y === i.y) return m;
      d.moved = true;
      return { ...m, [d.key]: { ...i, x, y } };
    });
  }
  async function up() {
    fdrag.current = null;
    const d = drag.current;
    drag.current = null;
    if (d?.moved) await put(latest.current[d.key]);
  }
  function resize(dw, dh) {
    const i = selItem;
    const w = Math.max(30, Math.min(W - i.x, i.w + dw));
    const h = Math.max(20, Math.min(H - i.y, i.h + dh));
    put(i, { w, h });
  }
  function nudge(e) {
    if (!canEdit || !selItem) return;
    const step = e.shiftKey ? 50 : GRID;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    put(selItem, { x: Math.max(0, Math.min(W - selItem.w, selItem.x + mv[0])), y: Math.max(0, Math.min(H - selItem.h, selItem.y + mv[1])) });
  }

  const siteName = sites.find((s) => s.site_no === site)?.name ?? 'Main site';
  return (
    <section className="card">
      {state && (state.waits_for_engineer ? (
        <div className="notice warn row">
          <span>{isSchool ? 'Your placing is sent. The Division Engineer checks it on site and confirms it.'
            : 'Placed or changed by the school, not yet confirmed by the Engineer.'}</span>
          {canConfirm && <button type="button" className="btn sm" disabled={confirming} onClick={confirm}>{confirming ? 'Confirming…' : 'Confirm the sketch'}</button>}
        </div>
      ) : state.confirmed_at ? (
        <div className="notice ok row">
          <span>Confirmed by {state.confirmed_by || 'the Engineer'} on {new Date(state.confirmed_at).toLocaleDateString()}.</span>
          {canConfirm && state.changed_at > state.confirmed_at && <button type="button" className="btn sm secondary" disabled={confirming} onClick={confirm}>Confirm again</button>}
        </div>
      ) : state.changed_at ? (
        <div className="notice info row">
          <span>Not yet confirmed by the Engineer.</span>
          {canConfirm && <button type="button" className="btn sm" disabled={confirming} onClick={confirm}>Confirm the sketch</button>}
        </div>
      ) : (
        <div className="notice info">{isSchool ? 'Nothing is placed yet. Place your buildings where they stand; the Division Engineer confirms the sketch after checking on site.'
          : 'Nothing is placed yet. The school head may make the first placing, or you can.'}</div>
      ))}
      <div className="spread">
        <div className="seg" role="group" aria-label="Site">
          {sites.map((s) => (
            <button key={s.site_no} type="button" aria-pressed={site === s.site_no} className={site === s.site_no ? 'on' : ''}
              onClick={() => { setSite(s.site_no); setSel(null); }}>{s.site_no === 1 ? 'Main site' : `Adjacent site: ${s.name}`}</button>
          ))}
        </div>
        {canEdit && !fe && (
          <div className="btns">
            {fence ? <button type="button" className="btn sm secondary" onClick={() => startFence('edit')}>Edit the fence</button>
              : <button type="button" className="btn sm secondary" onClick={() => startFence('trace')}>Draw the fence</button>}
            {unplaced.some((b) => b.cond !== 'Demolished') && <button type="button" className="btn sm secondary" disabled={busy} onClick={placeAll}>Place all unplaced buildings here</button>}
            <button type="button" className="btn sm secondary" onClick={addSite}>Add an adjacent site</button>
            {site !== 1 && <button type="button" className="btn sm secondary" onClick={removeSite}>Remove this site</button>}
          </div>
        )}
      </div>

      <div className="sketch">
        <div>
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className={`plan${fe ? ' fence-editing' : ''}`} role="img" aria-label={`Site sketch, ${siteName}`}
            tabIndex={canEdit ? 0 : -1} onKeyDown={nudge} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            onPointerDown={(e) => { if (fe) { fenceDown(e); return; } if (e.target === svg.current || e.target.dataset.bg) setSel(null); }}>
            <defs><pattern id="sk-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 L0 0 0 20" fill="none" className="sk-gridline" /></pattern></defs>
            <rect width={W} height={H} fill="url(#sk-grid)" data-bg="1" />
            {!fe && (fence ? <Fence pts={fence.points} open={fence.open_sides || []} />
              : <rect x="8" y="8" width={W - 16} height={H - 16} className="sk-bound" data-bg="1" />)}
            {!fe && <text x="18" y="26" className="sk-note">{fence ? `${siteName}: fence as drawn` : `${siteName} boundary (fence not drawn yet)`}</text>}
            {here.sort((a, b) => (a.kind === 'building') - (b.kind === 'building')).map((i) => {
              const b = i.kind === 'building' ? byNo[Number(i.item_key.slice(2))] : null;
              const cls = b ? `sk-b c-${tone(b.cond)}` : `sk-m k-${i.kind}`;
              const label = b ? `Bldg ${b.no}` : i.label || KIND_LABEL[i.kind];
              return (
                <g key={i.item_key} className={`sk-item${sel === i.item_key ? ' sel' : ''}${canEdit ? ' movable' : ''}`}
                  onPointerDown={(e) => down(e, i)} onDoubleClick={() => b && onOpen(b.no)}>
                  <title>{b ? `Building ${b.no}: ${b.type || 'type not given'}, ${b.cond || 'condition blank'}` : label}</title>
                  <rect x={i.x} y={i.y} width={i.w} height={i.h} rx="4" className={cls} />
                  <text x={i.x + i.w / 2} y={i.y + i.h / 2 + 5} textAnchor="middle" className={b ? 'sk-blabel' : 'sk-mlabel'}>{label}</text>
                  {b?.replaces != null && <text x={i.x + i.w / 2} y={i.y + i.h + 15} textAnchor="middle" className="sk-note">replaces Bldg {b.replaces}</text>}
                  {b?.cond === 'Demolished' && <text x={i.x + i.w / 2} y={i.y + i.h + 15} textAnchor="middle" className="sk-note">demolished</text>}
                </g>
              );
            })}
            {fe && (
              <g>
                {fe.closed && <polygon points={fe.pts.map((p) => p.join(',')).join(' ')} className="sk-fence-fill" />}
                {sidesOf(fe.pts, fe.closed).map(([a, b, i]) => (
                  <g key={i}>
                    <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={`sk-fence${fe.open.includes(i) ? ' open' : ''}`} />
                    {fe.closed && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="sk-side-hit" onPointerDown={(e) => toggleSide(e, i)}>
                      <title>{fe.open.includes(i) ? 'No fence on this side: click to mark it fenced' : 'Click to mark this side as having no fence yet'}</title></line>}
                  </g>
                ))}
                {fe.pts.map((p, k) => (
                  <circle key={k} cx={p[0]} cy={p[1]} r={k === 0 && !fe.closed && fe.pts.length >= 3 ? 9 : 7}
                    className={`sk-corner${k === 0 ? ' first' : ''}`} onPointerDown={(e) => cornerDown(e, k)} />
                ))}
              </g>
            )}
          </svg>
          <div className="legend small">
            <span><i className="c-good" />Good</span><span><i className="c-minor" />Minor repair</span><span><i className="c-major" />Major repair</span>
            <span><i className="c-bad" />Condemnation / construction</span><span><i className="c-gone" />Demolished</span>
            <span><i className="fence" />Fence</span><span><i className="fence open" />No fence yet</span>
            <span><i className="k-watsan" />WATSAN</span><span><i className="k-court" />Court / gym</span><span><i className="k-grounds" />Grounds / garden</span><span><i className="k-other" />Other landmarks</span>
          </div>
        </div>

        <aside className="sk-side">
          {fe ? (
            <div className="sk-sel">
              <h3>{fence ? 'Edit the fence' : 'Draw the fence'}</h3>
              <p className="small">{!fe.closed
                ? (fe.pts.length < 3 ? 'Click on the sketch at each corner of the fence, going around in order.'
                  : 'Keep clicking the corners. Click the first corner (the dark dot) to close the fence.')
                : 'Drag a corner to match the actual fence. Click a side to mark it as having no fence yet (dashed); click it again to mark it fenced.'}</p>
              <div className="btns">
                {!fe.closed && fe.pts.length > 0 && <button type="button" className="btn sm secondary" onClick={() => setFe({ ...fe, pts: fe.pts.slice(0, -1) })}>Undo last corner</button>}
                {!fe.closed && fe.pts.length === 0 && <button type="button" className="btn sm secondary" onClick={() => startFence('rect')}>Start from a rectangle</button>}
                {fe.closed && <button type="button" className="btn sm secondary" onClick={() => startFence('trace')}>Start over</button>}
              </div>
              <div className="btns">
                <button type="button" className="btn sm" disabled={busy || !fe.closed} onClick={() => saveFence(false)}>{isSchool ? 'Save and send to the Engineer' : 'Save the fence'}</button>
                <button type="button" className="btn sm secondary" onClick={() => setFe(null)}>Cancel</button>
                {fence && <button type="button" className="btn sm danger" disabled={busy} onClick={() => saveFence(true)}>Remove the fence</button>}
              </div>
            </div>
          ) : selItem ? (
            <SelPanel item={selItem} b={selItem.kind === 'building' ? byNo[Number(selItem.item_key.slice(2))] : null} sites={sites}
              canEdit={canEdit} onOpen={onOpen} onResize={resize}
              onMove={(s) => { put(selItem, { site_no: s }); setSel(null); }}
              onRemove={() => { put(selItem, { removed: true }).then(() => { setSel(null); onDone(); }); }} />
          ) : (
            <p className="small muted">{canEdit
              ? 'Drag each box to where it stands. Select a box to resize it, move it to another site, or open its details. Arrow keys move the selected box.'
              : 'Each box is a building from Tables 1 and 2. Select one to see it; double-click to open its details.'}</p>
          )}
          {canEdit && unplaced.length > 0 && (
            <>
              <h3>Not on the sketch yet ({unplaced.length})</h3>
              <ul className="tray">
                {unplaced.map((b, n) => (
                  <li key={b.no}><span><b>Bldg {b.no}</b> {b.type || ''}{b.cond === 'Demolished' ? ' (demolished)' : ''}</span>
                    <button type="button" className="btn sm secondary" onClick={() => place(b, n)}>Place</button></li>
                ))}
              </ul>
            </>
          )}
          {canEdit && (
            <>
              <h3>Add a landmark</h3>
              <div className="btns" style={{ flexWrap: 'nowrap' }}>
                <select aria-label="Landmark" value={lm} onChange={(e) => setLm(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                  {LANDMARKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button type="button" className="btn sm secondary" onClick={() => addLandmark(lm)}>Add</button>
              </div>
            </>
          )}
          <p className="small muted">Only the place of each box is new. Number, type and condition come from Tables 1 and 2 and change there.</p>
        </aside>
      </div>
    </section>
  );
}

function SelPanel({ item, b, sites, canEdit, onOpen, onResize, onMove, onRemove }) {
  return (
    <div className="sk-sel">
      {b ? (
        <>
          <h3>Building {b.no}</h3>
          <p className="small">{b.type || 'Type not given'}<br />{b.cond || 'Condition blank'}{b.isNew ? ' · not in the NSBI' : ''}
            {b.replaces != null && <><br />Replaces Building {b.replaces}</>}</p>
          <div className="btns"><button type="button" className="btn sm" onClick={() => onOpen(b.no)}>View details</button></div>
        </>
      ) : <h3>{item.label || KIND_LABEL[item.kind]}</h3>}
      {canEdit && (
        <>
          <div className="btns">
            <button type="button" className="btn sm secondary" onClick={() => onResize(20, 0)}>Wider</button>
            <button type="button" className="btn sm secondary" onClick={() => onResize(-20, 0)}>Narrower</button>
            <button type="button" className="btn sm secondary" onClick={() => onResize(0, 20)}>Taller</button>
            <button type="button" className="btn sm secondary" onClick={() => onResize(0, -20)}>Shorter</button>
          </div>
          {sites.length > 1 && (
            <label className="f">Stands on
              <select value={item.site_no} onChange={(e) => onMove(Number(e.target.value))}>
                {sites.map((s) => <option key={s.site_no} value={s.site_no}>{s.site_no === 1 ? 'Main site' : s.name}</option>)}
              </select>
            </label>
          )}
          <div className="btns"><button type="button" className="btn sm danger" onClick={onRemove}>{b ? 'Take off the sketch' : 'Remove'}</button></div>
        </>
      )}
    </div>
  );
}

// A small, read-only copy of the site sketch with one building highlighted, shown folded in that
// building's details in the Table 1 list, so whoever validates sees where it stands (Ada, 2026-11-03).
export function MiniSketch({ db, schoolId, data, no }) {
  const [fences, setFences] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || fences) return;
    db.from('site_fence_latest').select('site_no, points, open_sides').eq('cycle_id', CYCLE).eq('school_id', schoolId)
      .then(({ data: fs }) => setFences(Object.fromEntries((fs || []).map((f) => [f.site_no, f]))));
  }, [open, fences, db, schoolId]);
  const me = data.sketch.find((i) => i.item_key === `b:${no}`);
  const conds = Object.fromEntries([
    ...data.buildings.map((b) => [b.building_no, b.final_condition]),
    ...data.newBuildings.map((b) => [b.building_no, b.building_condition]),
  ]);
  const site = me?.site_no ?? 1;
  const siteName = site === 1 ? 'Main site' : `Adjacent site: ${data.sites.find((x) => x.site_no === site)?.name ?? ''}`;
  const fence = fences?.[site];
  return (
    <details className="mini-sketch" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="small">Where it stands on the site sketch{me ? ` (${siteName})` : ''}</summary>
      {!me ? <p className="small muted">Building {no} is not placed on the site sketch yet.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="plan mini" role="img" aria-label={`Building ${no} on the site sketch, ${siteName}`}>
          <rect width={W} height={H} fill="#fbfcfd" />
          {fence ? <Fence pts={fence.points} open={fence.open_sides || []} />
            : <rect x="8" y="8" width={W - 16} height={H - 16} className="sk-bound" />}
          {data.sketch.filter((i) => i.site_no === site).map((i) => {
            const bno = i.kind === 'building' ? Number(i.item_key.slice(2)) : null;
            const mine = bno === no;
            return (
              <g key={i.item_key} className={`sk-item${mine ? ' here' : ' dim'}`}>
                <rect x={i.x} y={i.y} width={i.w} height={i.h} rx="4" className={bno != null ? `sk-b c-${tone(conds[bno])}` : `sk-m k-${i.kind}`} />
                <text x={i.x + i.w / 2} y={i.y + i.h / 2 + 5} textAnchor="middle" className={bno != null ? 'sk-blabel' : 'sk-mlabel'}>
                  {bno != null ? `Bldg ${bno}` : i.label || KIND_LABEL[i.kind]}</text>
              </g>
            );
          })}
        </svg>
      )}
    </details>
  );
}
