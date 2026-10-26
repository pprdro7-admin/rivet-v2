import { createClient } from '@supabase/supabase-js';

// Two ways to run:
// - On Netlify: the real Supabase project (VITE_SUPABASE_URL / _ANON_KEY). Validation testers sign in
//   with an email and password PPRD created for them; Google sign-in shows once VITE_GOOGLE_SIGNIN=on
//   (it needs an OAuth client from Google Cloud, which the DepEd Workspace has switched off for staff).
// - On a laptop (scripts/dev.sh): the local database, where "signing in" means picking one of the
//   sample accounts. The local server accepts tokens signed with a throwaway development secret.
// A read that hits the database's time limit (often a cold or busy moment on the shared server)
// is tried again, up to twice, before the screen shows the error. Saves are never repeated.
async function patientFetch(input, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(input, init);
    if (method !== 'GET' || res.status < 500 || attempt >= 2) return res;
    const body = await res.clone().json().catch(() => null);
    if (body?.code !== '57014') return res;
    await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)));
  }
}

export const LOCAL_SECRET = import.meta.env.VITE_LOCAL_JWT_SECRET;
export const isLocal = Boolean(LOCAL_SECRET);
export const googleSignIn = import.meta.env.VITE_GOOGLE_SIGNIN === 'on';
// Until VITE_PRODUCTION=on, every page says it is the validation site.
export const isProduction = import.meta.env.VITE_PRODUCTION === 'on';

const SESSION_KEY = 'rivet.local.user';

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function localToken(claims) {
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 12 * 3600 })));
  const key = await crypto.subtle.importKey('raw', enc.encode(LOCAL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

let client;
let localUserId = null;

export async function getClient() {
  if (client) return client;
  if (!isLocal) {
    // PKCE returns from Google with ?code=, which leaves the #/ screen addresses alone.
    // Only the address's origin: a URL copied with /rest/v1/ on the end sends sign-in to the wrong place.
    const url = new URL(import.meta.env.VITE_SUPABASE_URL.trim()).origin;
    client = createClient(url, import.meta.env.VITE_SUPABASE_ANON_KEY.trim(), {
      auth: { flowType: 'pkce' },
      global: { fetch: patientFetch },
    });
    return client;
  }
  try { localUserId = sessionStorage.getItem(SESSION_KEY); } catch { localUserId = null; }
  const anon = await localToken({ role: 'anon' });
  const headers = {};
  if (localUserId) headers.Authorization = `Bearer ${await localToken({ role: 'authenticated', sub: localUserId })}`;
  client = createClient(window.location.origin, anon, {
    global: { headers, fetch: patientFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

// The signed-in user's id, or null.
export async function currentUserId() {
  const db = await getClient();
  if (isLocal) return localUserId;
  const { data } = await db.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function signInWithGoogle() {
  const db = await getClient();
  await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } });
}

// Returns an error message, or null when signed in.
export async function signInWithPassword(email, password) {
  const db = await getClient();
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return null;
  // Supabase's own words go in brackets, so a problem can be named exactly.
  const own = ` (${error.code || error.status || ''}: ${error.message})`;
  if (/invalid login credentials/i.test(error.message)) return 'That email and password do not match an account.' + own;
  if (/email not confirmed/i.test(error.message)) return 'This account is not confirmed yet. Ask PPRD to confirm it.' + own;
  if (/api key/i.test(error.message)) return 'The site cannot reach its database (API key). PPRD: check VITE_SUPABASE_ANON_KEY on Netlify.' + own;
  return error.message + own;
}

export async function signInLocal(userId) {
  try { sessionStorage.setItem(SESSION_KEY, userId); } catch { /* private window: lasts this page only */ }
  localUserId = userId;
  client = null;
}

export async function signOut() {
  if (isLocal) {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* nothing stored */ }
    localUserId = null;
    client = null;
    return;
  }
  const db = await getClient();
  await db.auth.signOut();
}
