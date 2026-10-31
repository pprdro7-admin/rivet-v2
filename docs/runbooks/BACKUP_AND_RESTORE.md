# Backups and going back

Free Supabase keeps no backups of its own, so RIVET keeps three copies of itself.

| What | Where | How |
|---|---|---|
| The code (screens, rules, workflows) | GitHub, every commit; a branch `fallback-YYYY-MM-DD` before each push to the live site | Automatic; the branch is made before each push |
| The website as people see it | Netlify > Deploys keeps every earlier deploy | Automatic |
| The data (schools' entries, validations, notes, accounts) | Supabase Storage, private bucket `co-files`, folder `backups/` | Run the **Back up the database** workflow |

**Before every push that changes the database, and at least once a week during validation:**

1. GitHub > Actions > **Back up the database** > Run workflow. It takes about two minutes.
2. Supabase > Storage > `co-files` > `backups/`: three new files with the date and time (UTC):
   - `rivet-<date>.dump`: every table, rule and permission, and which updates ran;
   - `rivet-<date>-accounts.dump`: the sign-in accounts (emails and password hashes);
   - `rivet-<date>-counts.txt`: rows per table, to check a restore.
3. Download the three files to the office drive too (for example `E:\RIVET Backups\`). Keep them as
   private as the accounts: they hold every account's password hash.

The repository is public, so a backup is never kept as a GitHub artifact and the log shows only file
sizes. A file over 50 MB (the free plan's limit) is refused with a message; that is the time to move to
a paid plan, which also brings Supabase's own daily backups.

## Going back

**Screens only** (a new screen misbehaves): Netlify > Deploys > the deploy before the push >
"Publish deploy". It takes seconds and does not rebuild. Later pushes deploy normally again.

**A database update** (a migration): write a new migration that undoes it (see RELEASE.md). The
validation steps are append-only, so undoing a rule never removes what DEs, DPOs and schools recorded.

**The data itself** (only if data was lost or damaged), on a new, empty Supabase project:

    pg_restore -d "$NEW_DB_URL" --no-owner --data-only rivet-<date>-accounts.dump     # accounts first
    pg_restore -d "$NEW_DB_URL" --no-owner --clean --if-exists rivet-<date>.dump      # then RIVET

Use Postgres 17's `pg_restore`. Compare the row counts with `rivet-<date>-counts.txt`, then point
GitHub's `SUPABASE_DB_URL` and `SUPABASE_SECRET_KEY` and Netlify's `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` at the new project, and set its Authentication > URL Configuration > Site URL
to the Netlify address. Upload the CO xlsx files to its `co-files` bucket again from the office drive.

## Settings kept outside the code

The values live only in GitHub and Netlify, never here; these are the names to set again on a new project.

- GitHub > Settings > Environments > `validation`: `SUPABASE_DB_URL` (session pooler, password of
  letters and digits only), `SUPABASE_SECRET_KEY` (`sb_secret_...`).
- Netlify site (base directory `web`): `VITE_SUPABASE_URL` (no path), `VITE_SUPABASE_ANON_KEY`.
- Supabase: Authentication > URL Configuration > Site URL = the Netlify address; private bucket `co-files`.
