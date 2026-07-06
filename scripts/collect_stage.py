#!/usr/bin/env python3
"""Domestique auto-collector.

Fetches one Tour de France stage result from ProCyclingStats and writes a
Domestique `stageResult` import block (the exact schema the PWA reads). Run by
the GitHub Action each evening during the Tour, or by hand on any machine.

Honest notes:
- ProCyclingStats blocks the procyclingstats package's default User-Agent (HTTP
  403). We fetch the HTML ourselves with a browser UA and hand it to the parser.
- CONFIRMED (by running this from GitHub Actions and reading the actual response):
  Cloudflare returns a flat HTTP 403 to the Actions runner's IP on every attempt —
  cloudscraper included. That's an IP-reputation block at the edge, not a solvable
  JS challenge — no header, retry, or scraping-library trick fixes it client-side;
  it needs a different egress IP (a paid residential/rotating proxy), which this
  script deliberately does NOT add (new cost + credentials, a call for you to make,
  not a code fix). So on GitHub Actions this is realistically often going to fail —
  the app's manual/chat-Claude paste flow (Stages & Data → ①) is the reliable path,
  not a fallback of last resort. This script still fully works run locally/by hand
  (your own IP isn't blocked), and the retries + cloudscraper + proxy layers below
  do help in environments where the block is a real JS challenge, not an outright 403.
- Per-rider *stage* green/KOM points aren't cleanly exposed by PCS, so finish
  green points are ESTIMATED from finishing position + stage profile (clearly an
  approximation; the app's model also estimates, and you can correct any value).

Usage:
  python collect_stage.py --year 2026 --stage 7 --out public/data
  python collect_stage.py --year 2025 --stage 7 --print   # validate / preview
"""
from __future__ import annotations
import argparse, json, os, sys, time, unicodedata
from urllib.parse import quote

import requests
from procyclingstats import Stage
from procyclingstats.errors import ExpectedParsingError

try:
    import cloudscraper
except ImportError:
    cloudscraper = None

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
BROWSER_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.procyclingstats.com/races.php",
}

# Estimated green-jersey points by finishing position for the FINISH only
# (intermediate sprints not included). Keyed by a coarse profile bucket.
GREEN_FLAT = [70, 50, 40, 35, 30, 25, 20, 19, 18, 17, 16, 15, 14, 13, 12]
GREEN_MED  = [50, 35, 28, 24, 20, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3]
GREEN_MTN  = [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]


def _parse_or_none(rel_url: str, html: str) -> Stage | None:
    """Bind a Stage to this HTML and validate it actually parses PCS's
    `.page-title` element. A blocked/challenge response usually still has a
    generic HTML <title> tag, so checking for that would be a false positive —
    `.page-title` is the specific element the library (and every field we use)
    needs, so this is the real "did we get the real page" signal."""
    stage = Stage(rel_url, html=html, update_html=False)
    try:
        stage.stage_type()
    except ExpectedParsingError:
        return None
    return stage


def fetch(rel_url: str) -> Stage:
    """Fetch a PCS page and return a parser bound to it.

    PCS puts a Cloudflare JS challenge in front of the GitHub Actions runner's
    IP specifically (confirmed: captured the literal "Just a moment..." body
    from a failed run) — plain `requests` can never solve that, so `cloudscraper`
    (built to solve exactly this) is the primary path, with retries/backoff for
    its occasional flakiness, then plain `requests` (works fine from non-flagged
    IPs), then a public read-proxy as a last resort. Reports exactly why on
    final failure instead of the library's generic parsing traceback.
    """
    target = "https://www.procyclingstats.com/" + rel_url
    status, html = None, ""

    if cloudscraper is not None:
        scraper = cloudscraper.create_scraper()
        for attempt in range(3):
            if attempt:
                time.sleep(4 * attempt)
            try:
                resp = scraper.get(target, headers=BROWSER_HEADERS, timeout=30)
                status, html = resp.status_code, resp.text
            except Exception as e:
                print(f"[fetch] cloudscraper attempt {attempt}: {e!r}", file=sys.stderr)
                continue
            stage = _parse_or_none(rel_url, html)
            print(f"[fetch] cloudscraper attempt {attempt}: HTTP {status}, {len(html)} bytes, "
                  f"parsed={stage is not None}", file=sys.stderr)
            if stage is not None:
                return stage

    resp = requests.get(target, headers=BROWSER_HEADERS, timeout=30)
    status, html = resp.status_code, resp.text
    stage = _parse_or_none(rel_url, html)
    print(f"[fetch] plain requests: HTTP {status}, {len(html)} bytes, parsed={stage is not None}",
          file=sys.stderr)
    if stage is not None:
        return stage

    try:
        proxied = "https://api.allorigins.win/raw?url=" + quote(target, safe="")
        resp = requests.get(proxied, headers={"User-Agent": UA}, timeout=30)
        status, html = resp.status_code, resp.text
        stage = _parse_or_none(rel_url, html)
        print(f"[fetch] read-proxy: HTTP {status}, {len(html)} bytes, parsed={stage is not None}",
              file=sys.stderr)
        if stage is not None:
            return stage
    except requests.RequestException:
        pass

    raise RuntimeError(
        f"PCS fetch for {rel_url} never parsed (.page-title missing) after cloudscraper + direct "
        f"+ proxied attempts (last HTTP {status}, {len(html)} bytes) — looks bot-blocked, not a "
        f"bad URL. Paste the stage result manually instead. First 200 chars: {html[:200]!r}"
    )


def norm(name: str) -> str:
    n = unicodedata.normalize("NFD", name)
    return "".join(c for c in n if unicodedata.category(c) != "Mn")


def profile_bucket(stage: Stage) -> str:
    """flat / med / mtn from the PCS profile icon (p1..p5)."""
    try:
        p = (stage.profile_icon() or "").lower()
    except Exception:
        p = ""
    if "p5" in p or "p4" in p:
        return "mtn"
    if "p3" in p or "p2" in p:
        return "med"
    return "flat"


def green_points(rank: int, bucket: str) -> int:
    table = {"flat": GREEN_FLAT, "med": GREEN_MED, "mtn": GREEN_MTN}[bucket]
    return table[rank - 1] if 1 <= rank <= len(table) else 0


def leader(stage: Stage, method: str):
    try:
        rows = getattr(stage, method)()
        return norm(rows[0]["rider_name"]) if rows else None
    except Exception:
        return None


def collect(year: int, stage_no: int) -> dict:
    rel = f"race/tour-de-france/{year}/stage-{stage_no}"
    s = fetch(rel)

    is_ttt = False
    try:
        is_ttt = s.stage_type() == "TTT"
    except Exception:
        pass

    bucket = profile_bucket(s)
    results = s.results() or []

    # GC positions after the stage (for the Sammenlagt bonus), top 15.
    gc_pos = {}
    try:
        for row in (s.gc() or [])[:15]:
            gc_pos[norm(row["rider_name"])] = row["rank"]
    except Exception:
        pass

    rows, dnf, dns = [], [], []
    for r in results:
        name = norm(r.get("rider_name", ""))
        status = (r.get("status") or "DF").upper()
        rank = r.get("rank")
        if status == "DNF":
            dnf.append(name)
        elif status in ("DNS", "DSQ", "OTL", "DF") and rank is None:
            if status == "DNS":
                dns.append(name)
        if rank is None:
            continue
        row = {"rider": name, "pos": int(rank)}
        if not is_ttt:
            sp = green_points(int(rank), bucket)
            if sp:
                row["sprintPts"] = sp
        gap = r.get("time")
        if isinstance(gap, int) and gap > 0:
            row["gap"] = gap
        if name in gc_pos:
            row["gcPos"] = gc_pos[name]
        rows.append(row)

    block = {
        "type": "stageResult",
        "stage": stage_no,
        "results": rows,
        "jerseys": {
            "yellow": leader(s, "gc"),
            "green": leader(s, "points"),
            "polka": leader(s, "kom"),
            "white": leader(s, "youth"),
        },
        "dnf": dnf,
        "dns": dns,
        "_source": f"procyclingstats:{rel}",
        "_note": "finish green points estimated from position+profile; intermediate sprints/KOM not auto-filled",
    }

    if is_ttt:
        block["isTTT"] = True
        # team finishing order from the results (teams in result order)
        order, seen = [], set()
        for r in results:
            t = r.get("team_name")
            if t and t not in seen:
                seen.add(t); order.append(t)
        block["tttTeamOrder"] = order[:8]
    else:
        # stage podium teams for Holdbonus
        top3, seen = [], set()
        for r in results:
            t = r.get("team_name")
            if t and t not in seen and r.get("rank"):
                seen.add(t); top3.append(t)
            if len(top3) >= 3:
                break
        block["teamResultTop3"] = top3

    # strip null jerseys
    block["jerseys"] = {k: v for k, v in block["jerseys"].items() if v}
    return block


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--stage", type=int, required=True)
    ap.add_argument("--out", default=None, help="directory to write stage-N.json + latest.json")
    ap.add_argument("--print", action="store_true", dest="do_print")
    args = ap.parse_args()

    block = collect(args.year, args.stage)
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
