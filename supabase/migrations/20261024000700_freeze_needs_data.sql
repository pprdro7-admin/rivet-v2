-- RIVET V2 · 0700 · A cycle cannot be frozen before its CO data is loaded.
--
-- Without this, freeze_cycle() on an empty cycle found no SDO left to sign off and froze it,
-- which would close the cycle to every validation step.

create or replace function freeze_cycle(p_cycle text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles;
  v_left text;
begin
  v_me := current_profile();
  if v_me.role is distinct from 'ro' then perform refuse('Only the Regional Office freezes a cycle', 'insufficient_privilege'); end if;
  if not exists (select 1 from source_loads where cycle_id = p_cycle and co_table = 'T2') then
    perform refuse('CO''s Tables 1 and 2 are not loaded for this cycle yet');
  end if;
  select string_agg(distinct s.sdo_code, ', ') into v_left
  from cycle_schools s
  where s.cycle_id = p_cycle
    and not exists (select 1 from sdo_signoffs o where o.cycle_id = p_cycle and o.sdo_code = s.sdo_code);
  if v_left is not null then perform refuse('Not yet signed off: ' || v_left); end if;
  update cycles set frozen_at = now(), frozen_by = v_me.id where id = p_cycle and frozen_at is null;
end $$;
