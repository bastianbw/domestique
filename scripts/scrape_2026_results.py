#!/usr/bin/env python3
"""Scrape the 2026 race-results corpus from ProCyclingStats.

Backtest/calibration data layer for the Domestique prediction-model upgrade
(see docs/PREDICTION_MODEL_UPGRADE.md). Enumerates the 2026 calendar, then every
stage / one-day result, and writes one row per (race, stage, rider) plus per-stage
metadata used to classify our StageType and calibrate break-vs-bunch.

Honest notes / robustness:
- PCS blocks the default UA → we fetch HTML ourselves with a browser UA and hand
  it to the parser (same trick as collect_stage.py).
- Raw HTML is cached under data/historical/_cache so re-runs are cheap and the
  scrape is resumable; --throttle adds a polite delay on cache MISSES only.
- Datacenter IPs may be rate-limited; run locally. Partial output is valid.

Usage (Windows): set PYTHONUTF8=1 first.
  py -3 scripts/scrape_2026_results.py                 # all WorldTour 2026
  py -3 scripts/scrape_2026_results.py --max-races 3   # quick smoke test
  py -3 scripts/scrape_2026_results.py --calendar "races.php?year=2026&circuit=2"
"""
from __future__ import annotations
import argparse, json, os, re, sys, time, unicodedata
from typing import Optional

import requests
from procyclingstats import Stage

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST = os.path.join(ROOT, "data", "historical")
CACHE = os.path.join(HIST, "_cache")


def get_html(rel: str, throttle: float) -> str:
    """Fetch a PCS page, caching the HTML to disk. Throttle on cache miss only."""
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", rel)
    path = os.path.join(CACHE, safe + ".html")
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


def calendar_races(calendar_url: str, year: int, throttle: float) -> list[str]:
    html = get_html(calendar_url, throttle)
    slugs = re.findall(rf'href="(?:\.\./)?(race/[a-z0-9\-]+)/{year}', html)
    # stable de-dupe, drop obviously non-race anchors
    seen, out = set(), []
    for s in slugs:
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def stage_paths(slug: str, year: int, throttle: float) -> list[str]:
    """Return the result page paths for a race: stage-N pages, or a single
    one-day /result. Detected from the race overview HTML."""
    ov = get_html(f"{slug}/{year}/overview", throttle)
    stages = sorted(
        set(re.findall(rf"{re.escape(slug)}/{year}/(stage-\d+)", ov)),
        key=lambda s: int(s.split("-")[1]),
    )
    if stages:
        return [f"{slug}/{year}/{s}" for s in stages]
    # one-day race
    return [f"{slug}/{year}/result"]


def safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def scalar(x):
    """PCS sometimes returns a list (e.g. startlist quality). Take first number."""
    if isinstance(x, (list, tuple)):
        return x[0] if x else None
    return x


def our_type(stage_type: str, profile_icon: str) -> str:
    """Map PCS stage_type + profile icon (p1..p5) to our StageType."""
    st = (stage_type or "").upper()
    if st == "TTT":
        return "ttt"
    if st == "ITT":
        return "hilly_itt"
    p = (profile_icon or "").lower()
    if "p5" in p:
        return "high_mtn"
    if "p4" in p:
        return "summit"
    if "p3" in p:
        return "hilly"
    if "p2" in p:
        return "hilly"
    return "flat"


def scrape_stage(race: str, rel: str, throttle: float) -> Optional[dict]:
    html = get_html(rel, throttle)
    s = Stage(rel, html=html, update_html=False)
    results = safe(s.results, []) or []
    if not results:
        return None
    stage_type = safe(s.stage_type, "") or ""
    profile_icon = safe(s.profile_icon, "") or ""
    rows = []
    for r in results:
        rank = r.get("rank")
        rows.append({
            "rider": norm(r.get("rider_name", "")),
            "riderUrl": r.get("rider_url"),
            "bib": r.get("rider_number"),
            "team": r.get("team_name"),
            "rank": rank,
            "status": (r.get("status") or "DF"),
            "time": r.get("time"),
            "pcsPoints": r.get("pcs_points"),
            "breakawayKms": r.get("breakaway_kms"),
        })
    # match a stage number out of the rel (one-day → 0)
    m = re.search(r"stage-(\d+)", rel)
    stage_no = int(m.group(1)) if m else 0
    return {
        "race": race,
        "stage": stage_no,
        "url": rel,
        "date": safe(s.date),
        "distance": safe(s.distance),
        "stageType": stage_type,
        "profileIcon": profile_icon,
        "profileScore": safe(s.profile_score),
        "verticalMeters": safe(s.vertical_meters),
        "startlistQuality": scalar(safe(s.race_startlist_quality_score)),
        "isOneDay": bool(safe(s.is_one_day_race, stage_no == 0)),
        "ourType": our_type(stage_type, profile_icon),
        "results": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--calendar", default=None,
                    help="PCS calendar query (default: races.php?year=<year>)")
    ap.add_argument("--max-races", type=int, default=0, help="limit for smoke tests")
    ap.add_argument("--throttle", type=float, default=1.0,
                    help="seconds to sleep on cache MISS")
    args = ap.parse_args()
    year = args.year
    calendar = args.calendar or f"races.php?year={year}"
    out = os.path.join(HIST, f"results_{year}.json")

    os.makedirs(HIST, exist_ok=True)
    existing: dict[str, dict] = {}
    if os.path.exists(out):
        for s in json.load(open(out, encoding="utf-8")).get("stages", []):
            existing[s["url"]] = s

    races = calendar_races(calendar, year, args.throttle)
    if args.max_races:
        races = races[: args.max_races]
    print(f"[{year}] calendar: {len(races)} races", file=sys.stderr)

    stages = dict(existing)
    for i, slug in enumerate(races, 1):
        race_name = slug.split("/", 1)[1]
        try:
            paths = stage_paths(slug, year, args.throttle)
        except Exception as e:
            print(f"  [{i}/{len(races)}] {race_name}: overview FAILED {e!r}", file=sys.stderr)
            continue
        added = 0
        for rel in paths:
            if rel in stages:
                continue
            try:
                row = scrape_stage(race_name, rel, args.throttle)
                if row:
                    stages[rel] = row
                    added += 1
            except Exception as e:
                print(f"      {rel}: FAILED {e!r}", file=sys.stderr)
        print(f"  [{i}/{len(races)}] {race_name}: {len(paths)} pages, +{added} new",
              file=sys.stderr)
        dump(stages, year, out)  # checkpoint after every race

    dump(stages, year, out)
    print(f"DONE: {len(stages)} stage/result pages -> {out}", file=sys.stderr)


def dump(stages: dict, year: int, out: str):
    payload = {"season": year, "source": "procyclingstats",
               "stages": sorted(stages.values(), key=lambda s: (s["race"], s["stage"]))}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
