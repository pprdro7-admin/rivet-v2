import React, { useState } from 'react';
import { isLocal, signInLocal, signInWithPassword } from '../lib/supabase.js';
import { ErrorNote, go } from '../components/ui.jsx';

// The sample accounts from supabase/seed.sql (local copy only).
const SAMPLE_ACCOUNTS = [
  ['01', 'Division Engineer, Bohol'],
  ['02', 'Division Planning Officer, Bohol'],
  ['03', 'Division Engineer, Cebu City'],
  ['04', 'Division Planning Officer, Cebu City'],
  ['05', 'Regional Office (PPRD)'],
];

export default function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const trouble = await signInWithPassword(email, password);
    setBusy(false);
    if (trouble) { setError(trouble); return; }
    await onSignedIn();
    go('#/home');
  }

  async function pick(suffix) {
    await signInLocal(`00000000-0000-0000-0000-0000000000${suffix}`);
    await onSignedIn();
    go('#/home');
  }

  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <div className="card" style={{ gap: 16 }}>
        <h1>Sign in to RIVET</h1>
        <p style={{ margin: 0 }}>
          For Division Engineers, Division Planning Officers and the Regional Office. You see the schools
          of your own SDO. The record belongs to each School ID, so it stays when people move.
        </p>
        {!isLocal && (
          <form className="stack" onSubmit={submit}>
            <label className="f">Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="f">Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {error && <ErrorNote error={error} />}
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <p className="small muted" style={{ margin: 0 }}>PPRD gives you your email and password.</p>
          </form>
        )}
        {isLocal && (
          <section className="stack">
            <h2>Sample accounts</h2>
            {SAMPLE_ACCOUNTS.map(([suffix, label]) => (
              <button key={suffix} type="button" data-account={suffix} className="btn secondary" style={{ justifyContent: 'flex-start' }} onClick={() => pick(suffix)}>
                {label}
              </button>
            ))}
          </section>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          We keep only your name, email and role, to show who recorded each step.
        </p>
      </div>
    </main>
  );
}
