import React from 'react';
import { STATUS, ROLE } from '../lib/labels.js';
import { isLocal, isProduction } from '../lib/supabase.js';

export function go(path) {
  window.location.hash = path;
}

export function StatusChip({ status }) {
  if (!status) return <span className="chip amber">No status yet</span>;
  const s = STATUS[status];
  return <span className={`chip ${s.tone}`}>{s.label}</span>;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="notice err" role="alert">{typeof error === 'string' ? error : error.message}</div>;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export function Bar({ share }) {
  return <div className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Number(share || 0) * 100)}%` }} /></div>;
}

export function Header({ me, route, onSignOut }) {
  const office = !me ? 'DepEd Region VII'
    : me.office ? me.office
    : me.sdo_code ? `SDO ${me.sdos?.name ?? me.sdo_code}` : me?.role === 'co' ? 'DepEd Central Office' : 'Regional Office · PPRD';
  return (
    <>
      {isLocal && <div className="devbar">Local copy for building and testing. Nothing here is sent anywhere.</div>}
      {!isLocal && !isProduction && <div className="devbar">DepEd RO7 RIVET Pilot Validation</div>}
      <div className="official">
        The DepEd Central Office NSBI remains the official system and reporting. RIVET is an RO7 innovation that keeps the region's own validated record.
      </div>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href="#/home"><b>RIVET</b><span>{office}</span></a>
          <nav className="nav">
            {me && <a href="#/home" className={['#/dashboard', '#/access', '#/reports', '#/inventory', '#/password', '#/accounts'].includes(route) ? '' : 'on'}>{me.role === 'school' ? 'My school' : 'Validation'}</a>}
            {me && me.role !== 'school' && <a href="#/inventory" className={route === '#/inventory' ? 'on' : ''}>Inventory</a>}
            {me && me.role !== 'school' && <a href="#/dashboard" className={route === '#/dashboard' ? 'on' : ''}>Dashboard</a>}
            {me && me.role !== 'school' && <a href="#/reports" className={route === '#/reports' ? 'on' : ''}>Reports</a>}
            {me && me.role === 'ro' && <a href="#/accounts" className={route === '#/accounts' ? 'on' : ''}>Accounts</a>}
            {me && me.role === 'dpo' && <a href="#/access" className={route === '#/access' ? 'on' : ''}>School access</a>}
          </nav>
          {me && (
            <div className="who">
              <span>{me.full_name} · {me.office && me.role === 'co' ? 'View only' : ROLE[me.role]}</span>
              <a href="#/password">Change password</a>
              <button type="button" onClick={onSignOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
