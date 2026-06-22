# Domestique — Tourspillet 2026 strategist

A static, offline-first PWA that helps you win **Tourspillet 2026** on Holdet.dk by
maximising your team's **total value growth (vækst), measured in DKK — not points**.
8 riders, 50,000,000 kr budget, max 2 per team, 1 captain, 21 stages.

> **Read this during the Tour with no Claude Code access.** Everything below is how you
> operate the deployed app on its own, using only the free Claude chat app + this PWA.

---

## TL;DR — the two phases

- **Phase 1 — Build (done):** Next.js + TypeScript + Tailwind, static-exported PWA. The
  whole scoring/prediction model lives in [`engine/`](engine/) (pure TS, 46 unit tests).
- **Phase 2 — Race (July):** you run the entire Tour with **zero code changes**. Each day
  the free Claude chat app turns a ProCyclingStats page / odds screenshot into **one JSON
  block**, you paste it into the app, prices and your bank roll forward, the model
  recalibrates. No backend, no API key, no subscription, no dependency on Claude.

---

## Deploy (one time)

### Option A — Vercel (recommended)
```bash
npm install
npm run build          # static export → ./out
npx vercel --prod      # or connect the repo at vercel.com and it just works
```
`next.config.mjs` sets `output: 'export'`, so the build produces a fully static `out/`
folder. Vercel serves it as a static site.

### Option B — any static host (Netlify / GitHub Pages / drag-drop)
```bash
npm run build
# upload the ./out folder to Netlify, GitHub Pages, Cloudflare Pages, etc.
```
There is no server runtime to configure. `out/` is the whole app.

---

## Install on your phone / desktop

1. Open the deployed URL in Chrome (Android/desktop) or Safari (iOS).
2. **Add to Home Screen** / **Install app**.
3. It now works **fully offline** (a service worker caches the app shell). All your data
   lives in that browser's localStorage — nothing is uploaded anywhere.

Each family member just opens the same link; everyone has their own independent local data.

---

## The daily race loop (Phase 2)

Every day during the Tour:

1. **In the free Claude chat app**, say: *"Start stage N for my Tourspillet team."* Optionally
   paste/upload an **odds screenshot** or a rider-news article.
2. Chat-Claude reads ProCyclingStats, applies the exact Holdet rules, and replies with **one
   JSON block** (schemas below).
3. In the app, go to **Stages & Data → ① Import block**, paste it, press **Import**.
   - Prices roll forward, your bank updates (captain bonus, Etapebonus, 0.5% interest), the
     model recalibrates. Unmatched rider names are reported so you can fix spelling.
4. Open the **Optimal** tab, select the next stage, read the recommended XI + captain + the
   "what to actually do" sell/buy panel.

Odds are always optional and additive — the app works fully without them.

### Tip: paste your state back to chat-Claude
On **Stages & Data → ⑧ Export state** you can download your full state JSON and paste it into
chat so Claude has your exact team/bank/prices as context when generating the next block.

---

## Automatic results during the Tour (optional auto-collector)

Instead of (or alongside) the chat-paste loop, a **GitHub Action** can fetch each
stage from ProCyclingStats and publish it for the app to pull automatically.

- Script: [`scripts/collect_stage.py`](scripts/collect_stage.py) — uses the
  `procyclingstats` package (with a browser User-Agent, since PCS blocks the
  default one) to build a `stageResult` block: finishing order, DNF/DNS, time
  gaps, GC positions, jerseys, and the stage-podium teams. It writes
  `data/stage-N.json` and `data/latest.json`.
- Workflow: [`.github/workflows/collect-results.yml`](.github/workflows/collect-results.yml)
  runs every evening in July (21:00 CEST), works out which stage was raced from
  the date, runs the script, and commits the JSON to the repo.
- The app pulls it on **Stages & Data → ①½ Auto-fetch** from
  `https://raw.githubusercontent.com/bastianbw/domestique/main/data/latest.json`
  (pre-filled). Press **Fetch** and it imports exactly like a pasted block.

**Honest caveats:**
- ProCyclingStats rate-limits/blocks datacenter IPs, so the cloud Action is
  *best-effort* — some evenings it may be blocked. The **manual paste flow always
  works** as the fallback.
- Per-rider **intermediate-sprint** and **KOM** points aren't cleanly exposed by
  PCS. The collector estimates *finish* green points from position + profile;
  intermediate sprints aren't auto-filled. For a sprint stage you care about,
  add them via chat or the manual form. The app's xG model already accounts for
  intermediate sprints in its predictions.
- PCS has no Holdet prices — the app computes new values itself by applying the
  growth rules to the results. Re-anchor with real Holdet prices when convenient.

Run it by hand anytime (validates against past Tours too):
```bash
pip install -r scripts/requirements.txt
python scripts/collect_stage.py --year 2025 --stage 7 --print   # preview
python scripts/collect_stage.py --year 2026 --stage 7 --out data
```

## Import schemas (what chat-Claude must produce)

The app accepts **one block per paste**. Rider-name matching is accent- and typo-tolerant.

### (a) Results block — after a stage
```json
{
  "type": "stageResult",
  "stage": 7,
  "results": [
    {"rider": "Jasper Philipsen", "pos": 1, "sprintPts": 20, "mtnPts": 0, "gap": 0},
    {"rider": "Jonathan Milan",   "pos": 2, "sprintPts": 17, "gap": 0},
    {"rider": "Tadej Pogacar",    "pos": 24, "gcPos": 1}
  ],
  "jerseys": {"yellow":"Tadej Pogacar","green":"Jasper Philipsen","polka":"...","white":"...","aggressive":"..."},
  "dnf": ["Some Rider"],
  "dns": ["Another Rider"],
  "teamResultTop3": ["Alpecin-Deceuninck","Lidl-Trek","Visma-LAB"]
}
```
- `pos` finishing position (1-based). `gap` = seconds behind the winner (for late-arrival).
- `gcPos` = overall classification position **after** the stage (for the Sammenlagt bonus).
- `dnf` = did-not-finish this stage (−50,000, keeps points earned, no Holdbonus).
- `dns` = abandoned (−50,000 this stage, then **−100,000 per remaining stage** automatically).
- `teamResultTop3` = the teams of the stage podium (for Holdbonus); the app also derives it
  from `results` if omitted.
- For the **TTT (stage 1)** add `"isTTT": true` and `"tttTeamOrder": ["UAE Emirates", ...]`
  (1st..5th). On a TTT the Holdtidskørsel ladder replaces placement/Holdbonus/late/Etapebonus.
- Optional `"newPrice"` per result row if chat-Claude precomputed the Holdet price — the app
  trusts it instead of rolling the value itself.

### (b) Odds block — optional, pre-stage
```json
{ "type": "odds", "stage": 8,
  "odds": [ {"rider":"Jasper Philipsen","win":2.5,"top3":1.4,"top5":1.2,"top10":1.05} ] }
```
Decimal odds. The app de-vigs them and uses them as the strongest anchor for the head of the
finishing distribution.

### (c) Startlist block — once, before the Tour
```json
{ "type": "startlist",
  "riders": [
    {"name":"Jasper Philipsen","team":"Alpecin-Deceuninck","archetype":"sprinter","price":8000000,"form":88,"pcsRank":8}
  ] }
```
`archetype` ∈ `sprinter | puncheur | climber | gc | rouleur | breakaway | domestique`.
`price` in DKK (or import the start list as CSV/free-text on the Stages & Data page using
`name, team, archetype, price` with prices like `9.5M`).

A **prompt you can give chat-Claude** to reproduce these exactly lives on the **How it works**
page inside the app.

---

## The pages

- **A · Optimal** — the best legal 8-rider team for the selected stage maximising expected net
  growth (Σ xG + captain bonus + expected Etapebonus − transfer fees), with the risk dial
  (Safe / Balanced / Aggressive). Selection is forward-looking: riders are valued over the rest
  of the current block (auto-horizon to the next rest day, no knob), so it prefers a rider who is
  better across the upcoming stages. Includes an odds-coverage meter, a concrete sell/buy panel
  vs your current team, and real transfer accounting (adopting a team debits the bank for net
  spend + 1% fee; the initial squad and stage-1 build are free).
- **B · Riders** — sortable/filterable board: xG, xG/M, xG−fee, captain-EV, with value heatmaps.
- **C · Stages & Data** — the operational hub: import blocks, manual result fallback, start-list
  import, rider/stage editing, calibration log (with undo), team snapshots, export/import/reset.
- **D · How it works** — the model, the exact rule tables, the schemas, and the independence
  guarantee.

---

## The engine (single source of truth)

[`engine/`](engine/) is framework-agnostic pure TypeScript with no React imports, so it can be
tested and reused independently.

| File | Responsibility |
|---|---|
| `rules.ts` | The exact §1 growth tables (placement, GC, Etapebonus, TTT, Holdbonus, jerseys, late-arrival cap, DNF/DNS, interest, fees, captain). |
| `stages.ts` | All 21 official 2026 stages preloaded. |
| `config.ts` | Every tunable model weight in one place. |
| `probability.ts` | Odds-ladder finishing distribution: de-vig win/top3/top5/top10 markets and pin P(top-k) to them; archetype×profile matrix as the fallback when a rider has no odds. |
| `growth.ts` | Expectation over the rules → xG, captain-EV. |
| `optimizer.ts` | Budget / ≤2-per-team / contract-constrained subset + captain + exact (Poisson-binomial) Etapebonus, risk reshaping, forward-looking (block) selection value, fee-gating. |
| `horizon.ts` | Forward block value to the next rest day (auto-horizon) + keep-vs-swap. |
| `calibration.ts` | Conservative EMA nudge of stage-type weights from logged results. |
| `resultLogger.ts` | Apply a `stageResult` block → realised growth, roll prices/bank. |
| `importSchema.ts` | Parse/validate blocks + tolerant rider-name matching. |

```bash
npm test          # 46 unit tests (rules, optimizer, growth/TTT, result logger, imports)
npm run typecheck
```

---

## Team type & contracts

Default is **Guld/Guld+ (unlimited transfers)** — the optimizer rations the real cost, the 1%
transfer fee, not contracts. You can switch to **Basis** (8 contracts for the whole game) on
**Stages & Data**; the optimizer then respects the remaining-contract budget.

---

## Extending later (optional, off by default)

Clean integration points are left as typed stubs and are never required to run the race:
- ProCyclingStats / odds / injury feeds — wire real fetchers behind the same import-block shapes.
- An optional Vercel cron that writes the same JSON the app already reads.
- Optional cloud sync (e.g. Supabase) for sharing — clearly separable, not built.

Pushing a new **feature** can require a redeploy; **running the race never does.**
