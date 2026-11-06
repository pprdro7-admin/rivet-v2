# RIVET turnover: from Ada to Ms EJ

Prepared November 6, 2026, for Ms. Esther Jyil B. Espos (AO II, PPRD), who continues RIVET in a new Claude session.

**What stays the same:** the GitHub repository `pprdro7-admin/rivet-v2`, the Supabase project, the Netlify site, and every account and secret in them.
**What changes:** the Claude Code session (its memory and container do not carry over) and the local drive (Ada's `E:\` folders must be copied to Ms EJ's computer).

This document is meant to be read by Ms EJ **and** pasted or attached into the new Claude session. Section 12 has a starter prompt.

> No password, key or connection string is written here. Section 4 says where each one lives.

---

## 1. What RIVET is

- **Name:** RIVET = **Regional Infrastructure Validation and Evaluation Tool**.
- **Who:** developed by DepEd RO7 **PPRD and ESSD**. Always write "PPRD and ESSD", PPRD first.
- **Purpose:** RIVET streamlines the fragmented NSBI validation loop. Today the paper template and the system are handled one after the other, DE remarks get lost when templates return late, and the school, DE, DPO and system copies differ. In RIVET, schools update, the Division Engineer validates, the DPO checks completion and the Region clears, all on one record per School ID.
- **Data:** SY 2025-2026 NSBI (inventory as of May 31, 2026), CO raw Tables 1 and 2 as of October 21, 2026: 12 SDOs, 2,792 schools, 19,015 buildings, 49,390 rooms. Once validated it becomes RO7's **baseline**; in SY 2026-27 schools report the updated, validated data through the normal NSBI, so it reaches CO through the regular cycle. CO does not need to "accept" RIVET data.
- **Positioning (Ada's words, keep them):**
  - The official DepEd NSBI stays the system of record. RIVET is not a duplicate or a replacement.
  - It does not replace site visits. On site it is the Engineer's reference (mobile). Offline use is "being explored", not built.
  - It adds no re-encoding: Tables 1 and 2 are the schools' own NSBI submissions.
  - Benefits to name: early error flags, one version for everyone, site-visit reference, corrections carried into the baseline.
  - Don't over-promise. Don't say "CO data" for the school tables: the data originates from schools.
- **Writing style Ada wants on the site, the guide and all materials:** plain words, no internal notes or coding talk, "revert" not "undo", dates like "May 31, 2026", not wordy, convincing.

## 2. Roles (as decided by Ada, November 3, 2026)

| Role in RIVET | Who | What they do |
|---|---|---|
| `school` | School Head (responsible for the data) | Updates their own school; gives info for added buildings; answers send-backs. May make the first site sketch. Sketch not required in SY 2025-26, required from SY 2026-27. No signed copies unless an SDO arranges it locally. |
| `de` | Division Engineer | Validates the technical data (existence, condition, type, storeys, coordinates, deletion, new buildings, numbering, sketch confirmation). Adds unreported buildings. Can send a record back to the school. |
| `dpo` | Division Planning Officer | Manages school access (School access screen), checks **completion** (not technical validation), adds schools that are new or did not submit their NSBI. |
| `co` + office "ESSD RO7" | ESSD Regional Engineers | Clear a Division once all its schools are Complete ("Cleared by the Region"). The Office must be set to "ESSD RO7" or they can't clear. |
| `co` (no office) | DepEd CO view-only (Sir Julius Briones, CO-EMISD) | Views and sends notes that the RO answers. |
| `ro` | RO PPRD (Ada; Ms EJ next) | Monitors, manages accounts (Accounts page), can **revert** a cleared Division with a reason. |

Other rules worth knowing: building numbers are never reused (a new building takes the last number; demolished buildings keep their record, the new one carries a "Replaces Bldg N" mark). "Demolished" is a valid condition. Table 4A (WATSAN) is per building and every Table 1 building must be answered ("No WATSAN" = all 0). Usage-locked rooms (condemned, on-going construction, etc.) take no usage entry. Deleting a building needs a reason and only a confirm box.

## 3. How it is built

- **Code:** GitHub `pprdro7-admin/rivet-v2`, branch `main`. The repository is **public**: never commit data files, backups, emails or keys (`*.xlsx` is ignored).
  - `supabase/migrations/`: the database, rules, access (RLS) and history. 34 migrations as of `446d2eb` (Nov 3, 2026). The rules live in the database (see `docs/adr/0001`).
  - `supabase/tests/`: automated checks (271 passed at the last push). `scripts/test.sh` runs them on a fresh Postgres.
  - `web/`: the screens (React + Vite), built by Netlify.
  - `scripts/`: loaders (`load_co_tables.py`, `load_co_school_tables.py`, `load_co_past_years.py`, `load_enrollment.py`), `dev.sh` (runs everything locally with a "sign in as sample account" list), speed checks.
  - `docs/runbooks/`: `RELEASE.md`, `BACKUP_AND_RESTORE.md`, `PILOT_ACCOUNTS.md`. Read these first.
- **Database:** Supabase project "rivet-v2", Singapore, organisation "DepEd RO7 PPRD", **Free plan, Nano compute**. Private Storage bucket `co-files` holds CO's xlsx files and the backups.
- **Website:** Netlify site **ro7-rivet.netlify.app** (base directory `web`, must stay public so people reach sign-in). Screens: Dashboard, Validation, Inventory, Reports, School access, Accounts (RO only), Change password, pre-filled NSBI form (`#/form/<school id>`).
- **Model it follows:** `pprdro7-admin/school-registry-v2` (same stack and patterns).
- **The old V1 prototype** (Streamlit + SQLite) is in the project folder `RO7 Harmonized NSBI/04_Application/`. It is no longer used; V2 replaced it. Its MATATAG classroom sizes were reused in the Dashboard.

## 4. Where the settings and secrets live (values are NOT in this document)

| Setting | Where | Notes |
|---|---|---|
| `SUPABASE_DB_URL` | GitHub > repo Settings > Environments > `validation` | Session pooler URI. The password must be letters and digits only (symbols break parsing). |
| `SUPABASE_SECRET_KEY` | same environment | `sb_secret_...` key, used by the loaders and backup. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Netlify > site settings > Environment variables | URL without a path. |
| Auth Site URL | Supabase > Authentication > URL Configuration | Must be the Netlify address. |
| Accounts and passwords | Supabase Auth + `profiles` table; RIVET Accounts page | RIVET's "Set new password" works for de/dpo/co/school but skips ro/admin by design. Ada's own (ro) password is reset in Supabase SQL Editor or Authentication > Users > Send password recovery. |
| Profile SQL already run | `/mnt/project-files/rivet-v2/pilot-dpo-profiles.sql`, `sdo-engineer-profiles.sql` | Reference only. |

**Before Ms EJ takes over the accounts:** decide whether she signs in to GitHub, Supabase and Netlify with Ada's logins or is **invited as a member** (better: GitHub collaborator/admin on the repo, Supabase org member, Netlify team member). Then give Ms EJ her own RIVET account with role `ro`. The longer-term plan is to move everything to an RO7 IT organisation account.

## 5. Release routine (do this every time)

1. **Back up first:** GitHub > Actions > **Back up the database** > Run workflow (~2 min). Three files land in Supabase Storage `co-files/backups/` (`rivet-<date>.dump`, `-accounts.dump`, `-counts.txt`). Download them to the office drive (Ada used `E:\RIVET Backups\`). They contain password hashes: keep them private.
2. **Make a fallback branch** at the current live commit, named `fallback-YYYY-MM-DD` (existing: `fallback-2026-10-31`, `fallback-2026-10-31b`). Tags can't be pushed from Claude's sandbox; use a branch.
3. Run the tests (`scripts/test.sh`, or let GitHub's "Database tests" run on the branch).
4. Get Ada's / Ms EJ's explicit **"go"**, then push to `main`.
   - A change under `supabase/migrations/` triggers **Update the validation database** automatically.
   - A change under `web/` makes Netlify build and deploy. **Each deploy spends Netlify credits** (credit-based plan, it has run low before). Batch screen changes into one push; changes outside `web/` don't build.
5. Check the workflow is green and the site works.

**Going back:** screens: Netlify > Deploys > the previous deploy > "Publish deploy" (no rebuild). Database: a new migration that undoes the change (validation steps are append-only, nothing recorded is lost). Data loss only: restore from the dumps (`docs/runbooks/BACKUP_AND_RESTORE.md`).

## 6. GitHub Actions

| Workflow | Runs | Use |
|---|---|---|
| Database tests | every push / PR | All checks on a fresh database |
| Update the validation database | push to `main` touching migrations | Applies new migrations (`supabase db push --yes`) |
| Back up the database | manual | Before every database push, weekly during validation |
| Load CO's NSBI tables | manual | Tables 1/2 from `co-files` (each cycle loads once; reruns refuse) |
| Load CO's other NSBI tables | manual | Tables 3, 4a/4b, 5, 7, classroom summary |
| Load LIS enrollment | manual | Enrollment for the Dashboard classroom gap |
| Load earlier school years | manual | Past NSBI/LIS from `co-files/past-years/` (skips loaded files) |
| Check screen speed | manual | Times the heavy screens |
| Load test | push on branch `claude/project-thread-v2q3if` (PR #1, not merged) | Read-only load test, Bohol/Cebu Province users |

Ada also has an admin how-to (uploading CO files and running loads) as a private Claude artifact: https://claude.ai/artifact/LjCxHpdoEeWF2poJuuff74. Claude artifacts are private to Ada until she shares them; see section 10.

## 7. Data sources and local drive (copy these to Ms EJ's computer)

| Ada's path | What | Needed for |
|---|---|---|
| `E:\NSBI 2025-2026 Validation` | Real CO Tables 1/2 as of Oct 21, 2026 (2,792 schools), validation workbooks, CO briefing transcript | Reloading, local checks with real data (`scripts/dev.sh T1.xlsx T2.xlsx`) |
| `E:\RO7 Harmonized NSBI` (incl. "NSBI Files", "Enrollment Files") | Project folder: SY 2024-25 CO files, earlier NSBI SY 2021-22 to 2023-24, LIS SY 2018-19 to 2024-25, CO templates and business rules, SY 2025-26 CO memo/form, SDO Toledo City school submissions, old V1 app | Past-year reports, reference |
| `E:\RIVET Backups\` | Downloaded database backups | Restore; keep private |

Notes:
- All of these are already loaded online. The live site does not depend on the local drive; the drive is the office copy and the source for any reload.
- Files in `01_Source_Data/SY2025-2026/` named "SAMPLE" are **synthetic**, not real.
- Wrong-region files to avoid: "SY 2021-2022 ... (REGION XII).xlsx" (Region XII), "REGION VII- SY 2023-2024 Number of Existing Building by Condition -.xlsx" (ends in a dash, actually Region VIII), "Copy of SY 2022-2023 Number of Classroom.xlsx" (partial duplicate). Negros Oriental and Siquijor SDOs in older files are now NIR and are left out.
- In a new Claude project, connect Ms EJ's copy of the "RO7 Harmonized NSBI" folder as a context source, and the `NSBI 2025-2026 Validation` folder when real-data checks are needed.

**Project files from this Claude project** (`/mnt/project-files/rivet-v2/`) do not move to a new project by themselves. Ada should download the folder (or the items below) and give it to Ms EJ:
- `guide/`: User Guide v2 (Full .docx/.pdf, per-role PDFs, A4) and `guide/source/` (scripts that rebuild it)
- `presentation/`: three narrated MP4s (NSBI Cycle Today, From Site to Report, Full Story), voice-over scripts, deck PDF
- `letters/`: LLC pilot letter (proofread .docx)
- `reference/`: signed CO memo (July 24, 2026) with the SY 2025-26 form and answering guide
- `research/`: NSBI validation research scan (Nov 5, 2026)
- `form-sample/`: sample pre-filled NSBI form
- `RIVET_Prototype_Demonstration_Field_Test_updated.pptx`, `rivet-logo.svg`, `pilot-accounts.md`, profile SQL files
- `turnover/`: this document

## 8. What is live (as of `446d2eb`, pushed November 3, 2026)

- Validation of Tables 1 and 2 per building and room (correct / with correction / for deletion), new buildings and rooms, auto-flags, tally.
- School role, school updates waiting for SDO acceptance, send back to school with notes and answers.
- DPO School access (creates school accounts with a starting password, no email), Completion status, add a school (new / no NSBI report).
- ESSD clears a Division ("Cleared by the Region"); PPRD reverts with a reason.
- School page as rows with View details, demolished buildings hidden behind a tick, "Replaces Bldg N", CO numbering rule.
- Site sketch (school's first placing, DE/DPO confirms; fence traced to the actual shape; adjacent sites; landmarks).
- Table 4A WATSAN per building; Tables 3-7 updated (earlier NSBI values shown as reference).
- Relocated schools; usage lock.
- Dashboard (year selector, classroom gap with LIS enrollment, priority schools, click-through) and Reports (BEIS-style, multi-year, group by Region/Division/District/Province/Municipality/Legislative District/School), past years back to NSBI SY 2021-22 and LIS SY 2018-19.
- Pre-filled NSBI form per school (CO memo layout), opens only once the school is Complete and its Division is cleared.
- Accounts page for RO, Change password (min 8 characters), 20-second time limit with automatic retries.

**Pilot:** SDOs Lapu-Lapu City (LLC), Toledo City (TOL), City of Naga, Cebu (NAG). Banner "DepEd RO7 RIVET Pilot Validation". All 12 SDOs' DEs (20) and DPOs (12) and 2 ESSD Regional Engineers have accounts. Online sample accounts (`@sample.test`) still exist.

## 9. Open work, in priority order

1. **Unpushed changes (release first).** Three small changes were finished in an earlier Claude session but never pushed, because they were waiting for Ada's backup and "go":
   - Pre-filled NSBI form **button** on the school page, once the school is Complete (the guide already shows it).
   - "Revert" instead of "undo" on screen, and dates like "May 31, 2026" (includes migration `20261103003400_revert_wording.sql`, which only rewrites messages).
   - Accounts page: internal note removed; ESSD accounts labelled "ESSD Engineer (clears Divisions)".

   They are saved as patches in `docs/handover/unpushed/` in the repository (branch `claude/project-thread-egx01m`) and in the project files at `rivet-v2/handover-unpushed-2026-11-06/` (patches + `unpushed.bundle`). They apply cleanly on `main` at `446d2eb` (checked Nov 6, 2026) with `git am docs/handover/unpushed/000*.patch`. Release them with the routine in section 5; this deploys the site (Netlify credits) and migration 3400.

2. **LLC pilot on November 25, 2026 (Wednesday).** Letter from RD Bayocot to SDS Marilyn S. Andales proposing the date, with DE, DPO, Public School Heads and School AOs (or personnel the SDS designates); venue on-site at SDO LLC, another venue, or virtual. Proofread letter: `letters/Letter - RIVET (proofread).docx`. Still to do: confirm the letter went out and the reply; fill the contact person lines; create school accounts for the chosen LLC schools (DPO does it in School access); print or share the per-role guides; suggested pilot measure: days from DE remark to correction.
3. **Performance before region-wide use (awaiting go-ahead).** Load test (Nov 6, 2026): fine at 5 nonstop users; at 10, 9 of 10 hit the 8-second limit. Heavy reads: `school_tally` (Division list ~2.9 s), Dashboard `classroom_gap` / `dash_conditions` (~1.1 s), `building_status`. Report: https://claude.ai/artifact/UwPiZ6NChCuzhwcmAzhVFU.
   - **Step 1 (software, no cost, ~1 day), waiting for a "go":** read-only check on live first; then filter before counting, check access once per request (RLS `(select auth.uid())` pattern), keep running totals, add missing indexes; prove identical counts before/after; back up; push as one database update (no Netlify build); rerun the load test; keep an undo script.
   - **Step 2 (decision, cost):** Supabase Pro + bigger compute before region-wide rollout (Pro also brings daily backups). Stagger the rollout by Division.
   - Usage (Nov 6): database 258 of 500 MB, 43 monthly users, log ingestion over the free amount but not counted against the plan.
4. **Presentation materials** are finished: deck "RIVET: Why, What, Where Next" (https://claude.ai/artifact/QdPa4bEH51Jjg2pvrGsQry, PDF in `presentation/`), and three narrated videos (MP4s in `presentation/`). Keep both original videos alongside the combined Full Story.
5. **Feature backlog** (none built; each needs Ada's / Ms EJ's decision):
   - "With correction" for more fields (building type, fund source, storeys, year completed).
   - Mark a retired School ID as "merged into" its Integrated School ID; flag double-counted buildings.
   - Building photos (~200 KB each; storage limit on the free plan).
   - Log a "CO return for revalidation" (flag, reason, correction, confirmer) so it carries into the baseline.
   - Between-cycle updates and offline use (shown as "Direction" in the videos).
   - Stricter rule for condemned buildings in Table 4A (functional = 0), pending Ada's check.
   - Mini sketch in Table 1 details: removed; bring back only if Engineers or ESSD ask (commit `5acc8ed` has it).
   - Import of school-submitted NSBI Excel forms (about half of Toledo's use a modified "NEW TEMPLATE").
   - Production project separate from validation (RELEASE.md describes it; today validation is the live site).
6. **Guide upkeep:** one living guide, versioned, with a "This cycle" page. Update it when screens change.

## 10. Things that do not transfer by themselves

- **Claude project memory and threads.** This document replaces them.
- **Claude artifacts** (links above). They belong to Ada's claude.ai account. Ada can share each with Ms EJ, or Ms EJ uses the PDFs/MP4s in the project files.
- **The local drive** (section 7).
- **Claude's GitHub access.** In the new session, connect GitHub (claude.ai/connect-github) with an account that can push to `pprdro7-admin/rivet-v2`, and make sure the Claude GitHub App is installed on the repo.

## 11. Key people

| Name | Role |
|---|---|
| Dr. Arturo B. Bayocot, CESO III | Regional Director, DepEd RO7 |
| Ms. Helen D. Sabino | Chief, PPRD |
| Mr. Tomas T. Pastor ("Sir Tom") | Chief, ESSD. His concern: school buy-in, schools seeing RIVET as duplicate work |
| Ada D (Dayondon) | Built RIVET with Claude (PPRD, former DPO); handing over |
| Ms. Esther Jyil B. Espos ("Ms EJ") | AO II, PPRD; continues RIVET; presenter of the field-test deck |
| Sir Julius Briones | DepEd CO-EMISD, view-only account; suggested the rows layout |
| Noime Guillen, Christian Kerr Agot | ESSD Regional Engineers (clear Divisions) |
| Marilyn S. Andales | SDS, SDO Lapu-Lapu City (pilot) |
| Marie Ditha Alvarado | DPO, Lapu-Lapu City |
| Kerhstine P. Sundo | DPO, Toledo City |
| Reeman Clyde N. Manacap | DPO, City of Naga, Cebu |

Emails are in Supabase Auth and on RIVET's Accounts page (and in `pilot-accounts.md` / the profile SQL files in the project files). They are left out here because the repository is public.

## 12. Starter prompt for the new Claude session

Copy this into the first message, and attach this document:

```
I'm Ms EJ (Esther Jyil B. Espos, AO II, PPRD, DepEd RO7). I'm taking over RIVET
(Regional Infrastructure Validation and Evaluation Tool, by RO7 PPRD and ESSD) from Ada.
The attached RIVET_Turnover_2026-11-06.md is the full handover: read it first, then
read README.md and docs/runbooks/ (RELEASE.md, BACKUP_AND_RESTORE.md, PILOT_ACCOUNTS.md)
in the repo pprdro7-admin/rivet-v2.

Working rules:
- The live site is ro7-rivet.netlify.app on Supabase project "rivet-v2" (free plan).
  Never push to main or change the live database without my explicit "go".
- Before every push: I run "Back up the database", you make a fallback-YYYY-MM-DD branch.
- Netlify deploys cost credits: batch screen (web/) changes into one push.
- The repo is public: no data files, emails, passwords or keys in commits.
- Plain words on the site and in guides; no internal notes; "revert" not "undo";
  dates like "May 31, 2026"; write "PPRD and ESSD".
- Save what you learn about this project to memory as we go.

First tasks:
1. Look at the three unpushed changes in docs/handover/unpushed/ and tell me what
   releasing them involves (I will run the backup and say go).
2. Give me a short status of the open work in section 9 and what you need from me.
```

---

*Sources: Claude project memory, the repository at `446d2eb`, project files, and the threads "Rebuild RIVET prototype with SY 2025-2026 baseline", "Research NSBI studies and validation practices" and "Draft pilot letter to SDO Lapu-Lapu".*
