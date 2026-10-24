export const ROLE = {
  de: 'Division Engineer',
  dpo: 'Division Planning Officer',
  ro: 'Regional Office (PPRD)',
  admin: 'Administrator',
};

export const STATUS = {
  correct: { label: 'Correct as is', tone: 'green' },
  corrected: { label: 'With correction', tone: 'blue' },
  for_deletion: { label: 'For deletion', tone: 'red' },
};

export const CYCLE = 'SY2025-2026';

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
