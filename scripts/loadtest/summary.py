"""Summarise pgbench transaction logs from the Load test workflow: per stage and per screen,
how many screens opened, and how long they took (median, 95th percentile, slowest)."""
import glob
import os
import sys

SCREENS = {0: 'School page', 1: 'Division list', 2: 'Dashboard'}
STAGES = [('quiet', 1), ('c05', 5), ('c10', 10), ('c15', 15)]


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else None


def ms(x):
    return '-' if x is None else f'{x / 1000:,.0f} ms' if x < 10_000_000 else f'{x / 1e6:,.1f} s'


root = sys.argv[1]
print('| People at once | Screen | Opened | Median | 95% under | Slowest | Failed |')
print('|---|---|---|---|---|---|---|')
for stage, n in STAGES:
    rows = []
    for f in glob.glob(os.path.join(root, stage + '*')):
        for line in open(f):
            p = line.split()
            if len(p) >= 4:
                rows.append((int(p[3]), p[2]))
    if not rows:
        print(f'| {n} | (no data) | | | | | |')
        continue
    for sid, name in SCREENS.items():
        ok = [int(t) for s, t in rows if s == sid and t.isdigit()]
        bad = sum(1 for s, t in rows if s == sid and not t.isdigit())
        print(f'| {n} | {name} | {len(ok)} | {ms(pct(ok, 50))} | {ms(pct(ok, 95))} | {ms(max(ok) if ok else None)} | {bad} |')
