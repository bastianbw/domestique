#!/usr/bin/env python3
"""Scrape the multi-year rider-profile store from ProCyclingStats.

Reads the rider URLs that appear in data/historical/results_2026.json and, for
each, pulls the PCS specialty-points vector and per-season points/rank history.
The TS engine derives archetype + a baseline-strength prior from these (see
docs/PREDICTION_MODEL_UPGRADE.md §1A).

Resumable + HTML-cached + throttled, same as scrape_2026_results.py.

Usage (Windows): set PYTHONUTF8=1 first.
  py -3 scripts/scrape_rider_profiles.py
  py -3 scripts/scrape_rider_profiles.py --max 20   # smoke test
"""
from __future__ import annotations
import argparse, json, os, re, sys, time, unicodedata

import requests
from procyclingstats import Rider

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST = os.path.join(ROOT, "data", "historical")
CACHE = os.path.join(HIST, "_cache")
OUT = os.path.join(HIST, "riders.json")


def get_html(rel: str, throttle: float) -> str:
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", rel)
    path = os.path.join(CACHE, safe_name + ".html")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    if throttle:
        time.sleep(throttle)
    html = requests.get("https://www.procyclingstats.com/" + rel,
                        headers={"User-Agent": UA}, timeout=30).text
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return html


def norm(name: str) -> str:
    n = unicodedata.normalize("NFD", name or "")
    return "".join(c for c in n if unicodedata.category(c) != "Mn")


def safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def rider_urls() -> list[str]:
    """Union of rider URLs across every results_<year>.json corpus file."""
    urls, seen = [], set()
    for path in sorted(glob.glob(os.path.join(HIST, "results_*.json"))):
        data = json.load(open(path, encoding="utf-8"))
        for s in data.get("stages", []):
            for r in s.get("results", []):
                u = r.get("riderUrl")
                if u and u not in seen:
                    seen.add(u)
                    urls.append(u)
    return urls


def scrape_rider(rel: str, throttle: float) -> dict:
    html = get_html(rel, throttle)
    r = Rider(rel, html=html, update_html=False)
    # teams_history can include future contracted seasons; keep <= 2026.
    teams = [t for t in (safe(r.teams_history, []) or []) if (t.get("season") or 0) <= 2026]
    team_2026 = next((t["team_name"] for t in teams if t.get("season") == 2026), None)
    return {
        "url": rel,
        "name": norm(safe(r.name, "")),
        "nationality": safe(r.nationality),
        "speciality": safe(r.points_per_speciality, {}) or {},
        "seasonHistory": safe(r.points_per_season_history, []) or [],
        "team2026": team_2026,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--throttle", type=float, default=1.0)
    ap.add_argument("--max", type=int, default=0, help="limit for smoke tests")
    args = ap.parse_args()

    os.makedirs(HIST, exist_ok=True)
    existing: dict[str, dict] = {}
    if os.path.exists(OUT):
        for r in json.load(open(OUT, encoding="utf-8")).get("riders", []):
            existing[r["url"]] = r

    urls = rider_urls()
    if args.max:
        urls = urls[: args.max]
    print(f"{len(urls)} unique riders ({len(existing)} already cached)", file=sys.stderr)

    riders = dict(existing)
    done = 0
    for u in urls:
        if u in riders:
            continue
        try:
            riders[u] = scrape_rider(u, args.throttle)
        except Exception as e:
            print(f"  {u}: FAILED {e!r}", file=sys.stderr)
        done += 1
        if done % 25 == 0:
            dump(riders)
            print(f"  ...{done} scraped", file=sys.stderr)
    dump(riders)
    print(f"DONE: {len(riders)} riders -> {OUT}", file=sys.stderr)


def dump(riders: dict):
    payload = {"source": "procyclingstats",
               "riders": sorted(riders.values(), key=lambda r: r["url"])}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
