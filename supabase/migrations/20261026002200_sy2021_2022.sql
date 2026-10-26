-- RIVET V2 · 2200 · SY 2021-2022 for the reports (Ada, 26 Oct 2026).
--
-- CO's SY 2021-2022 release for Region VII is one workbook with a sheet per table. Its Table 1
-- lists each building, so the loader counts them per school and condition into BLD; Tables 2 to 7
-- load as CLS and T3 to T7, like the later years.

insert into cycles (id, label, role) values
  ('SY2021-2022', 'SY 2021–2022', 'prior')
on conflict (id) do nothing;
