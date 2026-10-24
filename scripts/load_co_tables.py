#!/usr/bin/env python3
"""Load CO's raw NSBI Tables 1 and 2 into the database, exactly as released.

    DATABASE_URL=postgresql://... python3 scripts/load_co_tables.py SY2025-2026 TABLE1.xlsx TABLE2.xlsx

Each sheet row is staged as one JSON object keyed by CO's own column headers, then
load_co_table() copies it into co_buildings / co_rooms with a source load (file name and
SHA-256). Table 1 is loaded before Table 2 so every room finds its building. A cycle's tables
can be loaded only once: a second CO release is a deliberate migration.

Needs pandas and openpyxl, and psql on the PATH. Uses the service role's connection; never
run it from the website.
"""

import csv
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile

import pandas as pd

# Columns kept as text so codes and IDs keep their exact digits (and leading zeros).
TEXT_COLUMNS = ["School ID", "Mother School ID", "Building Code", "Room Code"]


def clean(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        return value.strip() or None
    return value


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stage(table, path, out):
    frame = pd.read_excel(path, dtype={c: str for c in TEXT_COLUMNS})
    frame.columns = [str(c).strip() for c in frame.columns]
    writer = csv.writer(out, quoting=csv.QUOTE_MINIMAL)
    for i, row in enumerate(frame.itertuples(index=False), start=2):  # sheet row number
        rec = {col: clean(v) for col, v in zip(frame.columns, row)}
        writer.writerow([table, i, json.dumps(rec, ensure_ascii=False)])
    return len(frame)


def main():
    if len(sys.argv) != 4 or "DATABASE_URL" not in os.environ:
        sys.exit(__doc__)
    cycle, t1, t2 = sys.argv[1:]
    url = os.environ["DATABASE_URL"]
    with tempfile.TemporaryDirectory() as tmp:
        script = []
        for table, path in (("T1", t1), ("T2", t2)):
            staged = os.path.join(tmp, f"{table}.csv")
            with open(staged, "w", newline="", encoding="utf-8") as out:
                n = stage(table, path, out)
            print(f"{table}: {n} rows from {os.path.basename(path)}")
            name = os.path.basename(path).replace("'", "''")
            script.append(f"\\copy co_staging (co_table, source_row, rec) from '{staged}' with (format csv)")
            script.append(f"select load_co_table('{cycle}', '{table}', '{name}', '{sha256(path)}');")
        subprocess.run(["psql", url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", "begin;"] +
                       sum((["-c", s] for s in script), []) + ["-c", "commit;"], check=True)
    print("Loaded.")


if __name__ == "__main__":
    main()
