import React, { useState } from 'react';
import { changePassword, isLocal } from '../lib/supabase.js';
import { ErrorNote } from '../components/ui.jsx';

// Any signed-in user sets a new password for their own account.
export default function ChangePassword({ me }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { setError('Use at least 8 characters, with letters and numbers.'); return; }
    if (password !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    const trouble = await changePassword(password);
    setBusy(false);
    if (trouble) { setError(trouble); return; }
    setPassword(''); setAgain(''); setDone(true);
  }

  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="card" style={{ gap: 16 }}>
        <h1>Change password</h1>
        <p style={{ margin: 0 }}>For {me.email}. Use at least 8 characters, with letters and numbers, that others cannot guess. Do not share it.</p>
        {isLocal && <div className="notice">The local copy has no passwords.</div>}
        {!isLocal && (
          <form className="stack" onSubmit={submit}>
            <label className="f">New password<input type="password" autoComplete="new-password" required value={password} onChange={(e) => { setPassword(e.target.value); setDone(false); }} /></label>
            <label className="f">New password again<input type="password" autoComplete="new-password" required value={again} onChange={(e) => { setAgain(e.target.value); setDone(false); }} /></label>
            {error && <ErrorNote error={error} />}
            {done && <div className="notice ok">Your password is changed. Use it the next time you sign in.</div>}
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          </form>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Forgot your password? Schools: ask your Division Planning Officer to reset it. SDO and RO staff: ask PPRD.
        </p>
      </div>
    </main>
  );
}
