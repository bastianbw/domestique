# Domestique — daily operating guide (Tour de France 2026)

The app is a static PWA: everything (model, Monte-Carlo simulator, optimizer) runs
in your browser. There is no backend. Data comes in via **import blocks** you paste
on **Stages & Data → ① Import** (or that the app auto-fetches). Blocks are JSON;
you can paste one block or an array of blocks.

---

## One-time setup (when the real start list drops)

Do these **in order** — each step matters:

1. **Import the start list** (names, teams, prices). This replaces the seed field.
   - Fastest: paste a `startlist` JSON block, or use ③ Start-list import (CSV:
     `name, team, archetype, price`).
   - ⚠ A bare start list has **no predictive features** — every rider defaults to
     `form 70 / rank 60 / teamStrength 65`, so xG looks *uniform* (e.g. everyone
     "+30k" on the stage-1 TTT). This is expected until you do step 2.

2. **Import the PCS features block** — THIS is what makes predictions real.
   - Generate it: `npx vitest run --config vitest.backtest.config.ts scripts/build_features.bt.ts`
     → writes `data/rider_features.json` (archetype, PCS rank, form, breakaway
     tendency, **team strength**, **terrain affinity** for ~750 riders).
   - Paste its contents into ① Import. It patches riders **by name** (fuzzy), so it
     lines up with whatever start list you imported. xG now differentiates.
   - Optional: also run `scripts/collect_holdet.py --appid <GUID>` to pull the
     official **price + ownership %** from Holdet (the `appid` is a one-click grab
     from DevTools → Network on the Tourspillet page). It emits a `features` block.

3. **Set Buying power** (top-left on Optimal) to your real Holdet budget, then
   **build/adopt your 8** (Riders page, or "Adopt team").

> If the model ever looks uniform/broken after an import, it's almost always a
> missing features block (step 2). Re-import `rider_features.json`.

---

## Each stage day

1. **Select today's stage** in the stage bar.
2. **Odds** (the strongest signal): ask Claude in chat for the stage's odds → paste
   the `odds` block. Odds are **stage-scoped** — they only anchor that stage, never
   bleed into others. Optional: paste a `weather` block (crosswind/echelon days) or
   a `news` block (injuries / stated intent).
3. **Open Optimal.** `balanced` = highest expected value; `safe` = steadier + fewer
   transfers; `aggressive` = more upside. Use "Apply all" for the suggested
   transfers + captain. (The team is chosen for the whole block to the next rest
   day, so a climber can appear the day before a summit — that's intentional.)
4. **After the stage finishes:** import the `stageResult` block. It rolls prices,
   updates bank/GC, marks abandons, and **auto-recalibrates** the model.

---

## Automatic results + weather (GitHub Action)

You do **not** have to scrape by hand. `.github/workflows/collect-results.yml`
runs nightly through July: it works out the day's stage, scrapes the result from
ProCyclingStats, fetches the next stage's weather (open-meteo, free), bundles both
into `data/latest.json`, and commits it. The app pulls it via **Stages & Data →
①½ Auto-fetch** (`autoFetchUrl` → the raw GitHub `main` URL).

The browser itself can't scrape PCS (CORS / no backend), so this server-side
Action is the "grab it automatically" path. **It must live on `main`** — scheduled
Actions only run on the default branch, and the app's auto-fetch reads `main`. So
**merge `prediction-model-upgrade` → `main`** before the Tour, or auto-fetch will
be stale. Manual paste of the `stageResult` block is always the reliable fallback.

---

## Block cheat-sheet

| Block | What it does | How often |
|---|---|---|
| `startlist` | replace the field (names/teams/prices) | once (+ if the field changes) |
| `features` | patch rank/form/archetype/team-strength/terrain-affinity (+ price/ownership) | at setup, refresh occasionally |
| `odds` | anchor one stage to the betting market (strongest signal) | every stage you have odds for |
| `weather` | crosswind/echelon + attrition nudges for a stage | optional, exposed stages |
| `news` | per-rider injury/intent nudges | optional |
| `stageResult` | log the result → prices, bank, GC, calibration | after each stage (or auto-fetch) |
