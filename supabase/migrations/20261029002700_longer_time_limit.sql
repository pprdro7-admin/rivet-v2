-- RIVET V2 · 2700 · A longer time limit for signed-in screens (Ada, 2026-10-29: "time error" that
-- clears on refresh). Supabase's free database is slow when cold or busy; 8 seconds was too short.
alter role authenticated set statement_timeout = '20s';
notify pgrst, 'reload config';
