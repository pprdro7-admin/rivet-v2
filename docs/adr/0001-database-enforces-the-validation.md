# ADR-0001: The database enforces the validation

Status: Proposed (2026-10-24), for Ada's acceptance.

## Context
The draft prototype (V1, Streamlit over SQLite) checked roles and rules in screen code, rebuilt its
database from Excel on every run, and lost review entries whenever the hosted app restarted. The
SY 2025–2026 validation needs 12 SDOs working at once on 19,015 buildings and 49,390 rooms, with
nothing lost and nothing edited behind anyone's back. School Registry V2 met the same needs this way.

## Decision
- CO's Tables 1 and 2 are loaded once per cycle as a source load and locked (`forbid_change()`).
- Every step (a DE's status on a building or room, a new record, a withdrawal, a DPO check, an RO
  sign-off) is an append-only row. The latest step counts; the record of earlier ones stays.
- People act only through the step functions, which check role, SDO, the template v3 rules and that
  the person's screen was not stale.
- Tally, flags, progress and the validated baseline are views computed from the CO data and the
  steps; nothing computed is typed.
- Row-level security decides what each person can read. The web app holds no secrets.

## Consequences
- The screens (Phase 2) stay thin; the rules cannot be bypassed from a browser or a spreadsheet import.
- A change to a rule is a reviewed migration with its checks, run on every push.
- A second CO release for the same cycle needs a deliberate migration that re-attaches validations.
