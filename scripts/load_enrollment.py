#!/usr/bin/env python3
"""Load LIS school-level enrollment by grade (public schools only).

    DATABASE_URL=postgresql://... python3 scripts/load_enrollment.py SY2024-2025 "LIS BOSY, generated as of 30 January 2025" FILE.xlsx
    DATABASE_URL=postgresql://... python3 scripts/load_enrollment.py auto FILE.xlsx
    python3 scripts/load_enrollment.py --check FILE.xlsx      (prints the columns found and the totals; loads nothing)

With "auto", the school year is read from the file name ("SY 2018-2019 ...") and the source from
LIS's own line in the file ("Based on LIS, as of January 5, 2020").

The file is LIS's "School level data on enrollment in all grade levels", any year from SY 2018-2019.
LIS changes the layout from year to year (strands, modalities, subtotals, header row), so columns
are found by their header names, not their position:
  - Male and female are added per grade; subtotal and total columns (Kto6, JHS, G11 Total, ...) are
    skipped, and every SHS strand column is added into Grade 11 or 12.
  - SY 2020-2021 lists each grade once per learning modality; the modalities are added up.
  - Non-graded (SNEd) learners go to es_ng or jhs_ng; Year 5 (SY 2018-2019) goes to jhs_ng.
  - Schools of the divisions now in the Negros Island Region are left out.
A load stops if a grade has no column, so a layout RIVET does not know is never half-read.
Blank stays blank (null), never 0.

Needs openpyxl and psql on the PATH. Uses the service role's connection; never run it from the website.
"""

import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

import openpyxl

GRADES = ["kinder"] + [f"g{g}" for g in range(1, 13)] + ["es_ng", "jhs_ng"]
REQUIRED = ["kinder"] + [f"g{g}" for g in range(1, 13)]
ID_NAMES = {"school id", "school_id", "beis school id"}
# Region VII divisions that moved to the Negros Island Region (RA 12000, 2024). RIVET has no SDO for them.
NIR = {"Bais City", "Bayawan City", "Canlaon City", "Dumaguete City", "Guihulngan City",
       "Negros Oriental", "Siquijor", "Tanjay City"}


def grade_of(header):
    """The grade a column counts, or None for identity, subtotal and total columns."""
    h = re.sub(r"[^a-z0-9]", "", str(header).lower())
    if "female" in h:
        h = h.replace("female", "", 1)
    elif "male" in h:
        h = h.replace("male", "", 1)
    else:
        return None
    if "total" in h or re.search(r"\dto\d|kto", h) or re.search(r"g1[12]acad$", h):
        return None
    m = re.search(r"g(\d{1,2})", h)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"g{int(m.group(1))}"
    if "jhsng" in h or "ngsecon" in h or re.search(r"y5$", h):
        return "jhs_ng"
    if "elemng" in h or "ngelem" in h or h == "ng":
        return "es_ng"
    if h.endswith("k") or h.endswith("kinder"):
        return "kinder"
    return None


def read(path):
    """(rows, columns by grade, identity columns, header row number)."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    for hi, row in enumerate(rows[:12]):
        names = [str(c).strip() if c is not None else "" for c in row]
        if "Division" in names and any(n.lower() in ID_NAMES for n in names):
            break
    else:
        sys.exit(f"{os.path.basename(path)}: no header row with Division and School ID in the first 12 rows.")
    need = {"Division": names.index("Division"),
            "School ID": next(j for j, n in enumerate(names) if n.lower() in ID_NAMES),
            "Sector": names.index("Sector")}
    cols = {g: [] for g in GRADES}
    for j, name in enumerate(names):
        g = grade_of(name) if j > need["Sector"] else None
        if g:
            cols[g].append(j)
    missing = [g for g in REQUIRED if not cols[g]]
    if missing:
        sys.exit(f"{os.path.basename(path)}: no column for {', '.join(missing)}. LIS's layout changed; update grade_of().")
    return rows, cols, need, hi + 1, names


def num(v):
    if v is None or (isinstance(v, str) and (not v.strip() or v.startswith("="))):
        return None
    return int(round(float(str(v).replace(",", ""))))


def schools(rows, cols, need, header_row):
    skipped = 0
    for i, row in enumerate(rows[header_row:], start=header_row + 1):
        sid = row[need["School ID"]]
        if sid is None or not str(sid).strip().split(".")[0].isdigit() or row[need["Sector"]] != "Public":
            continue
        division = str(row[need["Division"]]).strip()
        if division in NIR:
            skipped += 1
            continue
        grades = {}
        for grade, cs in cols.items():
            vals = [num(row[c]) for c in cs if c < len(row)]
            grades[grade] = None if all(v is None for v in vals) else sum(v or 0 for v in vals)
        yield i, {"School ID": str(sid).strip().split(".")[0].zfill(6), "Division": division, "grades": grades}
    print(f"  left out {skipped} public schools of the Negros Island Region divisions")


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--check":
        rows, cols, need, hr, names = read(sys.argv[2])
        print(f"header row {hr}; " + "; ".join(f"{g}: {len(c)} col(s), e.g. {names[c[0]]!r}" for g, c in cols.items() if c))
        total, n = {}, 0
        for _, rec in schools(rows, cols, need, hr):
            n += 1
            for g, v in rec["grades"].items():
                total[g] = total.get(g, 0) + (v or 0)
        print(f"{n} public schools; learners {sum(total.values()):,}; " + ", ".join(f"{g} {v:,}" for g, v in total.items()))
        return
    if len(sys.argv) == 3 and sys.argv[1] == "auto" and "DATABASE_URL" in os.environ:
        path = sys.argv[2]
        m = re.search(r"SY ?(\d{4})-(\d{4})", os.path.basename(path))
        if not m:
            sys.exit(f"{os.path.basename(path)}: no school year (SY 2018-2019) in the file name.")
        year = f"SY{m.group(1)}-{m.group(2)}"
    elif len(sys.argv) == 4 and "DATABASE_URL" in os.environ:
        year, source, path = sys.argv[1:]
    else:
        sys.exit(__doc__)
    rows, cols, need, hr, _ = read(path)
    if sys.argv[1] == "auto":
        line = next((str(r[0]) for r in rows[:5] if r and r[0] and "LIS" in str(r[0])), None)
        source = re.sub(r"^Based on\s*", "", re.sub(r"\s+", " ", line)).strip() if line else "LIS"

    n = 0
    with tempfile.TemporaryDirectory() as tmp:
        staged = os.path.join(tmp, "lis.csv")
        with open(staged, "w", newline="", encoding="utf-8") as out:
            w = csv.writer(out)
            for i, rec in schools(rows, cols, need, hr):
                w.writerow(["LIS", i, json.dumps(rec)])
                n += 1
        sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
        name = os.path.basename(path).replace("'", "''")
        print(f"{year}: {n} public schools from {os.path.basename(path)} ({source})")
        subprocess.run(["psql", os.environ["DATABASE_URL"], "-X", "-q", "-v", "ON_ERROR_STOP=1",
                        "-c", "begin;",
                        "-c", f"\\copy co_staging (co_table, source_row, rec) from '{staged}' with (format csv)",
                        "-c", f"select load_enrollment('{year}', '{source.replace(chr(39), chr(39) * 2)}', '{name}', '{sha}');",
                        "-c", "commit;"], check=True)
    print("Loaded.")


if __name__ == "__main__":
    main()
