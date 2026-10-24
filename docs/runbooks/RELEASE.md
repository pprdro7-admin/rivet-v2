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
   The password in the connection string should be letters and digits only: symbols such as `@ # / ?`
   break the string ("failed to parse connection string").
3. Netlify: add a site from this repository with base directory `web`. Set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from Supabase > Project Settings > API.
4. Accounts: add each tester under Supabase > Authentication > Users, then give them a row in `profiles`
   (role and SDO). The site must be public on Netlify so people reach the sign-in page; the data stays
   behind each account and the database's per-SDO rules.
5. CO data: in Supabase > Storage, create a **private** bucket `co-files` and upload CO's Table 1 and
   Table 2 xlsx files. Add the project's secret key (Project Settings > API Keys, `sb_secret_...`) to the
   `validation` environment as `SUPABASE_SECRET_KEY`. Run the "Load CO's NSBI tables" workflow with the
   two file names. The files never go in this repository. Each cycle loads once.
6. Other NSBI tables (Tables 3, 4a/4b, 5, 7 and the number of classrooms by school): upload CO's xlsx
   files to the same `co-files` bucket and run the "Load CO's other NSBI tables" workflow, which defaults
   to the SY 2024-2025 file names. These are shown read-only on each school page, from the latest cycle
   CO has released each table for; they are not validated. Each table loads once per cycle.
7. Enrollment (for the Dashboard's classroom gap and priority schools): upload LIS's school-level
   enrollment xlsx to `co-files` and run the "Load LIS enrollment" workflow with its school year and
   source line. Until a file is loaded, the Dashboard says the classroom gap appears once enrollment is
   loaded. The latest school year loaded is used. Each school year and source loads once.
