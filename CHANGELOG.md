# Changelog

## Unreleased: Phase 2 screens (2026-10-24)
- Web app (`web/`): sign-in, School Tally per SDO (filters, search, flagged first), school page with every
  building and its rooms, CO values beside validated values, the DE's step on each record, "mark unflagged
  records as correct as is", new buildings and rooms, DPO complete or return, RO progress by SDO, sign-off,
  freeze. Every page states that the DepEd CO NSBI remains the official system.
- Migration 0600: `sdo_progress`, flags as one line per record. 80 checks.
- `scripts/dev.sh` runs everything locally, with the fixture or CO's real files.

## Unreleased: Phase 1 foundation (2026-10-24)
- CO data: cycles (SY 2024–2025 prior, SY 2025–2026 current), source loads, Tables 1 and 2 kept as
  released, `scripts/load_co_tables.py` to load the raw xlsx files.
- Validation, as in template v3: a status for every building and room, corrections beside the CO
  value, deletion reasons, demolished buildings kept, new buildings and rooms, DPO complete or return,
  RO sign-off per SDO, cycle freeze.
- Computed: tally (Table 2 to Table 1), RO auto-flags with the v5 wording, School Tally with %
  validated, validated baseline.
- Row-level security per SDO. 76 automated checks.
- Checked against the real CO files as of 21 October 2026: 12 SDOs, 2,792 schools, 19,015 buildings,
  49,390 rooms; 626 flagged buildings and 5,110 flagged rooms, as in the v5 workbook. One difference:
  3 rooms whose code is repeated *and* does not match their building get both flags here, one in v5.
