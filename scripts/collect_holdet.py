#!/usr/bin/env python3
"""Collect Holdet (Tourspillet) fantasy data → a Domestique `features` block.

Holdet's fantasy backend is the public swush API at https://api.holdet.dk, which
is FREE but namespaced by an `appid` GUID (one per partner site). It exposes the
two things the model can't get from ProCyclingStats: the official **price** and
the **ownership %** (popularity) of every rider — price drives value-per-million,
ownership drives differential strategy.

ONE-TIME SETUP — get the appid (10 seconds, no login):
  1. Open the Tourspillet game on holdet.dk in Chrome.
  2. DevTools → Network → filter "api.holdet.dk".
  3. Any request URL ends with `?appid=<GUID>` (and has game/round ids). Copy the
     GUID, and the game + round ids from the catalog request.
  Then pass them below (or set HOLDET_APPID / HOLDET_GAME / HOLDET_ROUND env vars).

Usage (Windows): set PYTHONUTF8=1 first.
  py -3 scripts/collect_holdet.py --appid <GUID> --game <id> --round <id>
  py -3 scripts/collect_holdet.py --discover --appid <GUID>   # list games/rounds

Output: data/holdet_features.json — a {type:"features", riders:[...]} block with
price + ownershipPct, ready to paste into Stages & Data → ① Import. Rider names
are matched fuzzily by the app, so they line up with the PCS-derived features.
"""
from __future__ import annotations
import argparse, json, os, sys
import requests

API = "https://api.holdet.dk"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "holdet_features.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"


def get(path: str, appid: str, **params) -> object:
    params["appid"] = appid
    r = requests.get(f"{API}/{path.lstrip('/')}", params=params,
                     headers={"User-Agent": UA, "Accept": "application/json"}, timeout=30)
    r.raise_for_status()
    return r.json()


def discover(appid: str) -> None:
    """Print the games (and their tournaments/rounds) visible to this appid."""
    games = get("catalog/games", appid)
    if not games:
        print("No games returned — the appid is probably wrong. Re-check DevTools.", file=sys.stderr)
        return
    for g in games:
        print(f"game {g.get('id')}: {g.get('name')}")
        for t in g.get("tournaments", []) or []:
            print(f"  tournament {t.get('id')}: {t.get('name')}")
            for rnd in t.get("rounds", []) or []:
                print(f"    round {rnd.get('id')}: {rnd.get('name')}")


def _num(*vals):
    for v in vals:
        if isinstance(v, (int, float)):
            return v
    return None


def collect(appid: str, game: str, rnd: str) -> dict:
    """Fetch the round's player catalog and map to a features block.

    The swush player object shape varies a little by game; we read defensively:
    a rider's display name, current `value`/`price` (DKK) and `popularity`/
    ownership (0..1 or 0..100). Adjust the key names here if your --discover dump
    shows different fields.
    """
    # Common swush endpoint for a round's player stats; falls back to tournament.
    data = get(f"games/{game}/rounds/{rnd}/statistics", appid)
    players = data if isinstance(data, list) else data.get("players", data.get("items", []))

    riders = []
    for p in players:
        person = p.get("person", p)
        name = person.get("name") or p.get("name")
        if not name:
            continue
        price = _num(p.get("value"), p.get("price"), (p.get("values") or {}).get("value"))
        pop = _num(p.get("popularity"), p.get("ownership"), p.get("popularityPercentage"))
        if pop is not None and pop <= 1:      # 0..1 → percent
            pop *= 100
        row = {"rider": name}
        if price is not None:
            row["price"] = int(round(price))
        if pop is not None:
            row["ownershipPct"] = round(pop, 1)
        riders.append(row)
    return {"type": "features", "asOf": None, "riders": riders}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--appid", default=os.environ.get("HOLDET_APPID"))
    ap.add_argument("--game", default=os.environ.get("HOLDET_GAME"))
    ap.add_argument("--round", default=os.environ.get("HOLDET_ROUND"))
    ap.add_argument("--discover", action="store_true", help="list games/rounds for the appid")
    a = ap.parse_args()
    if not a.appid:
        ap.error("missing --appid (grab the GUID from DevTools → Network → api.holdet.dk).")
    if a.discover:
        discover(a.appid)
        return
    if not (a.game and a.round):
        ap.error("need --game and --round (run --discover first).")
    block = collect(a.appid, a.game, a.round)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(block, f, ensure_ascii=False, indent=1)
    print(f"Wrote {len(block['riders'])} riders to {os.path.relpath(OUT, ROOT)} "
          f"({sum('price' in r for r in block['riders'])} priced, "
          f"{sum('ownershipPct' in r for r in block['riders'])} with ownership).")


if __name__ == "__main__":
    main()
