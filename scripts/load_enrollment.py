#!/usr/bin/env python3
"""Load LIS school-level enrollment by grade (public schools only).

    DATABASE_URL=postgresql://... python3 scripts/load_enrollment.py SY2024-2025 "LIS BOSY, generated as of 30 January 2025" FILE.xlsx

The file is LIS's "School level data on enrollment in all grade levels". Columns are found by their
headers (row 6), so a moved column stops the load instead of shifting values. Male and female are
added per grade; Grades 11 and 12 use LIS's own grade totals. Blank stays blank (null), never 0.

Needs openpyxl and psql on the PATH. Uses the service role's connection; never run it from the website.
"""

import csv
import hashlib
import json
import os
import subprocess
import sys
import tempfile

import openpyxl

HEADER_ROW, DATA_ROW = 6, 7
GRADES = {  # grade: the row-6 headers whose values are added
    "kinder": ["K Male", "K Female"],
    **{f"g{g}": [f"G{g} Male", f"G{g} Female"] for g in range(1, 11)},
    "es_ng": ["Elem NG Male", "Elem NG Female"],
    "jhs_ng": ["JHS NG Male", "JHS NG Female"],
}
TOTALS = {"g11": "Grade 11 Total", "g12": "Grade 12 Total"}  # row 3 group header; its third column is the total


def num(v):
    if v is None or (isinstance(v, str) and (not v.strip() or v.startswith("="))):
        return None
    return int(round(float(str(v).replace(",", ""))))


def main():
    if len(sys.argv) != 4 or "DATABASE_URL" not in os.environ:
        sys.exit(__doc__)
    year, source, path = sys.argv[1:]
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    groups, header = rows[2], [str(h).strip() if h is not None else "" for h in rows[HEADER_ROW - 1]]
    col = {}
    for grade, names in GRADES.items():
        col[grade] = []
        for name in names:
            if name not in header:
                sys.exit(f"No '{name}' column in row {HEADER_ROW}: LIS's layout changed; update GRADES.")
            col[grade].append(header.index(name))
    for grade, name in TOTALS.items():
        hit = [j for j, g in enumerate(groups) if g and str(g).strip() == name]
        if not hit or header[hit[0] + 2] != "Total":
            sys.exit(f"No '{name}' group with a Total column: LIS's layout changed.")
        col[grade] = [hit[0] + 2]
    need = {h: header.index(h) for h in ("Division", "BEIS School ID", "Sector")}

    n = 0
    with tempfile.TemporaryDirectory() as tmp:
        staged = os.path.join(tmp, "lis.csv")
        with open(staged, "w", newline="", encoding="utf-8") as out:
            w = csv.writer(out)
            for i, row in enumerate(rows[DATA_ROW - 1:], start=DATA_ROW):
                sid = row[need["BEIS School ID"]]
                if sid is None or not str(sid).strip().isdigit() or row[need["Sector"]] != "Public":
                    continue
                grades = {}
                for grade, cols in col.items():
                    vals = [num(row[c]) for c in cols]
                    grades[grade] = None if all(v is None for v in vals) else sum(v or 0 for v in vals)
                rec = {"School ID": str(sid).strip().zfill(6), "Division": str(row[need["Division"]]).strip(), "grades": grades}
                w.writerow(["LIS", i, json.dumps(rec)])
                n += 1
        sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
        name = os.path.basename(path).replace("'", "''")
        print(f"{n} public schools from {os.path.basename(path)}")
        subprocess.run(["psql", os.environ["DATABASE_URL"], "-X", "-q", "-v", "ON_ERROR_STOP=1",
                        "-c", "begin;",
                        "-c", f"\\copy co_staging (co_table, source_row, rec) from '{staged}' with (format csv)",
                        "-c", f"select load_enrollment('{year}', '{source.replace(chr(39), chr(39) * 2)}', '{name}', '{sha}');",
                        "-c", "commit;"], check=True)
    print("Loaded.")


if __name__ == "__main__":
    main()
