#!/usr/bin/env python3
"""Domestique auto-collector — official letour.fr source.

PCS (scripts/collect_stage.py) is reliably 403'd at the Cloudflare edge when
fetched from GitHub Actions' IP (confirmed by probing from that exact
environment — see probe-sources.yml). letour.fr, the OFFICIAL Tour de France
site, is NOT blocked from that IP and server-renders the full stage
classification in plain HTML (no JS needed) — this script scrapes that
instead and emits the same Domestique `stageResult` block.

Trade-off vs the PCS collector: letour.fr's stage-ranking page gives
finishing order + team + gap cleanly, but not sprint/mountain POINTS, GC
position, or jerseys (no discoverable GC/points/jersey page on the same
plain-HTML surface) — so this block never carries sprintPts/mtnPts/gcPos/
jerseys/dnf/dns. Finishing order + gap is the largest single driver of xG
(§ placementGrowth, expectedPlacement), so this is a solid primary result
source; layer a manual jerseys/GC/points correction on top if you want the
full picture for a given day.

Usage:
  python collect_stage_letour.py --stage 7 --out data
  python collect_stage_letour.py --stage 7 --print   # preview, no write
"""
from __future__ import annotations
import argparse, json, os, re, sys, time

import requests
from selectolax.parser import HTMLParser

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# Stage 1 is the only 2026 TTT (engine/stages.ts) — same result for every
# rider on a placing team, letour.fr's per-rider gap doesn't carry that shape.
TTT_STAGES = {1}


def slug_to_name(href: str) -> str:
    """'/en/rider/2/uae-team-emirates-xrg/isaac-del-toro-romero' → 'Isaac Del Toro Romero'."""
    slug = href.rstrip('/').split('/')[-1]
    return ' '.join(w.capitalize() for w in slug.split('-'))


def parse_time_to_seconds(text: str) -> int | None:
    """'03h 40\\' 01\\'\\'' or '40\\' 04\\'\\'' or '- 0\\'\\'\\''-style strings → total seconds."""
    if not text or text.strip() in ('-', ''):
        return None
    h = re.search(r"(\d+)h", text)
    m = re.search(r"(\d+)'", text)
    s = re.search(r"(\d+)''", text)
    if not (h or m or s):
        return None
    return (int(h.group(1)) * 3600 if h else 0) + (int(m.group(1)) * 60 if m else 0) + (int(s.group(1)) if s else 0)


def fetch(stage_no: int) -> str:
    url = f"https://www.letour.fr/en/rankings/stage-{stage_no}"
    last_exc = None
    for attempt in range(3):
        if attempt:
            time.sleep(3 * attempt)
        try:
            resp = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            if resp.status_code == 200 and 'rankingTables__row' in resp.text:
                return resp.text
            last_exc = RuntimeError(f"HTTP {resp.status_code}, {len(resp.text)} bytes, no ranking rows")
        except requests.RequestException as e:
            last_exc = e
    raise RuntimeError(f"letour.fr fetch for stage {stage_no} failed: {last_exc}")


def collect(stage_no: int) -> dict:
    html = fetch(stage_no)
    tree = HTMLParser(html)
    rows = tree.css('.rankingTables__row')
    if not rows:
        raise RuntimeError(f"no ranking rows found for stage {stage_no} (page structure changed?)")

    is_ttt = stage_no in TTT_STAGES
    parsed = []
    for row in rows:
        pos_el = row.css_first('.rankingTables__row__position span')
        name_a = row.css_first('.rankingTables__row__profile--name')
        team_a = row.css_first('td.team a')
        time_tds = row.css('td.is-alignCenter.time')
        if not pos_el or not name_a or not time_tds:
            continue
        pos = int(pos_el.text(strip=True))
        name = slug_to_name(name_a.attributes.get('href', ''))
        team = team_a.text(strip=True) if team_a else None
        secs = parse_time_to_seconds(time_tds[0].text(strip=True))
        parsed.append({"pos": pos, "rider": name, "team": team, "seconds": secs})

    parsed.sort(key=lambda r: r["pos"])
    leader_secs = next((r["seconds"] for r in parsed if r["pos"] == 1 and r["seconds"] is not None), None)

    results = []
    for r in parsed:
        row = {"rider": r["rider"], "pos": r["pos"]}
        if leader_secs is not None and r["seconds"] is not None and r["pos"] > 1:
            gap = r["seconds"] - leader_secs
            if gap > 0:
                row["gap"] = gap
        results.append(row)

    block: dict = {
        "type": "stageResult",
        "stage": stage_no,
        "results": results,
        "_source": f"letour.fr:rankings/stage-{stage_no}",
        "_note": ("no sprint/mtn points, GC position or jerseys from this source — "
                  "finishing order + gap only; add those manually if you want the full picture"),
    }
    if is_ttt:
        # CONFIRMED (by inspecting the actual stage-1 page): letour.fr's
        # "stage-N" ranking page for a TTT lists individual GC/finish times,
        # interleaved across teams (a team's 8 riders are NOT consecutive
        # rows) — there is no reliable way to derive the true team order
        # from it. Guessing from first-appearance order would silently ship
        # a plausible-looking but unverified tttTeamOrder, which drives real
        # payout math (engine/resultLogger.ts). Flag it instead: the app
        # still handles a TTT fine without tttTeamOrder (falls back to
        # teamStrength, or paste pre-stage team odds — see the TTT odds
        # feature), just paste the confirmed team order by hand if you have it.
        block["isTTT"] = True
        block["_note"] += (
            " | TTT: tttTeamOrder omitted — letour.fr's stage-1 page lists individual "
            "times interleaved across teams, not grouped by team, so it can't be "
            "reliably derived here. Add tttTeamOrder by hand if you have the confirmed order."
        )
    else:
        top3, seen = [], set()
        for r in parsed:
            if r["team"] and r["team"] not in seen:
                seen.add(r["team"]); top3.append(r["team"])
            if len(top3) >= 3:
                break
        block["teamResultTop3"] = top3
    return block


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, required=True)
    ap.add_argument("--out", default=None, help="directory to write stage-N.json + latest.json")
    ap.add_argument("--print", action="store_true", dest="do_print")
    args = ap.parse_args()

    block = collect(args.stage)
    text = json.dumps(block, ensure_ascii=False, indent=2)

    if args.do_print or not args.out:
        print(text)
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, f"stage-{args.stage}.json"), "w", encoding="utf-8") as f:
            f.write(text)
        with open(os.path.join(args.out, "latest.json"), "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote stage-{args.stage}.json and latest.json to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
