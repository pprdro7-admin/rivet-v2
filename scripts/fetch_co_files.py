#!/usr/bin/env python3
"""Download CO's xlsx files from a private Supabase Storage bucket.

    DATABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/fetch_co_files.py BUCKET FILE [FILE...] OUTDIR

The project is worked out from DATABASE_URL (the pooler user is postgres.<project ref>, a direct
connection's host is db.<project ref>.supabase.co), so the only extra secret is the key.
"""

import os
import sys
import urllib.parse
import urllib.request


def project_ref(db_url):
    parts = urllib.parse.urlsplit(db_url)
    user, host = parts.username or "", parts.hostname or ""
    if user.startswith("postgres."):
        return user.split(".", 1)[1]
    if host.startswith("db.") and host.endswith(".supabase.co"):
        return host.split(".")[1]
    sys.exit("Cannot tell the Supabase project from DATABASE_URL")


def main():
    if len(sys.argv) < 4 or "DATABASE_URL" not in os.environ or not os.environ.get("SUPABASE_SECRET_KEY"):
        sys.exit(__doc__)
    bucket, files, outdir = sys.argv[1], sys.argv[2:-1], sys.argv[-1]
    key = os.environ["SUPABASE_SECRET_KEY"].strip()
    base = f"https://{project_ref(os.environ['DATABASE_URL'])}.supabase.co/storage/v1/object"
    headers = {"apikey": key}
    if key.startswith("eyJ"):  # legacy service_role key, a JWT
        headers["Authorization"] = f"Bearer {key}"
    os.makedirs(outdir, exist_ok=True)
    for name in files:
        url = f"{base}/{urllib.parse.quote(bucket)}/{urllib.parse.quote(name)}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            sys.exit(f"Could not download {name} from bucket {bucket}: HTTP {e.code} {e.read()[:200]!r}")
        with open(os.path.join(outdir, name), "wb") as f:
            f.write(data)
        print(f"{name}: {len(data):,} bytes")


if __name__ == "__main__":
    main()
