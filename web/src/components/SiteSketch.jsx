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
  ['watsan', 'WATSAN', 70, 40], ['court', 'Covered court', 150, 100], ['grounds', 'Open grounds', 200, 120],
  ['gate', 'Gate', 60, 30], ['flagpole', 'Flagpole', 40, 40], ['other', 'Other', 80, 50],
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

export default function SiteSketch({ db, schoolId, data, canEdit, onOpen, onDone, onFail }) {
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
    if (kind === 'other') { name = window.prompt('What is it? (e.g. Canteen, Stage, Water tank)'); if (!name) return; }
    const next = Math.max(0, ...Object.keys(items).filter((k) => k.startsWith('m:')).map((k) => Number(k.slice(2)))) + 1;
    const ok = await put({ item_key: `m:${next}`, kind, label: name, site_no: site, x: 20, y: H - 30 - h, w, h });
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
      <div className="spread">
        <div className="seg" role="group" aria-label="Site">
          {sites.map((s) => (
            <button key={s.site_no} type="button" aria-pressed={site === s.site_no} className={site === s.site_no ? 'on' : ''}
              onClick={() => { setSite(s.site_no); setSel(null); }}>{s.site_no === 1 ? 'Main site' : `Adjacent site: ${s.name}`}</button>
          ))}
        </div>
        {canEdit && (
          <div className="btns">
            {unplaced.some((b) => b.cond !== 'Demolished') && <button type="button" className="btn sm secondary" disabled={busy} onClick={placeAll}>Place all unplaced buildings here</button>}
            <button type="button" className="btn sm secondary" onClick={addSite}>Add an adjacent site</button>
            {site !== 1 && <button type="button" className="btn sm secondary" onClick={removeSite}>Remove this site</button>}
          </div>
        )}
      </div>

      <div className="sketch">
        <div>
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="plan" role="img" aria-label={`Site sketch, ${siteName}`}
            tabIndex={canEdit ? 0 : -1} onKeyDown={nudge} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            onPointerDown={(e) => { if (e.target === svg.current || e.target.dataset.bg) setSel(null); }}>
            <defs><pattern id="sk-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 L0 0 0 20" fill="none" className="sk-gridline" /></pattern></defs>
            <rect width={W} height={H} fill="url(#sk-grid)" data-bg="1" />
            <rect x="8" y="8" width={W - 16} height={H - 16} className="sk-bound" data-bg="1" />
            <text x="18" y="26" className="sk-note">{siteName} boundary</text>
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
          </svg>
          <div className="legend small">
            <span><i className="c-good" />Good</span><span><i className="c-minor" />Minor repair</span><span><i className="c-major" />Major repair</span>
            <span><i className="c-bad" />Condemnation / construction</span><span><i className="c-gone" />Demolished</span>
            <span><i className="k-watsan" />WATSAN</span><span><i className="k-court" />Covered court</span><span><i className="k-grounds" />Grounds</span>
          </div>
        </div>

        <aside className="sk-side">
          {selItem ? (
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
              <div className="btns">{LANDMARKS.map(([k, l]) => <button key={k} type="button" className="btn sm secondary" onClick={() => addLandmark(k)}>{l}</button>)}</div>
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
