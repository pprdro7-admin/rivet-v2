-- RIVET V2 · 1000 · A school role, on its own: a new enum value can only be used once committed.
alter type app_role add value if not exists 'school';  -- a school's own account: updates its School ID only
