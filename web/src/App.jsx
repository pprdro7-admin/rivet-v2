import React, { useCallback, useEffect, useState } from 'react';
import { getClient, currentUserId, signOut } from './lib/supabase.js';
import { Header, Loading, ErrorNote, go } from './components/ui.jsx';
import SignIn from './screens/SignIn.jsx';
import Dashboard from './screens/Dashboard.jsx';
import SchoolTally from './screens/SchoolTally.jsx';
import RegionProgress from './screens/RegionProgress.jsx';
import School from './screens/School.jsx';
import SchoolAccess from './screens/SchoolAccess.jsx';
import Reports from './screens/Reports.jsx';
import Inventory from './screens/Inventory.jsx';
import { REGION_ROLES } from './lib/labels.js';

function useRoute() {
  const [route, setRoute] = useState(window.location.hash || '#/home');
  useEffect(() => {
    const on = () => { setRoute(window.location.hash || '#/home'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const [db, setDb] = useState(null);
  const [me, setMe] = useState(undefined); // undefined = still checking, null = signed out
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const client = await getClient();
    setDb(client);
    const uid = await currentUserId();
    if (!uid) { setMe(null); return; }
    const { data, error: e } = await client.from('profiles').select('*, sdos(name)').eq('id', uid).maybeSingle();
    if (e) setError(e);
    setMe(data ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!db || !db.auth?.onAuthStateChange) return undefined;
    const { data } = db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') load();
    });
    return () => data?.subscription?.unsubscribe?.();
  }, [db, load]);

  async function handleSignOut() {
    await signOut();
    setMe(null);
    setDb(null);
    go('#/home');
    load();
  }

  let page;
  if (me === undefined || !db) page = <div className="page"><Loading /></div>;
  else if (!me) page = <SignIn onSignedIn={load} />;
  else if (me.active === false) page = <div className="page"><div className="notice warn">This account no longer has access to RIVET. If you still need it, ask your Division Planning Officer.</div></div>;
  else if (me.role === 'school') page = <School db={db} me={me} schoolId={me.school_id} />;
  else if (route.startsWith('#/school/')) page = <School db={db} me={me} schoolId={route.slice('#/school/'.length)} />;
  else if (route === '#/dashboard') page = <Dashboard db={db} me={me} />;
  else if (route === '#/reports') page = <Reports db={db} me={me} />;
  else if (route === '#/inventory') page = <Inventory db={db} me={me} />;
  else if (route === '#/access' && me.role === 'dpo') page = <SchoolAccess db={db} me={me} />;
  else if (route.startsWith('#/sdo/')) page = <SchoolTally db={db} me={me} sdoCode={route.slice('#/sdo/'.length)} />;
  else if (REGION_ROLES.includes(me.role)) page = <RegionProgress db={db} me={me} />;
  else page = <SchoolTally db={db} me={me} sdoCode={me.sdo_code} />;

  return (
    <>
      <Header me={me || null} route={route} onSignOut={handleSignOut} />
      {error && <div className="page"><ErrorNote error={error} /></div>}
      {page}
    </>
  );
}
