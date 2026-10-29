-- RIVET V2 · 2500 · An office name shown in the header, for view-only regional offices.
-- ESSD RO7 engineers sign in with the view-only role 'co' (Ada, 2026-10-29). Without an office the
-- header would call them "DepEd Central Office"; with one it shows that office instead.
alter table profiles add column if not exists office text;
comment on column profiles.office is 'Office shown in the header, e.g. ESSD RO7. Blank = the role''s usual office.';
