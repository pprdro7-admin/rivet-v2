-- The fence of each site, drawn to match the actual fence (Ada, 2026-11-03). The school head may
-- trace it (corners in order, any shape); a side with no fence yet is marked open. It is part of the
-- sketch the Engineer confirms: a school's change after the last confirmation waits for the Engineer.
-- Points are in sketch units (the drawing is 800 x 460). No fence drawn = the plain site boundary.

create table site_fences (
  id          bigint generated always as identity primary key,
  cycle_id    text not null references cycles(id),
  school_id   text not null,
  sdo_code    text not null references sdos(code),
  site_no     int  not null default 1 check (site_no >= 1),
  points      jsonb,                         -- [[x, y], ...] corners in order; null when cleared
  open_sides  int[] not null default '{}',   -- side i runs from corner i to corner i+1 (last closes the loop)
  removed     boolean not null default false,
  by_school   boolean not null default made_by_school(),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (cycle_id, school_id) references cycle_schools (cycle_id, school_id),
  check (removed or points is not null)
);
create index site_fences_school_idx on site_fences (cycle_id, school_id, site_no, id);
create trigger site_fences_locked before update or delete on site_fences
  for each row execute function forbid_change();

create or replace function record_site_fence(p_cycle text, p_school text, p_site_no int, p_points jsonb,
                                             p_open_sides int[] default '{}', p_removed boolean default false)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_n int;
  v_id bigint;
begin
  select * into e from sketch_editor(p_cycle, p_school) as (sdo_code text, me uuid);
  if coalesce(p_site_no, 1) >= 2 and not exists (
    select 1 from school_site_list s where s.cycle_id = p_cycle and s.school_id = p_school and s.site_no = p_site_no) then
    perform refuse('Add the adjacent site first');
  end if;
  if not coalesce(p_removed, false) then
    if jsonb_typeof(p_points) is distinct from 'array' then perform refuse('Give the fence corners'); end if;
    v_n := jsonb_array_length(p_points);
    if v_n < 3 then perform refuse('A fence needs at least 3 corners'); end if;
    if v_n > 40 then perform refuse('A fence has at most 40 corners'); end if;
    if exists (select 1 from jsonb_array_elements(p_points) p
                where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
                   or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number'
                   or (p ->> 0)::numeric not between 0 and 800 or (p ->> 1)::numeric not between 0 and 460) then
      perform refuse('Each corner must be on the drawing');
    end if;
    if exists (select 1 from unnest(coalesce(p_open_sides, '{}')) s where s < 0 or s >= v_n) then
      perform refuse('An open side must be one of the fence''s sides');
    end if;
  end if;
  insert into site_fences (cycle_id, school_id, sdo_code, site_no, points, open_sides, removed, recorded_by)
  values (p_cycle, p_school, e.sdo_code, coalesce(p_site_no, 1),
          case when coalesce(p_removed, false) then null else p_points end,
          case when coalesce(p_removed, false) then '{}' else (select coalesce(array_agg(distinct s order by s), '{}') from unnest(coalesce(p_open_sides, '{}')) s) end,
          coalesce(p_removed, false), e.me)
  returning id into v_id;
  return v_id;
end $$;

create view site_fence_latest with (security_invoker = true) as
select * from (
  select distinct on (f.cycle_id, f.school_id, f.site_no)
         f.cycle_id, f.school_id, f.sdo_code, f.site_no, f.points, f.open_sides, f.removed, f.by_school,
         f.recorded_at, profile_name(f.recorded_by) as recorded_by_name
  from site_fences f order by f.cycle_id, f.school_id, f.site_no, f.id desc
) x where not removed;

-- The fence counts as a change to the sketch.
create or replace view sketch_state with (security_invoker = true) as
with ch as (
  select cycle_id, school_id, recorded_at, by_school, recorded_by from sketch_items
  union all
  select cycle_id, school_id, recorded_at, by_school, recorded_by from school_sites
  union all
  select cycle_id, school_id, recorded_at, by_school, recorded_by from site_fences
), last_school as (
  select cycle_id, school_id, max(recorded_at) as at from ch where by_school group by 1, 2
), last_any as (
  select distinct on (cycle_id, school_id) cycle_id, school_id, recorded_at as at, recorded_by from ch
  order by cycle_id, school_id, recorded_at desc
), conf as (
  select distinct on (cycle_id, school_id) cycle_id, school_id, recorded_at as at, recorded_by from sketch_confirmations
  order by cycle_id, school_id, recorded_at desc
)
select a.cycle_id, a.school_id, a.at as changed_at, ls.at as school_changed_at,
       c.at as confirmed_at, p.full_name as confirmed_by,
       (ls.at is not null and (c.at is null or ls.at > c.at)) as waits_for_engineer
from last_any a
left join last_school ls using (cycle_id, school_id)
left join conf c using (cycle_id, school_id)
left join profiles p on p.id = c.recorded_by;

alter table site_fences enable row level security;
create policy read_scoped on site_fences for select to authenticated using (
  (select current_app_role()) in ('ro', 'admin', 'co')
  or (sdo_code = (select current_sdo()) and ((select current_school()) is null or school_id = (select current_school()))));
revoke all on site_fences, site_fence_latest from anon;
revoke insert, update, delete, truncate on site_fences from authenticated;
grant select on site_fences, site_fence_latest to authenticated;
revoke execute on function record_site_fence(text, text, int, jsonb, int[], boolean) from public, anon;
grant execute on function record_site_fence(text, text, int, jsonb, int[], boolean) to authenticated;
