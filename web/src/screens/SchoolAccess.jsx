import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorNote, Loading } from '../components/ui.jsx';
import { CYCLE, n, problem } from '../lib/labels.js';
import { fetchAll } from '../lib/fetchAll.js';

const when = (t) => (t ? new Date(t).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');

// A starting password the DPO reads out or hands over: 10 characters, letters and digits, no look-alikes.
function makePassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + letters.toUpperCase() + digits;
  const r = new Uint32Array(10);
  crypto.getRandomValues(r);
  const p = [...r].map((x) => all[x % all.length]);
  p[0] = letters[r[0] % letters.length];
  p[9] = digits[r[9] % digits.length];
  return p.join('');
}

// The DPO gives school heads (or their focal person) a RIVET account: one DepEd email per school
// account, a starting password given in person, no email sent. Reset and remove are kept on record.
export default function SchoolAccess({ db, me }) {
  const sdo = me.sdo_code;
  const [schools, setSchools] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);       // { ok, password?, email? } or { err }
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const [act, setAct] = useState(null);         // { kind: 'reset' | 'remove', row, value }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await db.rpc('school_access_list', { p_sdo: sdo });
    if (e) setError(e); else setList(data);
  }, [db, sdo]);

  useEffect(() => {
    load();
    fetchAll(() => db.from('cycle_schools').select('school_id, school_name, district').eq('cycle_id', CYCLE)
      .eq('sdo_code', sdo).order('school_name')).then(setSchools, setError);
  }, [db, sdo, load]);

  const active = useMemo(() => (list ?? []).filter((g) => !g.removed_at), [list]);
  const removed = useMemo(() => (list ?? []).filter((g) => g.removed_at), [list]);
  const covered = useMemo(() => new Set(active.map((g) => g.school_id)), [active]);
  const without = useMemo(() => (schools ?? []).filter((s) => !covered.has(s.school_id)), [schools, covered]);
  const shownWithout = useMemo(() => {
    const w = q.trim().toLowerCase();
    return without.filter((s) => !w || s.school_name.toLowerCase().includes(w) || s.school_id.includes(w)
      || (s.district || '').toLowerCase().includes(w));
  }, [without, q]);

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!list || !schools) return <main className="page"><Loading /></main>;

  const schoolOf = (id) => schools.find((s) => s.school_id === id);
  const startFor = (s) => { setNote(null); setForm({ school: s?.school_id ?? '', name: '', email: '', position: '', password: makePassword() }); window.scrollTo(0, 0); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await db.rpc('grant_school_access', { p_school: form.school, p_email: form.email,
      p_full_name: form.name, p_password: form.password, p_position: form.position || null });
    setBusy(false);
    if (err) { setNote({ err: problem(err) }); return; }
    setNote({ ok: `Account created for ${form.name}, ${schoolOf(form.school)?.school_name ?? form.school}.`, email: form.email.trim().toLowerCase(), password: form.password });
    setForm(null);
    load();
  }

  async function finish() {
    setBusy(true);
    const { row, kind, value } = act;
    const { error: err } = kind === 'reset'
      ? await db.rpc('reset_school_password', { p_grant: row.grant_id, p_password: value })
      : await db.rpc('remove_school_access', { p_grant: row.grant_id, p_reason: value });
    setBusy(false);
    if (err) { setNote({ err: problem(err) }); return; }
    setNote(kind === 'reset'
      ? { ok: `New password set for ${row.full_name}.`, email: row.email, password: value }
      : { ok: `School access removed for ${row.full_name}. Their sign-in no longer opens the school.` });
    setAct(null);
    load();
  }

  return (
    <main className="page">
      <div className="spread">
        <h1>School access</h1>
        <span className="muted">{n(covered.size)} of {n(schools.length)} schools have an account</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Create the account here and give the person their email and starting password yourself. No email is sent.
        They sign in on RIVET with these, see only their own school, and their updates wait for the Division Engineer.
      </p>

      {note?.ok && (
        <div className="notice ok stack">
          <span>{note.ok}</span>
          {note.password && (
            <span>Sign in with <b>{note.email}</b> and password <span className="secret">{note.password}</span>. Copy it now: it is not shown again.</span>
          )}
        </div>
      )}
      {note?.err && <ErrorNote error={note.err} />}

      {form ? (
        <form className="card" onSubmit={create}>
          <h2>New school account</h2>
          <div className="grid">
            <label className="f">School
              <select required value={form.school} onChange={set('school')}>
                <option value="">Choose…</option>
                {schools.map((s) => <option key={s.school_id} value={s.school_id}>{s.school_name} ({s.school_id}){covered.has(s.school_id) ? ' · has an account' : ''}</option>)}
              </select>
            </label>
            <label className="f">Full name<input required value={form.name} onChange={set('name')} placeholder="e.g. Juan D. Dela Cruz" /></label>
            <label className="f">DepEd email<input required type="email" value={form.email} onChange={set('email')} placeholder="name@deped.gov.ph" /></label>
            <label className="f">Position (optional)<input value={form.position} onChange={set('position')} placeholder="e.g. School Head, Property Custodian" /></label>
            <label className="f">Starting password
              <div className="pickrow">
                <input required minLength={8} value={form.password} onChange={set('password')} />
                <button type="button" className="btn sm secondary" onClick={() => setForm({ ...form, password: makePassword() })}>New one</button>
              </div>
            </label>
          </div>
          <p className="small muted">At least 8 characters, with letters and numbers. The person can keep using it for the pilot; ask them not to share it.</p>
          <div className="btns">
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
            <button type="button" className="btn secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="btns"><button type="button" className="btn" onClick={() => startFor(null)}>Add a school account</button></div>
      )}

      <section className="card">
        <h2>Accounts ({n(active.length)})</h2>
        {active.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No school accounts yet.</p> : (
          <div className="scroll">
            <table className="cards">
              <thead><tr><th>Person</th><th>School</th><th>Created</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {active.map((g) => (
                  <React.Fragment key={g.grant_id}>
                    <tr>
                      <td>{g.full_name}<div className="small muted">{g.email}{g.position ? ` · ${g.position}` : ''}</div></td>
                      <td data-label="School">{g.school_name}<div className="mono muted">{g.school_id}</div></td>
                      <td data-label="Created" className="small">{when(g.granted_at)}<div className="muted">{g.granted_by_name}</div></td>
                      <td data-label="Last sign-in" className="small">{g.last_sign_in_at ? when(g.last_sign_in_at) : <span className="muted">Not yet</span>}</td>
                      <td>
                        <div className="btns" style={{ margin: 0 }}>
                          <button type="button" className="btn sm secondary" onClick={() => { setNote(null); setAct({ kind: 'reset', row: g, value: makePassword() }); }}>Reset password</button>
                          <button type="button" className="btn sm secondary" onClick={() => { setNote(null); setAct({ kind: 'remove', row: g, value: '' }); }}>Remove</button>
                        </div>
                      </td>
                    </tr>
                    {act?.row.grant_id === g.grant_id && (
                      <tr><td colSpan={5}>
                        <div className="step stack">
                          {act.kind === 'reset' ? (
                            <label className="f">New password for {g.full_name}
                              <div className="pickrow">
                                <input minLength={8} value={act.value} onChange={(e) => setAct({ ...act, value: e.target.value })} />
                                <button type="button" className="btn sm secondary" onClick={() => setAct({ ...act, value: makePassword() })}>New one</button>
                              </div>
                            </label>
                          ) : (
                            <label className="f">Why is access removed? (for example: transferred, retired, new school head)
                              <input value={act.value} onChange={(e) => setAct({ ...act, value: e.target.value })} />
                            </label>
                          )}
                          <div className="btns">
                            <button type="button" className={`btn sm${act.kind === 'remove' ? ' danger' : ''}`} disabled={busy} onClick={finish}>
                              {act.kind === 'reset' ? 'Set new password' : 'Remove access'}
                            </button>
                            <button type="button" className="btn sm secondary" onClick={() => setAct(null)}>Cancel</button>
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="spread">
          <h2>Schools without an account yet ({n(without.length)})</h2>
        </div>
        <label className="f">Find a school<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, School ID or district" /></label>
        <div className="scroll">
          <table className="cards">
            <tbody>
              {shownWithout.slice(0, 20).map((s) => (
                <tr key={s.school_id}>
                  <td>{s.school_name}<div className="mono muted">{s.school_id}</div></td>
                  <td data-label="District">{s.district}</td>
                  <td><button type="button" className="btn sm secondary" onClick={() => startFor(s)}>Add account</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shownWithout.length > 20 && <p className="muted small">Showing 20 of {n(shownWithout.length)}. Search to narrow the list.</p>}
      </section>

      {removed.length > 0 && (
        <details className="card">
          <summary><b>Removed access ({n(removed.length)})</b></summary>
          <ul className="small">
            {removed.map((g) => <li key={g.grant_id}>{g.full_name} ({g.email}), {g.school_name}: removed {when(g.removed_at)}, {g.removal_reason}</li>)}
          </ul>
        </details>
      )}
    </main>
  );
}
