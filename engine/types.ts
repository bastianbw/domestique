// ── Domestique engine: shared types ──────────────────────────────────────────
// Pure data contracts. No React, no DOM. The engine is the single source of
// truth for the Holdet Tourspillet 2026 scoring/prediction model.

export type Archetype =
  | 'sprinter'
  | 'puncheur'
  | 'climber'
  | 'gc'
  | 'rouleur'
  | 'breakaway'
  | 'domestique';

export type StageType =
  | 'flat'
  | 'hilly'
  | 'summit'
  | 'high_mtn'
  | 'ttt' // team time trial (stage 1)
  | 'hilly_itt'; // individual time trial (stage 16)

export type InjuryFlag = 'fit' | 'doubt' | 'out';

export type JerseyKey = 'yellow' | 'green' | 'polka' | 'white' | 'aggressive';

export interface Stage {
  /** 1..21 */
  stage: number;
  date: string; // e.g. "Jul4"
  type: StageType;
  /** A label for the route, e.g. "Tarragona → Barcelona (Montjuïc)" */
  route: string;
  km: number;
  note: string;
  /** total green-jersey points on offer this stage (finish + intermediate sprints) */
  sprintPtsOnOffer: number;
  /** number of intermediate sprints (each ~25 green pts to the winner in 2026) */
  intermediateSprints?: number;
  /** total mountain (KOM) points on offer this stage */
  mtnPtsOnOffer: number;
  /** uphill finish (distinct growth shape from a rolling mountain stage) */
  summitFinish?: boolean;
  /** double intermediate sprint → extra green-jersey points */
  doubleSprint?: boolean;
  /** PCS parcours difficulty score (higher = harder); refines the coarse type */
  profileScore?: number;
  /** total climbing (m); with km gives "climbiness" (vertical-m per km) */
  verticalMeters?: number;
  /** PCS start-list quality score (field strength); scales favourite dominance */
  startlistQuality?: number;
  /** optional Phase-2 weather (neutral when absent — no effect on predictions) */
  weather?: StageWeather;
}

/**
 * Optional per-stage weather. Every field is optional; an absent/empty object is
 * a strict no-op (the modifier factors all return 1). Supplied by the Phase-2
 * `weather` import block.
 */
export interface StageWeather {
  windKph?: number; // sustained wind speed
  windDir?: string; // e.g. "NW" (free text, informational)
  gustRisk?: 'low' | 'med' | 'high'; // gust / echelon lottery risk
  rainProb?: number; // 0..100 chance of rain
  tempC?: number; // air temperature (cold raises attrition)
  crosswindSections?: number; // number of exposed cross-wind sectors
}

export interface Rider {
  id: string;
  name: string;
  team: string;
  archetype: Archetype;
  /** Holdet price in DKK (e.g. 9_500_000) */
  price: number;
  form: number; // 0..100
  pcsRank: number; // 1 = best; large number = weak/unknown
  teamStrength: number; // 0..100, used for TTT and sprint-train/Holdbonus
  gcPosition?: number; // current overall classification position (1 = leader)
  jerseys?: JerseyKey[]; // jerseys currently held
  injury: InjuryFlag;
  breakawayTendency: number; // 0..100 propensity to be in the break
  sprintTrainSupport?: number; // 0..100 quality of lead-out (sprinters)
  /**
   * Decimal betting odds keyed by the stage number they were pasted for. Odds
   * are STAGE-SCOPED on purpose: a market reflects one stage's parcours, so
   * stage-7 sprint odds must never anchor a mountain stage or bleed into the
   * forward-horizon projection of later stages. Absent stage → pure model.
   */
  oddsByStage?: Record<number, RiderOdds>;
  /** manual popular-ownership guess (%) for differential mode, optional */
  ownershipPct?: number;
  /**
   * Optional per-rider terrain affinity: a multiplicative skill adjustment for a
   * given stage type, learned from the rider's OWN history (empirical-Bayes
   * shrunk toward 1). Personalises within an archetype — e.g. a sprinter who
   * climbs unusually well. Neutral (absent → ×1), so the validated archetype
   * model is the prior and behaviour is unchanged until the data supplies it.
   */
  terrainAffinity?: Partial<Record<StageType, number>>;
  /** optional Phase-2 news nudges (neutral when absent); see RiderNews */
  news?: RiderNews;
}

/**
 * Optional per-rider soft news nudges (Phase-2 `news` block). All optional and
 * neutral when absent. `status` maps onto the existing `injury` flag at import
 * time; the remaining "soft" fields live here and feed a small skill multiplier
 * so the validated base model is untouched unless real news is supplied.
 */
export interface RiderNews {
  /** stated intent this stage, e.g. "breakaway" | "gc" | "sprint" | "rest" */
  intent?: string;
  /** team role, e.g. "leader" | "free" | "domestique" */
  role?: string;
  /** motivation context, e.g. "home roads" | "target stage" | "saving for block" */
  motivation?: string;
  /** signed form nudge in form-points (−30..+30), e.g. crash recovery −15 */
  formDelta?: number;
  /** free-text status note (informational; `status` in the block sets injury) */
  note?: string;
}

export interface RiderOdds {
  win?: number;
  top3?: number;
  top5?: number;
  top10?: number;
}

/** A finishing-position probability distribution for one rider on one stage. */
export interface RiderDistribution {
  riderId: string;
  /** probs[i] = P(finishing in position i+1); index 0 == 1st place. */
  probs: number[];
  /** P(does not finish the stage) */
  pDNF: number;
}

/** The model's per-rider expected outputs for a stage. */
export interface RiderProjection {
  riderId: string;
  xG: number; // expected growth (DKK) this stage, individual components only
  pWin: number;
  pTop5: number;
  pTop15: number;
  /** expected growth if this rider is captained (their positive growth counted twice) */
  captainEV: number;
  /** variance of this rider's stage placement+DNF growth (for the mean-variance risk model) */
  gVar: number;
  /** breakdown for transparency */
  breakdown: GrowthBreakdown;
}

export interface GrowthBreakdown {
  placement: number;
  sprintMtn: number;
  gc: number;
  jerseys: number;
  holdbonus: number;
  lateArrival: number;
  dnfRisk: number;
  ttt: number;
}

export type RiskPreset = 'safe' | 'balanced' | 'aggressive';

export type TeamType = 'guld' | 'basis';

/**
 * Per-simulation joint samples from the Monte-Carlo stage simulator, used to
 * score a team's Etapebonus on the EXACT same realisations (so teammate
 * correlation + break/echelon scenarios are respected, not assumed independent).
 */
export interface JointSamples {
  /** starter ids, indexing the per-sim arrays below */
  starterIds: string[];
  /** number of sims */
  nSims: number;
  /** top15[s] = starter indices finishing in the top 15 in sim s */
  top15: number[][];
  /** winner[s] = starter index of the winner in sim s (−1 if none classified) */
  winner: number[];
}

export interface OptimizerInput {
  stage: Stage;
  riders: Rider[];
  projections: RiderProjection[];
  budget: number; // available spend (current bank or 50M)
  currentTeam?: string[]; // rider ids currently owned (for fee-free keeps)
  teamType: TeamType;
  contractsRemaining: number; // Infinity for guld
  risk: RiskPreset;
  /**
   * Forward-looking selection value per rider (discounted xG to the next rest
   * day). When present the optimizer picks the squad on this rather than the
   * single-stage xG, so it prefers a rider who is better across the block.
   * Defaults to each rider's current-stage xG.
   */
  forwardValueById?: Record<string, number>;
  /**
   * Whether the 1% transfer fee applies. False before the race starts (the
   * initial squad and any stage-1 changes are free). Defaults to true.
   */
  chargeFees?: boolean;
  /**
   * Optional Monte-Carlo joint samples for the stage. When present, Etapebonus is
   * scored JOINTLY on these realisations (teammate correlation respected) instead
   * of the Poisson-binomial independence approximation. Only meaningful when the
   * projections come from the simulator path (no odds).
   */
  jointSamples?: JointSamples;
}

export interface OptimizedTeam {
  riderIds: string[];
  captainId: string;
  expectedGrowth: number; // sum of rider xG (no fees)
  expectedGrowthAfterFees: number;
  /** pure forward expected value (the quantity 'balanced' maximises; risk-neutral,
   *  no variance/ceiling/churn terms) — the apples-to-apples number across presets */
  expectedValue: number;
  captainBonus: number;
  expectedEtapebonus: number;
  expectedHoldbonus: number;
  transferFees: number;
  contractsUsed: number;
  spend: number;
  bankLeft: number;
  /** concrete moves vs currentTeam */
  sells: string[];
  buys: string[];
  /** net expected gain of making these moves vs standing pat */
  netGainVsHold: number;
  score: number; // the objective value the optimizer maximised
}

// ── Import-block schemas (the Phase-2 daily bridge) ──────────────────────────

export interface ResultRow {
  rider: string;
  pos: number; // finishing position; use a large number / omit for non-top
  sprintPts?: number;
  mtnPts?: number;
  gap?: number; // seconds behind the winner
  gcPos?: number; // overall (GC) position AFTER this stage, for Sammenlagt bonus
  newPrice?: number; // optional precomputed price from chat-Claude
}

export interface StageResultBlock {
  type: 'stageResult';
  stage: number;
  isTTT?: boolean;
  results: ResultRow[];
  jerseys?: Partial<Record<JerseyKey, string>>;
  dnf?: string[];
  dns?: string[];
  /** top-3 teams on the stage (for Holdbonus); also derivable from results */
  teamResultTop3?: string[];
  /** TTT placement order of teams (1st..5th) when isTTT */
  tttTeamOrder?: string[];
}

export interface OddsBlock {
  type: 'odds';
  stage: number;
  /**
   * Either a per-rider row, or (for a TTT, where the bookmaker's market is on
   * the TEAM, not individual riders) a `team` row — fanned onto every rider
   * on that team for this stage by `applyOdds`.
   */
  odds: Array<({ rider: string } | { team: string }) & RiderOdds>;
}

export interface StartlistBlock {
  type: 'startlist';
  riders: Array<{
    name: string;
    team: string;
    archetype: Archetype;
    price: number;
    form?: number;
    pcsRank?: number;
    teamStrength?: number;
    breakawayTendency?: number;
  }>;
}

/** Optional Phase-2 weather block — applies StageWeather to one stage. */
export interface WeatherBlock extends StageWeather {
  type: 'weather';
  stage: number;
}

/** Optional Phase-2 news block — per-rider soft nudges + status. */
export interface NewsBlock {
  type: 'news';
  stage?: number; // informational; news currently applies to the roster
  items: Array<{
    rider: string;
    status?: InjuryFlag; // maps onto the rider's injury flag
  } & RiderNews>;
}

/**
 * PCS-derived rider features (the data layer that lifts the live app to the
 * backtested accuracy). Patches existing riders by name with history-learned
 * fields — terrain affinity, rank, archetype, form, breakaway tendency — so a
 * pasted/generated block from the ProCyclingStats corpus drives the model the
 * same way the offline backtest does. Every field optional → patch, not replace.
 */
export interface FeaturesBlock {
  type: 'features';
  /** ISO date the features were computed as-of (informational). */
  asOf?: string;
  riders: Array<{
    rider: string;
    archetype?: Archetype;
    pcsRank?: number;
    form?: number;
    teamStrength?: number;
    breakawayTendency?: number;
    terrainAffinity?: Partial<Record<StageType, number>>;
    /** Holdet price in DKK (from the fantasy API) — patches the rider's price. */
    price?: number;
    /** Holdet ownership/popularity % (from the fantasy API) — for differential. */
    ownershipPct?: number;
  }>;
}

export type ImportBlock =
  StageResultBlock | OddsBlock | StartlistBlock | WeatherBlock | NewsBlock | FeaturesBlock;
