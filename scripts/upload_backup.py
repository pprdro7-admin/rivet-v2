#!/usr/bin/env python3
"""Upload backup files to the private Supabase Storage bucket, under backups/.

    DATABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/upload_backup.py BUCKET FOLDER FILE [FILE...]

Same project and key rules as fetch_co_files.py. An existing file is never overwritten.
"""

import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from fetch_co_files import project_ref

LIMIT = 50 * 1024 * 1024  # the free plan's largest file


def main():
    if len(sys.argv) < 4 or "DATABASE_URL" not in os.environ:
        sys.exit(__doc__)
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not key:
        sys.exit("SUPABASE_SECRET_KEY is empty: add it to the GitHub environment 'validation'.")
    bucket, folder, files = sys.argv[1], sys.argv[2].strip("/"), sys.argv[3:]
    base = f"https://{project_ref(os.environ['DATABASE_URL'])}.supabase.co/storage/v1/object"
    headers = {"apikey": key, "Content-Type": "application/octet-stream", "x-upsert": "false"}
    if key.startswith("eyJ"):  # legacy service_role key, a JWT
        headers["Authorization"] = f"Bearer {key}"
    for path in files:
        size = os.path.getsize(path)
        if size > LIMIT:
            sys.exit(f"{path} is {size:,} bytes, over the 50 MB Storage limit; nothing uploaded for it.")
        name = f"{folder}/{os.path.basename(path)}"
        url = f"{base}/{urllib.parse.quote(bucket)}/{urllib.parse.quote(name)}"
        with open(path, "rb") as f:
            req = urllib.request.Request(url, data=f.read(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                r.read()
        except urllib.error.HTTPError as e:
            sys.exit(f"Could not upload {name}: HTTP {e.code} {e.read()[:200]!r}")
        print(f"{bucket}/{name}: {size:,} bytes")


if __name__ == "__main__":
    main()
