# RIVET V2 (DepEd RO7 Infrastructure Intelligence)

The next version of the RIVET prototype. It replaces the draft's Streamlit and SQLite with a
Postgres database (Supabase) where the NSBI validation rules, access and history are enforced by
the database itself, following School Registry V2.

Its first job is the **SY 2025–2026 validation of NSBI buildings and rooms** (CO raw Tables 1 and 2
as of 21 October 2026). Once every SDO is signed off, that cycle is frozen as the baseline for later
NSBI reporting. SY 2024–2025 is kept read-only for comparison.

> The official DepEd NSBI remains the system of record. CO's data is never edited here: the field's
> validation is recorded beside it, and records for deletion are set aside, not removed.

**Status:** Phase 1 (database) done and checked against the real CO files. No screens yet.

## What is here

| Folder | What it holds |
|---|---|
| `supabase/migrations/` | The database, in order: cycles and CO data (0100), lists (0110), people (0200), validation steps (0300), tally, flags, DPO check, sign-off and baseline (0400), security (0500). |
| `supabase/seed.sql` | Fictional sample accounts, one per role, for local runs and the validation site. |
| `supabase/tests/` | 76 automated checks on a tiny fictional CO release. |
| `scripts/test.sh` | Builds a fresh database and runs all checks. |
| `scripts/load_co_tables.py` | Loads CO's raw Table 1 and Table 2 xlsx files, exactly as released. |
| `scripts/check_real_data.sh` | Loads the real files into a throwaway database and prints counts and flags, to compare with the v5 workbook. |
| `docs/adr/` | Decisions. |

CO's real files never go in this repository (`*.xlsx` is ignored).

## How validation moves (template v3)

1. **Division Engineer** gives every building and room of the SDO a status: *correct as is*, *with
   correction* (the validated value beside CO's, with remarks), or *for deletion* (with a reason).
   Demolished buildings are kept, not deleted. Missing buildings and rooms are added as new records,
   with codes left blank for CO.
2. The **tally** is computed: a building's validated room count is its rooms not for deletion plus its
   new rooms. A room kept in a building for deletion is flagged until the DE decides it.
3. **Division Planning Officer** marks each school *complete* (only when every record has a status and
   no room is left undecided) or *returned to DE* with remarks. A later DE step reopens the school.
4. **Regional Office** signs off an SDO once all its schools are complete; nothing more is recorded for
   it. When all 12 are signed off, the RO freezes the cycle and its validated baseline becomes the
   reference.

RO auto-flags (same checks and wording as the v5 workbook) show where to start; every record is
still validated.

## Run the checks

On a machine with Postgres 15 or newer: `scripts/test.sh`. GitHub runs it on every push.

## Next phases

2. Screens: DE worklist, DPO check, School Tally, RO progress by SDO; import of returned v5 workbooks.
3. Export in CO's layout per SDO and for Region VII, certification, freeze.
4. The V1 intelligence views (capacity, gaps, governed rules) on the new baseline, and the
   SY 2024–2025 comparison.
