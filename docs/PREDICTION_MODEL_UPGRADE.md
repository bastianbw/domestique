# Domestique — Prediction Model Upgrade (Design Doc)

Status: **DRAFT — awaiting approval. No code until approved.**
Date: 2026-06-23
Author: design session (continuation of the `/grill-me` work in commit `3178617`).

## 0. Goal & decisions taken

Improve the accuracy of the per-stage finishing model so the Holdet Tourspillet
2026 **value-growth (DKK)** objective is computed from the *most probable real
race outcome*, not three independent approximations.

Decisions already made with the user (do not re-litigate):

- **One unified best-estimate engine.** Build a **Monte Carlo race simulator** as
  the source of truth (it produces a *joint* outcome, so Etapebonus, Holdbonus,
  captain choice and correlated risk all fall out consistently). The current
  analytic expectation model is kept as the fast seed / sanity check, not thrown
  away.
- **Harness first.** A backtest/calibration rig is built before any model change.
  No model change ships unless it beats the baseline on replayed real stages.
- **Route detail is baked in**, not a daily chore — the 2026 route is fixed and
  known; enrich it from PCS / road-book once.
- **Roles are inferred**, not asked — bib-number-ending-in-1 + GC position +
  accumulated results, with an optional manual override.
- **Weather + news are optional Phase-2 modifiers** with neutral defaults, so the
  model degrades gracefully on days only odds are pasted.
- **Odds stay the one manual input** the user supplies each day.
- **Data: as wide as possible** — the entire 2026 season (all race types, not
  just GTs) for backtesting + form; multi-year specialty/results for archetype and
  baseline-strength priors. Both *previous results* and *current form* matter.

### Hard constraint resolved without the user
Free **historical betting odds are essentially unavailable** retrospectively. So
the backtest validates the **structural** model (archetype × route × form → real
finishing positions) against PCS results. Odds-anchoring is near-self-fulfilling
and does not need historical validation; it gets sanity-shape checks only.

### Standing project constraints (unchanged)
- Engine `engine/` is the single source of truth; keep all tests green (52 today).
- Rule values are verbatim from the build brief — don't "improve" them silently.
- Windows: `py -3` + `PYTHONUTF8=1` (bare `python` hits the MS Store stub).
- Commit/push/deploy only when asked. Deploy is CLI-only
  (`npx vercel --prod --yes --scope domestique`). **A Vercel token must never be
  committed.**

---

## 1. Data layer

Two datasets, scraped from ProCyclingStats (extend the existing
`scripts/collect_stage.py` approach: browser User-Agent, parse HTML, `update_html=False`).

### A. Rider profile store (multi-year, slow-changing)
`data/historical/riders.json` — one entry per rider:
- PCS **specialty points** (one-day, GC, time-trial, sprint, climber, hill) →
  derive `archetype` **and** keep the continuous specialty vector (richer than a
  single label; used as a prior on contention strength).
- **pcsRank** and prior 2–3 seasons' results → baseline strength prior.

Scraper: `scripts/scrape_rider_profiles.py`.

### B. 2026 season results corpus (backtest + form)
`data/historical/results_2026.json` — one row per (race, stage, rider):
race, stage, date, our `StageType` classification, rider, finishing position, gap,
sprint/KOM points. Covers **every 2026 race to date** (stage races + one-day),
not just GTs.

Scraper: `scripts/scrape_2026_results.py`.
Stage classification: map PCS profile icons / parcours score → our `StageType`
(`flat | hilly | summit | high_mtn | ttt | hilly_itt`). One-day races classified
by parcours.

### Computed form (replaces hand-set `form`)
`computeForm(riderId, asOfDate)` — recency-weighted EMA of result quality
(position normalised by field size × race-level weight) over a trailing ~6–8 week
window. Reproducible, usable both in the backtest (as-of each historical stage)
**and live** (the nightly collector already logs results). Removes the hand-tuned
0–100 `form` guess.

### Risks
- PCS may rate-limit / block datacenter IPs → scrape politely (delay, cache HTML
  to disk, resumable). Manual fallback already exists for live use.
- Stage-type misclassification → spot-check a sample against known stages.

---

## 2. Backtest / calibration harness  *(STEP 1 — built first)*

`engine/backtest.ts` (pure, testable) + `scripts/run_backtest.ts` runner.

For each historical stage with a known startlist + result:
1. Build riders with features **as-of the stage date** (archetype from profiles,
   `form` from the corpus, pcsRank, teamStrength, gcPosition if mid-race).
2. Run `buildField` → finishing distributions.
3. Score against the actual finishing order.

### Metrics
- **Log-loss** of the realised finishing position under each rider's distribution
  — *primary*.
- **Brier** on the binary events pWin / pTop5 / pTop15.
- **Calibration / reliability**: bucket predicted pTop5, compare to empirical hit
  rate.
- **Growth-MAE**: predicted xG vs realised Holdet growth (the thing we actually
  optimise), in DKK.
- **Etapebonus accuracy**: predicted E[# top-15 in a sampled legal team] vs
  realised.

### Baselines to beat
- Uniform (1/N).
- pcsRank-only geometric (≈ today's `buildDistribution` fallback).
- Archetype × suitability only (no form).

This isolates the marginal value of *each* feature so we know what's real.

### Gating rule
A model change ships only if it **reduces aggregate log-loss without worsening
growth-MAE** on a **held-out split** (split by date or by race to avoid
overfitting the calibration knobs). Report numbers back to the user before/after
each change.

---

## 3. Model upgrades (each gated on §2)

### 3.1 Route enrichment
Extend `Stage` with optional fields:
`finishGradientPct`, `finalClimbKm`, `finalClimbGradient`, `summitAltitudeM`,
`kmFromLastClimbToFinish`, `crosswindRisk` (0..1), `technicalFinish`, `cobbles`.
Bake 2026 values into `STAGES_2026`. Derive:
- a **sprinter-survival probability** (do pure sprinters reach the line in the
  bunch?), and
- a **per-stage breakaway-success prior** `pBreakBase`, calibrated from the 2026
  corpus by stage type + a route-difficulty index.

### 3.2 Break-vs-bunch split + role inference
- Stage-level `pBreakWins` from route + how controllable the bunch is (sprinter-
  team presence).
- `inferRole(rider, raceState)` → `leader | protected | free | domestique`:
  leader if `bib % 10 === 1` **or** best GC on team **or** best recent results on
  team; free/stage-hunter if a strong rider not protecting GC; domestique
  otherwise. Role boosts the leader's placement + adds team support, suppresses
  domestiques' own placement (they still earn Holdbonus). Optional manual override.

### 3.3 Monte Carlo simulator  *(the unification)*
`engine/simulate.ts`. For each of N sims (N≈2000–5000, configurable; small N in
tests):
1. **Break?** Bernoulli(`pBreakWins`). If yes, sample break composition by
   `breakawayTendency`; stage win + top placements drawn from the break pool
   ordered by strength + Gumbel noise; bunch/GC finish behind (sprinters score
   reduced/none on placement).
2. **No break:** order the relevant pool (sprinters on flat, climbers/GC on
   summit) by `contentionStrength` + noise → finishing order.
3. **DNF draws** with a shared per-team crash shock + idiosyncratic component
   (correlated team downside).
4. Compute full Holdet growth for **every** rider for this sim from the realised
   order (placement, points, jerseys, GC, Holdbonus, late-arrival, DNF).

Aggregate → E[growth] per rider, P(win), P(top-k), and the **joint** team-level
pmf. The optimizer then scores teams on sampled growth and reads Etapebonus
straight from the empirical joint distribution.

- **Determinism**: seeded RNG (mulberry32) so vitest is reproducible.
- **Performance**: 180 riders × ~5000 sims is sub-100ms in TS with a tight loop.
- **Fallback**: analytic model seeds the optimizer's greedy pass and powers a fast
  preview; the sim refines to the final number. Per the user's "combine into the
  best number", the sim's E[growth] becomes the optimiser's xG when enabled.

### 3.4 Odds de-vig upgrade
Replace proportional de-vig (`devigWinOdds` / `devigMarket`) with **Shin's method**
(or the power method) to remove favourite-longshot bias. Solve the per-rider
distribution as a smooth discrete hazard that **exactly matches all available
market anchors** (win/top3/top5/top10) instead of the current heuristic front-heavy
taper. Validate shape sanity (no historical odds to log-loss against).

### 3.5 Weather + news (optional Phase-2 fields)
New import blocks, all-optional with neutral defaults:
- `WeatherBlock { type:'weather', stage, windKph, windDir, gustRisk, rainProb, tempC, crosswindSections }`
  → modifies `pBreakWins`, echelon/split risk, `pDNF`, mountain-attrition gaps.
- `NewsBlock { type:'news', stage, items:[{rider, intent?, role?, motivation?, formDelta?, status?}] }`
  → optional per-rider nudge (crash recovery, illness, home roads, saving for a
  block, target stages).

Update the **chat-Claude daily-prompt template** (in docs + the How-it-works page)
to instruct it what to fetch (odds = required; weather/news = if it can) and the
exact JSON to return. Everything optional so a results+odds-only day still works.

---

## 4. Phasing & gating

| Step | Deliverable | Gate |
|------|-------------|------|
| 1 | Harness + 2026 corpus + rider profiles + computed form | DONE — baseline recorded (§4a) |
| 1b | **Rework structural model**: multiplicative skill (rank×suitability×form) + coherent joint (column-normalised) to kill over-confidence | **beat rank-only P@5 0.259**; reliability calibrated |
| 2 | Route enrichment + break-success priors | ↑ precision@k vs step 1b |
| 3 | Break-vs-bunch split + role inference | ↑ precision@k, growth-MAE not worse |
| 4 | Monte Carlo simulator (joint outcome) | ≥ analytic; Etapebonus/Holdbonus more accurate |
| 5 | Odds de-vig upgrade (Shin/power + smooth fit) | shape sanity; no live regression |
| 6 | Weather + news P2 fields + chat-prompt template + docs | neutral-default = no change; tests green |
| 7 | **CAPSTONE — held-out season validation**: predict already-finished 2026 stages as if unknown (train/test split by race or date), report how close (precision@k, Brier, calibration) on the held-out set | honest out-of-sample numbers; no train/test leakage |

Each step: keep all existing tests green, add new tests, report harness deltas to
the user before moving on. The §1b rework was requested ahead of route detail
because over-confidence/flatness is the biggest gap vs the rank-only bar.

---

## 4a. Step 1 RESULTS — baseline (2026-06-25)

Built and green: scrapers (`scripts/scrape_2026_results.py`, `scripts/scrape_rider_profiles.py`),
corpus (**93 stage/result pages, ~14k rows, 625 rider profiles**), feature
derivation (`engine/features.ts`), harness (`engine/backtest.ts`) and the report
runner (`scripts/backtest.bt.ts`, run via `vitest.backtest.config.ts`).
69 unit tests pass (52 prior + 17 new); `tsc --noEmit` clean.

Backtest of the **current structural model with NO odds** over 91 stages / 12,618
finishers:

| metric | MODEL | rank-only | random/uniform |
|--------|-------|-----------|----------------|
| Precision@5  | 0.215 | **0.259** | 0.038 |
| Precision@15 | **0.333** | 0.312 | 0.113 |
| Top5 Brier   | 0.0401 | 0.0323 | 0.0348 |
| Top15 Brier  | 0.1309 | 0.0966 | 0.0970 |

**Findings (the bar for steps 2–4):**
1. The model discriminates far better than random, but **loses to a trivial
   PCS-season-rank ordering at top-5** (P@5 0.215 < 0.259) and only ties at top-15.
   Without odds, our archetype×stage×form machinery is net-negative vs "sort by
   rank." **rank-only P@5 0.259 is the number step 2 must beat.**
2. **Severe over-confidence / no joint:** the model assigns ~11% top-5 probability
   to essentially the whole field (reliability: predicted 0.11 vs empirical 0.036),
   because independent per-rider distributions imply ~18 top-5 finishers when only
   5 exist. Confirms the §3.3 need for a joint (column-normalised / Monte Carlo)
   model. Exact-position NLL is tail-dominated and NOT used as the gate; precision@k
   is.
3. The structural curve is nearly flat (no rider exceeds 0.2 pTop5 without odds),
   so production accuracy leans heavily on the pasted odds — reinforcing that odds
   are the key daily input.

## 4b. Step 1b RESULTS — structural rework (2026-06-25)

Implemented `riderSkill` + `buildCoherentField` in `engine/probability.ts`: a
multiplicative skill (`strengthFromRank(pcsRank) × suitability × form`) seeds a
Gaussian around each rider's skill-rank, then **Sinkhorn** makes the finishing
matrix doubly stochastic (coherent joint). `buildField` routes the no-odds field
through it. Tunable `jointSpread` (=16) + `skillFormFloor` in config. 75 tests
pass (6 new joint tests); `tsc` clean.

Backtest delta vs the §4a baseline (91 stages / 12,618 finishers, no odds):

| metric | step 1b | §4a model | rank-only bar |
|--------|---------|-----------|---------------|
| Precision@5  | **0.281** | 0.215 | 0.259 |
| Precision@15 | **0.353** | 0.333 | 0.312 |
| Top5 Brier   | 0.0325 | 0.0401 | 0.0323 |
| Top15 Brier  | **0.0961** | 0.1309 | 0.0966 |
| Growth MAE   | 14,261 | 32,354 | 13,996 |

**Both precision gates beaten; Top15 Brier now best-in-class.** Over-confidence is
resolved — reliability is monotonic and roughly calibrated (pred 0.25 → emp 0.22).
Key insight confirmed: making suitability *multiplicative* (modulating rank)
instead of additive is what let stage-fit beat a pure season-rank ordering.
precision@k is invariant to `jointSpread`, so it was widened purely to calibrate.
NLL (7.2) stays high by design — the sharp coherent model is tail-punished; NLL is
not the gate.

Remaining gap: the model has **no notion of a breakaway winning**, so it misses
cheap break riders who take stages (the biggest growth lever). That's steps 2–3.

## 4c. Step 2 RESULTS — route geometry (2026-06-25)

Probed PCS: `profile_score` + `vertical_meters` + `distance` are exposed **pre-race**
for the 2026 TdF (so they can be baked in now), but `climbs()` is empty pre-race
and only returns KOM *rankings* (no gradient/last-climb-to-line) even when finished
— so finish-geometry isn't cleanly scrapeable. Used the available continuous
difficulty instead.

Implemented:
- `Stage.profileScore?` / `Stage.verticalMeters?` (optional) + `climbiness(stage)`
  = vertical-m/km mapped to 0..1.
- A per-archetype **climbiness response** in `riderSkill` (config `climbinessGain`
  = 1.5, `climbinessResponse`): refines the coarse 6-way type so a "hilly" stage
  with mountain-level vertical lifts climbers/GC and drops sprinters. Genuinely flat
  stages (≤ 8 m/km) get no penalty.
- Baked the real 2026 TdF per-stage difficulty into `STAGES_2026` (21 stages,
  `scripts/scrape_tdf2026_route.py`) for live use in July.

Backtest delta (91 stages): **Precision@5 0.281 → 0.290** (rank-only 0.259),
P@15 0.351, Top15 Brier 0.0958. 78 tests pass; `tsc` clean.

Honest finding: climbiness is a **small, saturating** win (the coarse type already
captures most of the ordering signal; continuous difficulty only helps the
minority of mistyped stages — but it meaningfully sharpens the heterogeneous
"hilly" bucket, which is 50/91 corpus stages and several TdF stages). Finish-
gradient / last-climb-to-line would need a non-PCS source and is deferred.

## 4d. Step 3 RESULTS — breakaway model: tried, rejected on the marginal path (2026-06-25)

Calibrated break-win rates from the corpus (winner spent km up the road):
flat 8%, **hilly 24%**, high_mtn 6%, summit/ITT ~0% (n: 12/50/16/8/5). Added a
`breakSkill` (breakaway tendency × √terrain-skill) and mixed a breakaway-pool
coherent field into the no-odds marginals at these rates.

Backtest verdict (split by outcome):

| subset | break mix ON | OFF |
|--------|--------------|-----|
| break-won stages (n=14) | P@5 0.143 | 0.129 |
| bunch-won stages (n=77) | P@5 0.304 | 0.319 |
| **overall** | 0.279 | **0.290** |

It helps exactly where expected and hurts where expected, but bunch stages
outnumber break stages 77:14, so the blanket marginal smear is **net-negative on
the gate → not shipped.** Lesson: a breakaway is a per-race *scenario* (one break
rider wins, the bunch loses), not a probability to spread across every rider's
marginal. **Moved to step 4 (Monte Carlo):** on a break-scenario sim one break
rider takes the win/placement; bunch sims stay clean — capturing break upside for
the growth/EV objective without corrupting point predictions. `breakSkill` +
`cfg.breakawayWinRate` are kept in place to feed that sim.

Current shipped model: step 1b + route climbiness, **P@5 0.290 / P@15 0.351**
(rank-only 0.259 / 0.312).

## 4e. Step 4 RESULTS — Monte Carlo simulator (2026-06-25)

`engine/simulate.ts`: seeded (mulberry32) Plackett–Luce stage simulator. Each sim
is a full finishing permutation; break-vs-bunch is a per-race SCENARIO (Bernoulli
at `cfg.breakawayWinRate`) — on a break sim a breakaway pool (by `breakSkill`)
fills the front and the bunch finishes behind; DNFs drop out of classification.
Aggregated to coherent marginals. 85 tests pass (6 new); `tsc` clean. ~10s for the
whole 91-stage backtest at 2000 sims/stage.

Harness, sim vs analytic:

| metric | analytic | MODEL-sim |
|--------|----------|-----------|
| Precision@5 | **0.290** | 0.277 |
| Precision@15 | 0.351 | **0.355** |
| Top15 Brier | 0.0958 | **0.0896** (best of all) |
| break-won P@5 (n=14) | 0.129 | **0.143** |
| bunch-won P@5 (n=77) | **0.319** | 0.301 |

As predicted, the sim's *marginals* mirror the analytic (slightly lower P@5 from
spreading break mass; recovers break-won stages) — its standout is **best-in-class
top-15 calibration**, which is exactly what Etapebonus (count-of-top-15) needs. The
sim's real, not-yet-measured value is the **joint** EV (correlated Etapebonus /
Holdbonus / captain from internally-consistent samples).

Decision pending (see §5): the sim is sound and the right substrate for joint team
EV, but swapping it in as the *marginal* finish-predictor would mildly regress P@5
/ placement-MAE. Recommended split: keep the analytic coherent model as the fast
marginal predictor, use the sim for the optimiser's joint team evaluation
(Etapebonus from correlated samples) — needs a joint metric to validate.

## 5. Open questions for the user (review checkpoints)
1. Confirm the **break-vs-bunch split** is worth the modelling weight — it's the
   single biggest lever for the growth objective (cheap break riders winning) and
   the hardest to calibrate.
2. After step 1's baseline numbers, decide whether the marginal accuracy of the
   **full Monte Carlo** (step 4) justifies its complexity vs. the enhanced analytic
   model — the harness will make this a numbers call, not a guess.
3. Whether to also add an **odds + weather scraper to the nightly GitHub workflow**
   (reduces reliance on manual odds), given Phase-2 browsing is uncertain.
