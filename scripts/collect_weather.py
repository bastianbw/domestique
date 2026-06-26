#!/usr/bin/env python3
"""Domestique weather auto-collector.

Fetches the finish-line weather FORECAST for one Tour de France 2026 stage from
Open-Meteo (free, no API key) and writes a Domestique `weather` import block — the
exact optional schema the PWA reads. Run by the GitHub Action each morning during
the Tour for the day's upcoming stage, or by hand on any machine.

Honest notes:
- Open-Meteo's free forecast only reaches ~16 days ahead. Outside that window
  (e.g. testing months before the Tour) the API returns no usable daily row and
  this script emits nothing (graceful) rather than inventing numbers.
- Finish coordinates come from geocoding the baked finish-town names below, so no
  hand-entered lat/lon to get wrong. A town that fails to geocode is skipped.
- Weather only NUDGES the model and is fully optional; a day without a weather
  block behaves exactly as before.

Usage:
  python collect_weather.py --stage 8 --out data
  python collect_weather.py --stage 8 --print     # preview, no write
"""
from __future__ import annotations
import argparse, json, os, sys

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# Stage → (finish town for geocoding, ISO date). Towns/dates mirror engine/stages.ts.
STAGE_FINISH: dict[int, tuple[str, str]] = {
    1:  ("Barcelona, Spain",          "2026-07-04"),
    2:  ("Barcelona, Spain",          "2026-07-05"),
    3:  ("Les Angles, France",        "2026-07-06"),
    4:  ("Foix, France",              "2026-07-07"),
    5:  ("Pau, France",               "2026-07-08"),
    6:  ("Gavarnie-Gedre, France",    "2026-07-09"),
    7:  ("Bordeaux, France",          "2026-07-10"),
    8:  ("Bergerac, France",          "2026-07-11"),
    9:  ("Ussel, France",             "2026-07-12"),
    10: ("Le Lioran, France",         "2026-07-14"),
    11: ("Nevers, France",            "2026-07-15"),
    12: ("Chalon-sur-Saone, France",  "2026-07-16"),
    13: ("Belfort, France",           "2026-07-17"),
    14: ("Le Markstein, France",      "2026-07-18"),
    15: ("Plateau de Solaison, France", "2026-07-19"),
    16: ("Thonon-les-Bains, France",  "2026-07-21"),
    17: ("Voiron, France",            "2026-07-22"),
    18: ("Orcieres, France",          "2026-07-23"),
    19: ("Alpe d'Huez, France",       "2026-07-24"),
    20: ("Alpe d'Huez, France",       "2026-07-25"),
    21: ("Paris, France",             "2026-07-26"),
}

COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def compass(deg) -> str | None:
    if deg is None:
        return None
    return COMPASS[int((float(deg) + 22.5) // 45) % 8]


def gust_risk(gust_kph) -> str | None:
    if gust_kph is None:
        return None
    if gust_kph >= 60:
        return "high"
    if gust_kph >= 40:
        return "med"
    return "low"


def geocode(town: str):
    """Resolve a town name to (lat, lon) via Open-Meteo geocoding (free)."""
    name = town.split(",")[0].strip()
    r = requests.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": name, "count": 1, "language": "en", "format": "json"},
        headers={"User-Agent": UA}, timeout=30,
    )
    res = (r.json() or {}).get("results") or []
    if not res:
        return None
    return res[0]["latitude"], res[0]["longitude"]


def collect(stage_no: int) -> dict | None:
    if stage_no not in STAGE_FINISH:
        print(f"stage {stage_no} not in 2026 schedule", file=sys.stderr)
        return None
    town, date = STAGE_FINISH[stage_no]
    coords = geocode(town)
    if not coords:
        print(f"could not geocode finish '{town}'", file=sys.stderr)
        return None
    lat, lon = coords

    r = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat, "longitude": lon,
            "daily": ",".join([
                "temperature_2m_max", "precipitation_probability_max",
                "windspeed_10m_max", "windgusts_10m_max", "winddirection_10m_dominant",
            ]),
            "start_date": date, "end_date": date, "timezone": "Europe/Paris",
        },
        headers={"User-Agent": UA}, timeout=30,
    )
    daily = (r.json() or {}).get("daily") or {}

    def first(key):
        vals = daily.get(key) or []
        return vals[0] if vals and vals[0] is not None else None

    temp = first("temperature_2m_max")
    rain = first("precipitation_probability_max")
    wind = first("windspeed_10m_max")
    gust = first("windgusts_10m_max")
    wdir = first("winddirection_10m_dominant")

    if all(v is None for v in (temp, rain, wind, gust)):
        # Date is beyond the forecast horizon (or no data) — emit nothing.
        print(f"no forecast for stage {stage_no} on {date} (beyond ~16-day horizon?)", file=sys.stderr)
        return None

    block: dict = {"type": "weather", "stage": stage_no}
    if wind is not None: block["windKph"] = round(wind)
    if compass(wdir):    block["windDir"] = compass(wdir)
    if gust_risk(gust):  block["gustRisk"] = gust_risk(gust)
    if rain is not None: block["rainProb"] = round(rain)
    if temp is not None: block["tempC"] = round(temp)
    block["_source"] = f"open-meteo:{town}:{date}"
    return block


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, required=True)
    ap.add_argument("--out", default=None, help="directory to write weather-stage-N.json + weather-latest.json")
    ap.add_argument("--print", action="store_true", dest="do_print")
    args = ap.parse_args()

    block = collect(args.stage)
    if block is None:
        # Nothing to write — leave any existing files untouched.
        sys.exit(0)
    text = json.dumps(block, ensure_ascii=False, indent=2)

    if args.do_print or not args.out:
        print(text)
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, f"weather-stage-{args.stage}.json"), "w", encoding="utf-8") as f:
            f.write(text)
        with open(os.path.join(args.out, "weather-latest.json"), "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote weather-stage-{args.stage}.json and weather-latest.json to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
