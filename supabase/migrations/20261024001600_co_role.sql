-- RIVET V2 · 1600 · A role for DepEd Central Office (EMISD) viewers. On its own: a new enum value
-- must be committed before it is used (1700).
alter type app_role add value if not exists 'co';
