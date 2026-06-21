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
  /** decimal betting odds, optional, additive only */
  odds?: RiderOdds;
  /** manual popular-ownership guess (%) for differential mode, optional */
  ownershipPct?: number;
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

export interface OptimizerInput {
  stage: Stage;
  riders: Rider[];
  projections: RiderProjection[];
  budget: number; // available spend (current bank or 50M)
  currentTeam?: string[]; // rider ids currently owned (for fee-free keeps)
  teamType: TeamType;
  contractsRemaining: number; // Infinity for guld
  risk: RiskPreset;
  /** differential-aware objective: subtract leverage of template riders */
  differential?: boolean;
}

export interface OptimizedTeam {
  riderIds: string[];
  captainId: string;
  expectedGrowth: number; // sum of rider xG (no fees)
  expectedGrowthAfterFees: number;
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
  odds: Array<{ rider: string } & RiderOdds>;
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

export type ImportBlock = StageResultBlock | OddsBlock | StartlistBlock;
