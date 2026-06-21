// ── Result logger: actual growth from a stageResult block (§1, §9) ───────────
// Applies the EXACT §1 rules to a logged stage result to compute every rider's
// realised growth, then rolls prices forward and updates the manager's bank
// (captain bonus, Etapebonus, 0.5% interest). This is what makes the daily loop
// recompute reality from one pasted block.

import type {
  StageResultBlock,
  Rider,
  Stage,
  GrowthBreakdown,
  JerseyKey,
} from './types';
import {
  placementGrowth,
  gcGrowth,
  pointsGrowth,
  lateArrival,
  holdbonus,
  tttGrowth,
  etapebonus,
  applyInterest,
  captainBonus as captainBonusFn,
  JERSEY_PAYOUT,
  DNF_PENALTY,
  DNS_PER_STAGE,
} from './rules';
import { matchRider, NameMatch } from './importSchema';

export interface RiderStageGrowth {
  riderId: string;
  growth: number;
  breakdown: GrowthBreakdown;
  finished: boolean; // false if DNF/DNS this stage
  pos?: number;
}

export interface StageGrowthResult {
  /** realised growth for every roster rider that was matched in the block */
  byRider: Record<string, RiderStageGrowth>;
  /** names in the block that could not be matched to the roster */
  unmatched: Array<{ name: string; bestScore: number }>;
  /** team (stage) placing 1..3 by team name, for Holdbonus transparency */
  teamStagePlacing: Record<string, number>;
}

/** Compute realised growth for the whole field from one logged stage. */
export function computeStageGrowth(
  block: StageResultBlock,
  roster: Rider[],
  stage: Stage,
  opts: {
    /** riders already abandoned BEFORE this stage → −100k each this stage */
    alreadyAbandoned?: Set<string>;
    lastStage?: number;
  } = {},
): StageGrowthResult {
  const isTTT = block.isTTT || stage.type === 'ttt';
  const unmatched: StageGrowthResult['unmatched'] = [];
  const byRider: Record<string, RiderStageGrowth> = {};

  const resolve = (name: string): string | null => {
    const m: NameMatch = matchRider(name, roster);
    if (!m.riderId) {
      unmatched.push({ name, bestScore: Number(m.score.toFixed(2)) });
      return null;
    }
    return m.riderId;
  };

  // ── Stage team placing (for Holdbonus): from explicit field or derived ──
  const teamStagePlacing: Record<string, number> = {};
  const podiumTeams = block.teamResultTop3 ?? derivePodiumTeams(block, roster);
  podiumTeams.slice(0, 3).forEach((team, i) => {
    if (team) teamStagePlacing[normalizeTeam(team)] = i + 1;
  });

  // ── TTT team placement lookup ──
  const tttPlaceByTeam: Record<string, number> = {};
  if (isTTT && block.tttTeamOrder) {
    block.tttTeamOrder.forEach((team, i) => {
      tttPlaceByTeam[normalizeTeam(team)] = i + 1;
    });
  }

  const dnfSet = new Set((block.dnf ?? []).map((n) => resolve(n)).filter(Boolean) as string[]);
  const dnsSet = new Set((block.dns ?? []).map((n) => resolve(n)).filter(Boolean) as string[]);
  const jerseyByRider = resolveJerseys(block.jerseys, roster, unmatched);

  const seen = new Set<string>();

  for (const row of block.results) {
    const id = resolve(row.rider);
    if (!id) continue;
    seen.add(id);
    const rider = roster.find((r) => r.id === id)!;
    const finished = !dnfSet.has(id) && !dnsSet.has(id);

    const bd: GrowthBreakdown = {
      placement: 0, sprintMtn: 0, gc: 0, jerseys: 0,
      holdbonus: 0, lateArrival: 0, dnfRisk: 0, ttt: 0,
    };

    // Sprint/mountain points are earned even on DNF.
    bd.sprintMtn = pointsGrowth(row.sprintPts ?? 0, row.mtnPts ?? 0);
    // GC bonus from post-stage GC position (if supplied).
    bd.gc = gcGrowth(row.gcPos);
    // Jerseys earned that day.
    bd.jerseys = jerseyByRider[id] ?? 0;

    if (isTTT) {
      // TTT REPLACES placement, Holdbonus, late arrival, Etapebonus.
      const place = tttPlaceByTeam[normalizeTeam(rider.team)];
      if (finished && place) bd.ttt = tttGrowth(place);
    } else {
      if (finished) {
        bd.placement = placementGrowth(row.pos);
        bd.lateArrival = lateArrival(row.gap ?? 0);
        // Holdbonus: rider's team placed top-3 on the stage; not paid on DNF.
        const tp = teamStagePlacing[normalizeTeam(rider.team)];
        if (tp) bd.holdbonus = holdbonus(tp);
      }
    }

    if (dnfSet.has(id)) bd.dnfRisk = DNF_PENALTY;
    // DNS this stage = DNF penalty this stage (the −100k/stage starts NEXT stage).
    if (dnsSet.has(id)) bd.dnfRisk = DNF_PENALTY;

    const growth = sumBreakdown(bd);
    byRider[id] = { riderId: id, growth, breakdown: bd, finished, pos: row.pos };
  }

  // Riders in the block's dnf/dns lists but not in results.
  for (const id of [...dnfSet, ...dnsSet]) {
    if (seen.has(id)) continue;
    const bd: GrowthBreakdown = {
      placement: 0, sprintMtn: 0, gc: 0, jerseys: jerseyByRider[id] ?? 0,
      holdbonus: 0, lateArrival: 0, dnfRisk: DNF_PENALTY, ttt: 0,
    };
    byRider[id] = { riderId: id, growth: sumBreakdown(bd), breakdown: bd, finished: false };
  }

  // Previously-abandoned riders: −100k for this (not-started) stage.
  const lastStage = opts.lastStage ?? 21;
  if (opts.alreadyAbandoned && stage.stage <= lastStage) {
    for (const id of opts.alreadyAbandoned) {
      if (byRider[id]) continue;
      const bd: GrowthBreakdown = {
        placement: 0, sprintMtn: 0, gc: 0, jerseys: 0,
        holdbonus: 0, lateArrival: 0, dnfRisk: DNS_PER_STAGE, ttt: 0,
      };
      byRider[id] = { riderId: id, growth: DNS_PER_STAGE, breakdown: bd, finished: false };
    }
  }

  return { byRider, unmatched, teamStagePlacing };
}

export interface TeamBankUpdate {
  captainBonus: number;
  etapebonus: number;
  interest: number;
  /** sum of owned riders' realised growth this stage */
  teamGrowth: number;
  newBank: number;
}

/**
 * Apply a computed stage growth to the manager's bank: captain bonus (positive
 * captain growth again), Etapebonus from owned riders in stage top-15, and
 * 0.5% interest. Rider VALUES roll forward separately (newPrice = price + growth).
 */
export function applyToTeam(
  growth: StageGrowthResult,
  ownedRiderIds: string[],
  captainId: string | undefined,
  bank: number,
  topResults: StageResultBlock['results'],
  roster: Rider[],
): TeamBankUpdate {
  const owned = new Set(ownedRiderIds);

  // Etapebonus: how many owned riders finished in the stage top-15.
  let inTop15 = 0;
  for (const row of topResults) {
    if (row.pos >= 1 && row.pos <= 15) {
      const m = matchRider(row.rider, roster);
      if (m.riderId && owned.has(m.riderId)) inTop15++;
    }
  }
  const etape = etapebonus(inTop15);

  // Captain bonus: captain's positive growth this stage paid again.
  let capBonus = 0;
  if (captainId && growth.byRider[captainId]) {
    capBonus = captainBonusFn(growth.byRider[captainId].growth);
  }

  const teamGrowth = ownedRiderIds.reduce(
    (a, id) => a + (growth.byRider[id]?.growth ?? 0),
    0,
  );

  // Interest applies to bank; bonuses land in bank too.
  const interest = Math.round(bank * 0.005);
  const newBank = applyInterest(bank) + capBonus + etape;

  return { captainBonus: capBonus, etapebonus: etape, interest, teamGrowth, newBank };
}

/** Roll a rider's value forward. Trust an explicit newPrice if provided. */
export function rollPrice(oldPrice: number, growth: number, newPrice?: number): number {
  if (typeof newPrice === 'number' && newPrice > 0) return Math.round(newPrice);
  return Math.max(0, Math.round(oldPrice + growth));
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sumBreakdown(bd: GrowthBreakdown): number {
  return bd.placement + bd.sprintMtn + bd.gc + bd.jerseys +
    bd.holdbonus + bd.lateArrival + bd.dnfRisk + bd.ttt;
}

function normalizeTeam(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function derivePodiumTeams(block: StageResultBlock, roster: Rider[]): string[] {
  const order = [...block.results].sort((a, b) => a.pos - b.pos);
  const teams: string[] = [];
  for (const row of order) {
    const m = matchRider(row.rider, roster);
    const team = m.riderId ? roster.find((r) => r.id === m.riderId)!.team : null;
    if (team && !teams.includes(team)) teams.push(team);
    if (teams.length >= 3) break;
  }
  return teams;
}

function resolveJerseys(
  jerseys: StageResultBlock['jerseys'],
  roster: Rider[],
  unmatched: StageGrowthResult['unmatched'],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!jerseys) return out;
  (Object.keys(jerseys) as JerseyKey[]).forEach((key) => {
    const name = jerseys[key];
    if (!name) return;
    const m = matchRider(name, roster);
    if (m.riderId) out[m.riderId] = (out[m.riderId] ?? 0) + JERSEY_PAYOUT[key];
  });
  return out;
}
