# Releasing a change

1. Work on a branch. Push it; GitHub runs every database check and builds the screens.
2. Merge to `main` when the checks are green. The "Update the validation database" workflow applies
   new migrations to the **validation** Supabase project. Try the change there.
3. Apply the same migration to **production** only after it was tried on validation. The tests are
   never run against a Supabase project (they create sample data).
4. Note the release in `CHANGELOG.md`.

Rolling back: write a new migration that undoes the change. Validation steps are append-only, so a
rollback never deletes what DEs and DPOs recorded.

# First-time setup of the validation site

1. Supabase: create a project (e.g. `rivet-validation`). Copy its connection string
   (Project Settings > Database > Connection string, URI, session pooler).
2. GitHub: Settings > Environments > New environment `validation`, add the secret `SUPABASE_DB_URL`.
   Run the "Update the validation database" workflow once, ticking "load the sample accounts".
3. Netlify: add a site from this repository with base directory `web`. Set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from Supabase > Project Settings > API.
4. Accounts: add each tester under Supabase > Authentication > Users, then give them a row in `profiles`
   (role and SDO).
5. CO data: load Tables 1 and 2 with `scripts/load_co_tables.py`, pointed at the validation project.
