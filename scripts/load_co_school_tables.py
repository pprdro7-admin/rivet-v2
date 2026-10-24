#!/usr/bin/env python3
"""Load CO's school-level NSBI tables (Tables 3, 4a/4b, 5, 7 and the classroom summary).

    DATABASE_URL=postgresql://... python3 scripts/load_co_school_tables.py SY2024-2025 FILE.xlsx [FILE.xlsx ...]

Each file is recognised by its name (TABLE 3, TABLE 4a&4b, TABLE 5, TABLE 7, NUMBER OF CLASSROOM).
Columns are read by position, as set out in the SY 2024-2025 import mapping registry (v0.2, section
5), and the header row is checked first so a changed CO layout stops the load instead of shifting
values. Blank cells stay blank (null), never 0. Every cell is also kept as CO wrote it.

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

ES_SS = ("es", "ss")
ES_JHS_SHS = ("es", "jhs", "shs")


def keys(start, base, levels):
    return [(start + i, f"{base}_{lvl}") for i, lvl in enumerate(levels)]


def watsan(loc, start):
    """Table 4a (attached to a building) or 4b (stand-alone), 26 columns from `start`."""
    out, col = [], start
    for sub in ("male", "female", "pwd", "shared"):
        out += keys(col, f"{loc}_func_toilet_{sub}", ES_JHS_SHS); col += 3
    for fac in ("nonfunc_toilet", "sink", "urinal", "urinal_trough", "septic_tank",
                "faucet_with_water", "faucet_without_water"):
        out += keys(col, f"{loc}_{fac}", ES_SS); col += 2
    return out


ENROLLMENT = lambda start: keys(start, "enrollment", ("es", "jhs", "shs", "k12"))  # noqa: E731

# table code: (file name marker, sheet, header row, first data row, identity header names,
#              measures [(column, key)] or None to take the keys from the header row itself,
#              header check [(column, expected start of header text)])
TABLES = {
    "T3": ("TABLE 3", None, 7, 8,
           keys(19, "tls_count", ES_SS) + keys(21, "tls_classes", ES_SS)
           + keys(23, "makeshift_count", ES_SS) + keys(25, "makeshift_classes", ES_SS),
           [(19, "es No. of Temporary"), (26, "ss No. of Classes")]),
    "T4": ("TABLE 4a&4b", None, 9, 10,
           ENROLLMENT(10) + watsan("attached", 14) + watsan("standalone", 40),
           [(14, "attchd_bldg_func_male_es"), (40, "stnd_alone_func_male_es"), (65, "stnd_alone_Faucet_wo")]),
    "T5": ("TABLE 5", "DB", 7, 8,
           ENROLLMENT(20) + [(c, None) for c in range(25, 42)] + keys(43, "total_seat", ES_JHS_SHS),
           [(25, "num_kinder_modtable"), (41, "num_newtnc_shs")]),
    "T7": ("TABLE 7", None, 8, 9,
           [(c, None) for c in range(19, 53)],
           [(19, "is_road_paved_es"), (52, "is_trans_walkhike_ss")]),
    "CLS": ("NUMBER OF CLASSROOM", None, 6, 7,
            ENROLLMENT(20) + keys(25, "instructional_rooms", ES_JHS_SHS)
            + keys(28, "noninstructional_rooms", ES_JHS_SHS),
            [(25, "ES"), (28, "ES")]),
}

ID_HEADERS = {
    "School ID": ("LIS SCHOOL ID", "School ID"),
    "Division": ("Division",),
    "School Name": ("School Name",),
    "District": ("District",),
    "Municipality": ("Municipality", "City/Municipality"),
    "Province": ("Province",),
}


def table_of(path):
    name = os.path.basename(path).upper()
    for code, spec in TABLES.items():
        if spec[0].upper() in name:
            return code
    sys.exit(f"Cannot tell which NSBI table {os.path.basename(path)} is")


def number(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else v
    try:
        f = float(str(v).replace(",", "").strip())
        return int(f) if f.is_integer() else f
    except ValueError:
        return str(v).strip()


def text(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip() or None


def stage(code, path, out):
    marker, sheet, header_row, data_row, measures, checks = TABLES[code]
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = None
    for i, row in enumerate(rows, start=1):
        if i == header_row:
            header = [text(c) or "" for c in row]
            for col, expected in checks:
                if not header[col - 1].startswith(expected):
                    sys.exit(f"{os.path.basename(path)}: column {col} is '{header[col - 1]}', "
                             f"expected '{expected}…'. CO's layout changed; update TABLES.")
            idcol = {}
            for key, names in ID_HEADERS.items():
                hit = [j for j, h in enumerate(header) if h in names]
                if key in ("School ID", "Division", "School Name") and not hit:
                    sys.exit(f"{os.path.basename(path)}: no '{names[0]}' column in row {header_row}")
                idcol[key] = hit[0] if hit else None
            measures = [(c, k or header[c - 1]) for c, k in measures]
            break
    n = 0
    writer = csv.writer(out, quoting=csv.QUOTE_MINIMAL)
    for i, row in enumerate(rows, start=header_row + 1):
        if i < data_row:
            continue
        row = list(row) + [None] * (len(header) - len(row))
        sid = text(row[idcol["School ID"]])
        if not sid or not sid.isdigit():
            continue  # totals and blank rows under the data
        rec = {key: text(row[j]) if j is not None else None for key, j in idcol.items()}
        rec["School ID"] = sid.zfill(6)
        rec["measures"] = {k: number(row[c - 1]) for c, k in measures}
        rec["cells"] = {f"{j + 1}:{header[j]}": text(v) for j, v in enumerate(row) if v is not None}
        writer.writerow([code, i, json.dumps(rec, ensure_ascii=False)])
        n += 1
    return n


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if len(sys.argv) < 3 or "DATABASE_URL" not in os.environ:
        sys.exit(__doc__)
    cycle, files = sys.argv[1], sys.argv[2:]
    with tempfile.TemporaryDirectory() as tmp:
        script = []
        for path in files:
            code = table_of(path)
            staged = os.path.join(tmp, f"{code}.csv")
            with open(staged, "w", newline="", encoding="utf-8") as out:
                n = stage(code, path, out)
            print(f"{code}: {n} schools from {os.path.basename(path)}")
            name = os.path.basename(path).replace("'", "''")
            script.append(f"\\copy co_staging (co_table, source_row, rec) from '{staged}' with (format csv)")
            script.append(f"select load_co_school_table('{cycle}', '{code}', '{name}', '{sha256(path)}');")
        subprocess.run(["psql", os.environ["DATABASE_URL"], "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", "begin;"]
                       + sum((["-c", s] for s in script), []) + ["-c", "commit;"], check=True)
    print("Loaded.")


if __name__ == "__main__":
    main()
