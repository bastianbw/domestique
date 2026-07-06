#!/usr/bin/env python3
"""Domestique auto-collector — official letour.fr source.

PCS (scripts/collect_stage.py) is reliably 403'd at the Cloudflare edge when
fetched from GitHub Actions' IP (confirmed by probing from that exact
environment — see probe-sources.yml). letour.fr, the OFFICIAL Tour de France
site, is NOT blocked from that IP and server-renders every classification in
plain HTML (no JS needed): the stage page embeds signed AJAX links (stable
across requests — not per-session tokens) to the individual/points/mountain/
youth rankings, both for the stage and general classification. This script
fetches the stage page once, extracts those links, and pulls:
  - stage finishing order + gap + team           (individual, stage tab)
  - sprint points earned THIS stage              (points, stage tab)
  - mountain points earned THIS stage            (climber, stage tab)
  - GC position (top 15) after this stage        (individual, general tab)
  - yellow/green/polka/white jersey holders      (leader of each general tab)
merged by letour's own numeric rider id (stable across all these pages —
more reliable than name-matching within the same site), then emits the same
Domestique `stageResult` block collect_stage.py does.

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

# Ranking-type codes from letour's own tab markup: i=individual, p=points,
# m=mountain/climber, j=youth; suffix e=stage(étape), g=general.
RANK_STAGE_POINTS = 'ipe'
RANK_STAGE_MOUNTAIN = 'ime'
RANK_GENERAL_GC = 'itg'
RANK_GENERAL_POINTS = 'ipg'
RANK_GENERAL_MOUNTAIN = 'img'
RANK_GENERAL_YOUTH = 'ijg'


def slug_to_name(href: str) -> str:
    """'/en/rider/2/uae-team-emirates-xrg/isaac-del-toro-romero' → 'Isaac Del Toro Romero'."""
    slug = href.rstrip('/').split('/')[-1]
    return ' '.join(w.capitalize() for w in slug.split('-'))


def rider_ref(href: str) -> str | None:
    """'/en/rider/11/team-visma-lease-a-bike/...' → '11' — letour's stable rider id."""
    m = re.search(r'/rider/(\d+)/', href)
    return m.group(1) if m else None


def parse_time_to_seconds(text: str) -> int | None:
    """'03h 40\\' 01\\'\\'' or '40\\' 04\\'\\''-style strings → total seconds."""
    if not text or text.strip() in ('-', ''):
        return None
    h = re.search(r"(\d+)h", text)
    m = re.search(r"(\d+)'", text)
    s = re.search(r"(\d+)''", text)
    if not (h or m or s):
        return None
    return (int(h.group(1)) * 3600 if h else 0) + (int(m.group(1)) * 60 if m else 0) + (int(s.group(1)) if s else 0)


def parse_points(text: str) -> int | None:
    """'25 PTS' → 25."""
    m = re.search(r'(\d+)\s*PTS', text or '', re.I)
    return int(m.group(1)) if m else None


def _get(url: str) -> requests.Response:
    last_exc = None
    for attempt in range(3):
        if attempt:
            time.sleep(3 * attempt)
        try:
            resp = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            if resp.status_code == 200:
                return resp
            last_exc = RuntimeError(f"HTTP {resp.status_code} from {url}")
        except requests.RequestException as e:
            last_exc = e
    raise RuntimeError(f"fetch failed for {url}: {last_exc}")


def fetch_stage_page(stage_no: int) -> str:
    resp = _get(f"https://www.letour.fr/en/rankings/stage-{stage_no}")
    if 'rankingTables__row' not in resp.text:
        raise RuntimeError(f"stage {stage_no} page has no ranking rows (page structure changed?)")
    return resp.text


def extract_ranking_urls(html: str) -> dict[str, str]:
    """Pull every `"<code>":"/en/ajax/ranking/.../<hash>/..."` link embedded in
    the page (HTML-entity-escaped JSON-ish blobs in `data-ajax-stack`
    attributes). Confirmed stable across separate requests — safe to reuse
    within one run without re-deriving per ranking type."""
    unescaped = html.replace('&quot;', '"').replace('\\/', '/')
    return dict(re.findall(r'"(\w+)":"(/en/ajax/ranking/\d+/\w+/[0-9a-f]+/\w+)"', unescaped))


def parse_ranking_rows(html: str) -> list[dict]:
    """Parse one ranking table's HTML into row dicts (pos, riderRef, name,
    team, cells, timeCells)."""
    tree = HTMLParser(html)
    out = []
    for row in tree.css('.rankingTables__row'):
        pos_el = row.css_first('.rankingTables__row__position span')
        name_a = row.css_first('.rankingTables__row__profile--name')
        if not pos_el or not name_a:
            continue
        href = name_a.attributes.get('href', '')
        team_a = row.css_first('td.team a')
        # `.is-alignCenter.time` cells are, in DOM order, [absolute time, gap
        # (usually "-"), bonus seconds, ...] — keep them separate from the
        # generic cell dump so absolute-time extraction is by FIXED POSITION,
        # not "first cell that parses as a time" (a bonus-seconds cell like
        # "B : 10''" parses just as validly as a real time and would be
        # silently picked up if it happened to come first).
        out.append({
            "pos": int(pos_el.text(strip=True)),
            "riderRef": rider_ref(href),
            "name": slug_to_name(href),
            "team": team_a.text(strip=True) if team_a else None,
            "cells": [c.text(strip=True) for c in row.css('td')],
            "timeCells": [c.text(strip=True) for c in row.css('td.is-alignCenter.time')],
        })
    return out


def fetch_ranking(urls: dict[str, str], code: str) -> list[dict]:
    """Fetch and parse one ranking tab by its AJAX code. Returns [] if the
    code isn't present (e.g. no youth classification exists yet) OR if the
    endpoint returns no rows — CONFIRMED (stage-1 TTT): the "stage individual"
    (`ite`) AJAX link embedded in `data-ajax-stack` returns an empty stub for
    a TTT stage, even though the SAME ranking is already correctly rendered
    in the initial page load. Callers needing the primary stage result must
    parse the initial page directly (see `collect()`) rather than relying on
    this for `ite` — this function is for the SECONDARY classifications only."""
    rel = urls.get(code)
    if not rel:
        return []
    html = _get(f"https://www.letour.fr{rel}").text
    return parse_ranking_rows(html)


def collect(stage_no: int) -> dict:
    page = fetch_stage_page(stage_no)
    urls = extract_ranking_urls(page)
    is_ttt = stage_no in TTT_STAGES

    # Primary results: parsed straight from the already-fetched initial page
    # (its default-active tab), NOT via the `ite` AJAX link — confirmed that
    # link returns nothing useful for a TTT stage even though this same
    # ranking is correctly pre-rendered in the initial HTML.
    stage_rows = parse_ranking_rows(page)
    if not stage_rows:
        raise RuntimeError(f"no individual-stage ranking rows for stage {stage_no}")
    stage_rows.sort(key=lambda r: r["pos"])
    for r in stage_rows:
        r["seconds"] = parse_time_to_seconds(r["timeCells"][0]) if r["timeCells"] else None
    leader_secs = next((r["seconds"] for r in stage_rows if r["pos"] == 1 and r["seconds"] is not None), None)

    sprint_pts = {r["riderRef"]: parse_points(r["cells"][-2]) for r in fetch_ranking(urls, RANK_STAGE_POINTS) if r["riderRef"]}
    mtn_pts = {r["riderRef"]: parse_points(r["cells"][-2]) for r in fetch_ranking(urls, RANK_STAGE_MOUNTAIN) if r["riderRef"]}
    gc_rows = fetch_ranking(urls, RANK_GENERAL_GC)
    gc_pos = {r["riderRef"]: r["pos"] for r in gc_rows if r["riderRef"] and r["pos"] <= 15}

    def leader_name(rows: list[dict]) -> str | None:
        for r in rows:
            if r["pos"] == 1:
                return r["name"]
        return None

    jerseys = {
        "yellow": leader_name(gc_rows),
        "green": leader_name(fetch_ranking(urls, RANK_GENERAL_POINTS)),
        "polka": leader_name(fetch_ranking(urls, RANK_GENERAL_MOUNTAIN)),
        "white": leader_name(fetch_ranking(urls, RANK_GENERAL_YOUTH)),
    }
    jerseys = {k: v for k, v in jerseys.items() if v}

    results = []
    for r in stage_rows:
        row: dict = {"rider": r["name"], "pos": r["pos"]}
        if leader_secs is not None and r["seconds"] is not None and r["pos"] > 1:
            gap = r["seconds"] - leader_secs
            if gap > 0:
                row["gap"] = gap
        if not is_ttt:
            sp = sprint_pts.get(r["riderRef"])
            if sp:
                row["sprintPts"] = sp
            mp = mtn_pts.get(r["riderRef"])
            if mp:
                row["mtnPts"] = mp
        gp = gc_pos.get(r["riderRef"])
        if gp:
            row["gcPos"] = gp
        results.append(row)

    block: dict = {
        "type": "stageResult",
        "stage": stage_no,
        "results": results,
        "jerseys": jerseys,
        "_source": f"letour.fr:rankings/stage-{stage_no}",
        "_note": "dnf/dns not available from this source — add by hand if any riders abandoned.",
    }
    if is_ttt:
        # CONFIRMED (by inspecting the actual stage-1 page): letour.fr's
        # individual-stage ranking for a TTT lists riders' own recorded times,
        # interleaved across teams (a team's 8 riders are NOT consecutive
        # rows) — there is no reliable way to derive the true team order from
        # it. Guessing from first-appearance order would silently ship a
        # plausible-looking but unverified tttTeamOrder, which drives real
        # payout math (engine/resultLogger.ts). Flag it instead: the app still
        # handles a TTT fine without tttTeamOrder (falls back to teamStrength,
        # or paste pre-stage team odds — see the TTT odds feature).
        block["isTTT"] = True
        block["_note"] += (" | TTT: tttTeamOrder omitted — individual times are interleaved across "
                            "teams here, not reliably derivable. Add tttTeamOrder by hand if you have it.")
    else:
        top3, seen = [], set()
        for r in stage_rows:
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
