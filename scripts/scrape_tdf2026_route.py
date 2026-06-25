#!/usr/bin/env python3
"""Fetch 2026 TdF per-stage difficulty (profile_score, vertical_meters, distance)
from PCS — available pre-race — and print a TS literal to paste into stages.ts."""
from __future__ import annotations
import json, time, requests
from procyclingstats import Stage

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def safe(fn, d=None):
    try:
        return fn()
    except Exception:
        return d


out = {}
for n in range(1, 22):
    rel = f"race/tour-de-france/2026/stage-{n}"
    html = requests.get("https://www.procyclingstats.com/" + rel,
                        headers={"User-Agent": UA}, timeout=30).text
    s = Stage(rel, html=html, update_html=False)
    out[n] = {
        "profileScore": safe(s.profile_score),
        "verticalMeters": safe(s.vertical_meters),
        "km": safe(s.distance),
    }
    print(f"// stage {n}: {out[n]}")
    time.sleep(1.0)

print("\n=== TS literal ===")
print("const TDF2026_DIFFICULTY: Record<number, { profileScore: number; verticalMeters: number }> = {")
for n in range(1, 22):
    d = out[n]
    ps = d["profileScore"] if d["profileScore"] is not None else 0
    vm = d["verticalMeters"] if d["verticalMeters"] is not None else 0
    print(f"  {n}: {{ profileScore: {ps}, verticalMeters: {vm} }},")
print("};")
