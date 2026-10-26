#!/usr/bin/env python3
"""Load CO's school-level NSBI tables for an earlier school year (SY 2022-2023 onwards).

    DATABASE_URL=postgresql://... python3 scripts/load_co_past_years.py SY2023-2024 FILE.xlsx [FILE.xlsx ...]
    python3 scripts/load_co_past_years.py --check FILE.xlsx [...]   (prints each column's key; loads nothing)

Each file is recognised by its name: buildings by condition (BLD), number of classrooms (CLS),
temporary learning spaces (T3), WATSAN (T4), furniture (T5), other facilities (T6) and access going
to school (T7). CO's layout differs from year to year, with group headings over two to four rows,
so a column is read by its full heading (group, item and level), never by its position, and is given
the same key as the SY 2024-2025 tables so a report can set the years side by side:
  - Levels as CO gives them: ES, and JHS and SHS where CO splits them (often as fractions of a
    count shared by both, split by enrollment, as in SY 2024-2025), else Secondary (ss). Where a
    file has Secondary beside JHS and SHS, Secondary is their sum and is left out.
  - Kindergarten furniture is one count per school, as in SY 2024-2025.
  - Other facilities (T6) are yes (1) or no (0) per level, and per school (1 if either level has it);
    CO's Roofing is RIVET's pathway cover.
  - Buildings by condition are keyed by RIVET's condition names, plus Total.
A heading the loader does not recognise is kept only with the cells, and --check lists it, so a
new layout is seen before it is loaded. A file whose Region column is not Region VII stops the load.
Schools of the divisions now in the Negros Island Region are left out.

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

TABLES = [  # (code, file name pattern)
    ("BLD", r"BUILDINGS? BY CONDITION"),
    ("CLS", r"CLASSROOM"),
    ("T3", r"TEMPORARY LEARNING|\bTLS\b"),
    ("T4", r"WATSAN|WATER AND SANITATION"),
    ("T5", r"FURNITURE"),
    ("T6", r"OTHER FACILITIES"),
    ("T7", r"ACCESS GOING"),
]
ID_HEADERS = {
    "School ID": ("lis school id",),
    "Division": ("division",),
    "School Name": ("school name",),
    "District": ("district",),
    "Municipality": ("municipality", "city/municipality"),
    "Province": ("province",),
}
NIR = {"Bais City", "Bayawan City", "Canlaon City", "Dumaguete City", "Guihulngan City",
       "Negros Oriental", "Siquijor", "Tanjay City"}
CONDITIONS = ["Good Condition", "Needs Minor Repair", "Needs Major Repair", "For Completion",
              "On-going Construction", "For Condemnation", "Condemned / For Demolition"]

# Item patterns per table, first match wins, tested on the column's full heading (lower case).
ITEMS = {
    "CLS": [(r"non-instructional", "noninstructional_rooms"), (r"instructional", "instructional_rooms")],
    "T3": [(r"classes.*makeshift", "makeshift_classes"), (r"classes.*temporary", "tls_classes"),
           (r"makeshift", "makeshift_count"), (r"temporary learning", "tls_count")],
    "T4": [(r"non-?functional|nunfunc", "nonfunc_toilet"), (r"female", "func_toilet_female"),
           (r"(?<![a-z])male", "func_toilet_male"), (r"pwd", "func_toilet_pwd"), (r"shared", "func_toilet_shared"),
           (r"trough|urithrough", "urinal_trough"), (r"urinal", "urinal"), (r"sink", "sink"),
           (r"septic", "septic_tank"), (r"without water|wo_water", "faucet_without_water"),
           (r"with water|w_water", "faucet_with_water")],
    "T5": [(r"kinder modular", "num_kinder_modtable"), (r"kinder chair", "num_kinder_chair"),
           (r"arm ?chair", "num_armchair"), (r"school desk", "num_schooldesk"),
           (r"other classroom table", "num_otherclasstable"), (r"other classroom chair", "num_otherclasschair"),
           (r"2-seater", "num_newtnc"), (r"total seat", "total_seat")],
    "T6": [(r"covered court", "covered_court"), (r"gymnasium", "gymnasium"), (r"entrance gate", "entrance_gate"),
           (r"exit gate", "exit_gate"), (r"permanent", "permanent_fence"), (r"temporary", "temporary_fence"),
           (r"flood marker", "flood_marker"), (r"playground", "playground"), (r"school garden", "school_garden"),
           (r"solar", "solar_panel"), (r"bike", "bike_racks"), (r"paved pathway", "paved_pathway"),
           (r"roofing", "pathway_cover")],
    "T7": [(r"unpaved", "is_road_unpaved"), (r"paved", "is_road_paved"), (r"unlevelled|rough", "is_road_unlevelled"),
           (r"levelled", "is_road_levelled"), (r"on-?going", "is_road_ongoing_construction"), (r"(?<![a-z])none", "is_road_none"),
           (r"4-wheel|fourwheel", "is_trans_prvtfourwheel"), (r"motorcycle", "is_trans_prvtmotorcycle"),
           (r"boat", "is_trans_boat"), (r"uv ?express", "is_trans_uvexpress"), (r"pedicab", "is_trans_pedicab"),
           (r"tricycle", "is_trans_tricycle"), (r"jeepney", "is_trans_jeepney"), (r"habal", "is_trans_habal"),
           (r"train", "is_trans_train"), (r"(?<![a-z])bus", "is_trans_bus"), (r"biking", "is_trans_bike"),
           (r"walk", "is_trans_walkhike")],
}
KINDER = ("num_kinder_modtable", "num_kinder_chair")
SKIP = r"ratio|grand total|(?<![a-z])watsan(?![a-z])"


def level_of(text):
    t = text.lower()
    if re.search(r"(?<![a-z])(k to 12|total)(?![a-z])", t) and not re.search(r"total seat", t):
        return "total"
    for pat, lvl in ((r"(?<![a-z])(es|elementary)(?![a-z])", "es"), (r"(?<![a-z])(ss|secondary)(?![a-z])", "ss"),
                     (r"(?<![a-z])jhs(?![a-z])", "jhs"), (r"(?<![a-z])shs(?![a-z])", "shs")):
        if re.search(pat, t):
            return lvl
    return None


def table_of(path):
    name = os.path.basename(path).upper()
    for code, pat in TABLES:
        if re.search(pat, name):
            return code
    sys.exit(f"Cannot tell which NSBI table {os.path.basename(path)} is")


def text(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).replace("\n", " ").strip() or None


def number(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def headings(rows, hr):
    """Each column's heading parts, top to bottom: group headings carry right until the next one
    in the same row or in a row above (merged cells keep their text in the first column only)."""
    width = max(len(r) for r in rows[:hr])
    carry, out = {}, []
    for c in range(width):
        parts = []
        for ri in range(hr):
            v = rows[ri][c] if c < len(rows[ri]) else None
            v = None if isinstance(v, (int, float)) else text(v)  # a totals row inside the heading rows
            if ri == hr - 1:
                parts.append(v or "")
                continue
            if c == 0:
                continue  # column A above the header holds the title lines
            if v:
                carry[ri] = v
                for below in range(ri + 1, hr):
                    carry.pop(below, None)
            if carry.get(ri):
                parts.append(carry[ri])
        out.append(parts)
    return out


def key_of(code, parts):
    """(key, level) for a measure column, or None."""
    leaf, full = parts[-1], " / ".join(parts).lower()
    if not leaf or re.search(SKIP, full):
        return None
    lvl = level_of(leaf)
    if lvl is None:  # SY 2022-2023 Table 7: the level is the row above CO's own field name
        lvl = next((level_of(p) for p in reversed(parts[:-1]) if level_of(p) and len(p) <= 12), None)
    if code == "BLD":
        hit = next((c for c in CONDITIONS if c.lower() == leaf.lower()), None)
        if hit:
            return hit, None
    if "enrollment" in full or (len(parts) == 1 or not any(parts[:-1])) and lvl:
        return ("enrollment", "k12" if lvl == "total" else lvl) if lvl else None
    if lvl in (None, "total"):
        return None
    for pat, base in ITEMS.get(code, []):
        if re.search(pat, full):
            if base == "num_newtnc":  # one group per level of the furniture, each split ES / JHS / SHS
                group = next((level_of(p) for p in parts[:-1] if "2-seater" in p.lower()), lvl)
                return base, "ss" if group in ("jhs", "shs") else group
            return base, lvl
    return None


def add(*vals):
    return None if all(v is None for v in vals) else sum(v or 0 for v in vals)


def collapse(measures, code):
    """One key per level, Kinder furniture per school, T6 per school."""
    out, parts = {}, {}
    for (base, lvl), v in measures.items():
        if lvl is None:
            out[base] = v
        elif base == "enrollment":
            out[f"{base}_{lvl}"] = v
        elif base in KINDER:
            out[base] = add(out.get(base), v)
        else:
            parts.setdefault(base, {})[lvl] = v
    for base, lv in parts.items():
        if "es" in lv:
            out[f"{base}_es"] = lv["es"]
        if "jhs" in lv or "shs" in lv:  # as in SY 2024-2025; a Secondary column beside them is their sum
            out[f"{base}_jhs"], out[f"{base}_shs"] = lv.get("jhs"), lv.get("shs")
        elif "ss" in lv:
            out[f"{base}_ss"] = lv["ss"]
        if code == "T6":
            vals = [out.get(f"{base}_es"), out.get(f"{base}_ss")]
            out[base] = None if all(x is None for x in vals) else int(any(x == 1 for x in vals))
    # CO splits a count shared by JHS and SHS into fractions by enrollment; whole counts stay whole.
    return {k: v if v is None or abs(v - round(v)) > 0.01 else int(round(v)) for k, v in out.items()}


def read(code, path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    hr = next((i + 1 for i, r in enumerate(rows[:12]) if any((text(c) or "").lower() == "lis school id" for c in r)), None)
    if not hr:
        sys.exit(f"{os.path.basename(path)}: no 'LIS School ID' heading in the first 12 rows.")
    heads = headings(rows, hr)
    names = [(h[-1] or "").lower() for h in heads]
    idcol = {k: next((j for j, h in enumerate(names) if h in alts), None) for k, alts in ID_HEADERS.items()}
    region = names.index("region") if "region" in names else None
    for k in ("School ID", "Division", "School Name"):
        if idcol[k] is None:
            sys.exit(f"{os.path.basename(path)}: no '{k}' column in row {hr}.")
    first = max(j for j in idcol.values() if j is not None)
    cols = {}
    for j, h in enumerate(heads):
        if j <= first:
            continue
        k = key_of(code, h)
        if k and code == "T4" and k[0] != "enrollment":
            full = " / ".join(h).lower()
            loc = "attached" if "attached" in full else "standalone" if re.search(r"stand-?\s?alone", full) else None
            k = (f"{loc}_{k[0]}", k[1]) if loc else None
        cols[j] = k
    return rows, hr, heads, idcol, region, cols


def stage(code, path, out):
    rows, hr, heads, idcol, region, cols = read(code, path)
    n = skipped = 0
    writer = csv.writer(out)
    for i, row in enumerate(rows[hr:], start=hr + 1):
        row = list(row) + [None] * (len(heads) - len(row))
        sid = text(row[idcol["School ID"]])
        if not sid or not sid.isdigit():
            continue
        if region is not None and text(row[region]) != "Region VII":
            sys.exit(f"{os.path.basename(path)} row {i}: Region is '{text(row[region])}', not Region VII. Wrong file?")
        rec = {k: text(row[j]) if j is not None else None for k, j in idcol.items()}
        if rec["Division"] in NIR:
            skipped += 1
            continue
        rec["School ID"] = sid.zfill(6)
        m = {}
        for j, k in cols.items():
            if k:
                v = number(row[j])
                m[k] = add(m[k], v) if k in m else v
        rec["measures"] = collapse(m, code)
        rec["cells"] = {f"{j + 1}:{' / '.join(p for p in heads[j] if p)}": text(v) for j, v in enumerate(row) if v is not None}
        writer.writerow([code, i, json.dumps(rec, ensure_ascii=False)])
        n += 1
    print(f"{code}: {n} schools from {os.path.basename(path)} (left out {skipped} of the Negros Island Region divisions)")
    return n


def check(path):
    code = table_of(path)
    rows, hr, heads, idcol, region, cols = read(code, path)
    print(f"== {os.path.basename(path)}: {code}, heading row {hr}")
    for j, k in cols.items():
        label = " / ".join(p for p in heads[j] if p)
        if heads[j][-1]:
            print(f"  c{j + 1}: {label[:90]!s:90}  -> {k[0] + ('_' + k[1] if k[1] else '') if k else '(cells only)'}")
    import io
    buf = io.StringIO()
    stage(code, path, buf)
    tot = {}
    for line in csv.reader(io.StringIO(buf.getvalue())):
        for k, v in json.loads(line[2])["measures"].items():
            if isinstance(v, (int, float)):
                tot[k] = tot.get(k, 0) + v
    print("  totals: " + ", ".join(f"{k} {round(v):,}" for k, v in tot.items()))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--check":
        for p in sys.argv[2:]:
            check(p)
        return
    if len(sys.argv) < 3 or "DATABASE_URL" not in os.environ:
        sys.exit(__doc__)
    cycle, files = sys.argv[1], sys.argv[2:]
    with tempfile.TemporaryDirectory() as tmp:
        script = []
        for path in files:
            code = table_of(path)
            staged = os.path.join(tmp, f"{code}.csv")
            with open(staged, "w", newline="", encoding="utf-8") as out:
                stage(code, path, out)
            name = os.path.basename(path).replace("'", "''")
            script.append(f"\\copy co_staging (co_table, source_row, rec) from '{staged}' with (format csv)")
            script.append(f"select load_co_school_table('{cycle}', '{code}', '{name}', '{sha256(path)}');")
        subprocess.run(["psql", os.environ["DATABASE_URL"], "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", "begin;"]
                       + sum((["-c", s] for s in script), []) + ["-c", "commit;"], check=True)
    print("Loaded.")


if __name__ == "__main__":
    main()
