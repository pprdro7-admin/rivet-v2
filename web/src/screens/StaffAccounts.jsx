import React, { useCallback, useEffect, useState } from 'react';
import { ErrorNote, Loading } from '../components/ui.jsx';
import { problem, ROLE } from '../lib/labels.js';
import { makePassword } from './SchoolAccess.jsx';

const when = (t) => (t ? new Date(t).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');

// PPRD sets a new password for any Engineer, Planning Officer, view-only or school account, and gives it to
// the person directly. No email is sent. Each reset is kept on record; the password is not.
export default function StaffAccounts({ db }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);       // { ok, email, password } or { err }
  const [act, setAct] = useState(null);         // { row, value }
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await db.rpc('staff_accounts');
    if (e) setError(e); else setList(data);
  }, [db]);
  useEffect(() => { load(); }, [load]);

  if (error) return <main className="page"><ErrorNote error={error} /></main>;
  if (!list) return <main className="page"><Loading /></main>;

  async function finish() {
    setBusy(true);
    const { row, value } = act;
    const { error: err } = await db.rpc('reset_staff_password', { p_user: row.id, p_password: value });
    setBusy(false);
    if (err) { setNote({ err: problem(err) }); return; }
    setNote({ ok: `New password set for ${row.full_name}.`, email: row.email, password: value });
    setAct(null);
    load();
  }

  const w = q.trim().toLowerCase();
  const shown = list.filter((a) => !w || [a.full_name, a.email, a.sdo_name, a.office, a.school_id].some((x) => (x || '').toLowerCase().includes(w)));
  const office = (a) => a.role === 'school' ? `School ${a.school_id} · SDO ${a.sdo_name}` : a.sdo_name ? `SDO ${a.sdo_name}` : a.office || 'Central Office';

  return (
    <main className="page">
      <div className="spread">
        <h1>Accounts</h1>
        <span className="muted">{list.length} accounts</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Set a new password when someone cannot sign in or has forgotten theirs, then give it to them yourself. No email is sent.
        They can change it after signing in, with "Change password". New SDO accounts are still made in Supabase; school accounts by the DPO.
      </p>

      {note?.ok && (
        <div className="notice ok stack">
          <span>{note.ok}</span>
          <span>Sign in with <b>{note.email}</b> and password <span className="secret">{note.password}</span>. Copy it now: it is not shown again.</span>
        </div>
      )}
      {note?.err && <ErrorNote error={note.err} />}

      <section className="card">
        <label className="f" style={{ maxWidth: 360 }}>Find a person<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, SDO or School ID" /></label>
        <div className="scroll">
          <table className="cards">
            <thead><tr><th>Person</th><th>Role</th><th>Office</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {shown.map((a) => (
                <React.Fragment key={a.id}>
                  <tr>
                    <td>{a.full_name}<div className="small muted">{a.email}</div></td>
                    <td data-label="Role" className="small">{a.role === 'co' && a.office ? 'View only' : ROLE[a.role]}</td>
                    <td data-label="Office" className="small">{office(a)}</td>
                    <td data-label="Last sign-in" className="small">
                      {a.last_sign_in_at ? when(a.last_sign_in_at) : <span className="muted">Not yet</span>}
                      {!a.has_password && <div className="small" style={{ color: '#a33' }}>No password set</div>}
                      {a.last_reset_at && <div className="muted">Reset {when(a.last_reset_at)}</div>}
                    </td>
                    <td>
                      <button type="button" className="btn sm secondary" onClick={() => { setNote(null); setAct({ row: a, value: makePassword() }); }}>Set new password</button>
                    </td>
                  </tr>
                  {act?.row.id === a.id && (
                    <tr><td colSpan={5}>
                      <div className="step stack">
                        <label className="f">New password for {a.full_name}
                          <div className="pickrow">
                            <input minLength={8} value={act.value} onChange={(e) => setAct({ ...act, value: e.target.value })} />
                            <button type="button" className="btn sm secondary" onClick={() => setAct({ ...act, value: makePassword() })}>New one</button>
                          </div>
                        </label>
                        <div className="btns">
                          <button type="button" className="btn" disabled={busy} onClick={finish}>{busy ? 'Saving…' : 'Set password'}</button>
                          <button type="button" className="btn secondary" onClick={() => setAct(null)}>Cancel</button>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
