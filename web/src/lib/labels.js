export const ROLE = {
  de: 'Division Engineer',
  dpo: 'Division Planning Officer',
  ro: 'Regional Office (PPRD)',
  admin: 'Administrator',
  co: 'Central Office (view only)',
  school: 'School',
};

export const STATUS = {
  correct: { label: 'Correct as is', tone: 'green' },
  corrected: { label: 'With correction', tone: 'blue' },
  for_deletion: { label: 'For deletion', tone: 'red' },
};

export const CYCLE = 'SY2025-2026';

// The data being validated, as the screens name it.
export const SOURCE = 'NSBI 2025–2026 (as of 31 May 2026)';

export function pct(share) {
  return `${Math.floor(Number(share || 0) * 100)}%`;
}

export function n(x) {
  return Number(x || 0).toLocaleString('en-PH');
}

// The database's refusal, as the person should read it.
export function problem(error) {
  if (!error) return null;
  return error.message || String(error);
}

// Learners per room as a ratio, rounded to a whole learner: 1:36. Small ratios (learners per seat)
// keep one decimal, 1:1.3, so they do not all read 1:1.
export function ratio(x) {
  if (x === null || x === undefined) return '';
  const v = Number(x);
  return v < 10 ? `1:${v.toFixed(1)}` : `1:${Math.round(v)}`;
}

// Roles that see the whole region.
export const REGION_ROLES = ['ro', 'admin', 'co'];
