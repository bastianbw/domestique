'use client';

// ── App state (Zustand + localStorage) ───────────────────────────────────────
// Each person's data lives in their own browser (§0, §8.8). No backend. The
// store wires the pure engine to persisted UI state and runs the daily loop:
// import blocks → log results → roll prices/bank → recalibrate.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Rider, Stage, RiskPreset, TeamType,
  StageResultBlock, OddsBlock, StartlistBlock, ImportBlock, Archetype,
} from '@/engine/types';
import { STAGES_2026, LAST_STAGE } from '@/engine/stages';
import { defaultConfig, EngineConfig } from '@/engine/config';
import { seedRiders } from './seed';
import {
  computeStageGrowth, applyToTeam, rollPrice,
} from '@/engine/resultLogger';
import { calibrate, CalibrationReport } from '@/engine/calibration';
import { matchRider, parseImportBlock } from '@/engine/importSchema';

export interface Snapshot {
  id: string;
  name: string;
  riderIds: string[];
  captainId?: string;
  stage: number;
}

export interface ImportLogEntry {
  at: number;
  kind: ImportBlock['type'];
  stage?: number;
  summary: string;
  unmatched: string[];
}

interface AppState {
  riders: Rider[];
  stages: Stage[];
  selectedStage: number;
  currentTeamIds: string[];
  captainId?: string;
  bank: number;
  teamType: TeamType;
  /** null = unlimited (Guld). Number = remaining contracts (Basis). */
  contractsRemaining: number | null;
  risk: RiskPreset;
  differential: boolean;
  horizonDepth: number;
  /** optional URL the auto-collector publishes result blocks to (raw JSON) */
  autoFetchUrl: string;
  config: EngineConfig;
  calibrationLog: CalibrationReport[];
  /** previous config snapshots to allow undo of the last calibration */
  configHistory: EngineConfig[];
  snapshots: Snapshot[];
  abandoned: string[];
  loggedStages: number[];
  importLog: ImportLogEntry[];
  lastBankBreakdown?: { captainBonus: number; etapebonus: number; interest: number; teamGrowth: number };

  // ── actions ──
  setSelectedStage: (n: number) => void;
  setBank: (n: number) => void;
  setTeamType: (t: TeamType) => void;
  setContracts: (n: number | null) => void;
  setRisk: (r: RiskPreset) => void;
  setDifferential: (b: boolean) => void;
  setHorizonDepth: (n: number) => void;
  setAutoFetchUrl: (u: string) => void;
  fetchResult: (stage?: number) => Promise<{ ok: boolean; messages: string[] }>;

  toggleRider: (id: string) => void;
  setTeam: (ids: string[], captainId?: string) => void;
  setCaptain: (id: string) => void;
  clearTeam: () => void;

  updateRider: (id: string, patch: Partial<Rider>) => void;
  updateStage: (n: number, patch: Partial<Stage>) => void;
  replaceRiders: (riders: Rider[]) => void;

  importRaw: (raw: string) => { ok: boolean; messages: string[] };
  logResult: (block: StageResultBlock) => { messages: string[]; report?: CalibrationReport };
  undoCalibration: () => void;

  saveSnapshot: (name: string) => void;
  deleteSnapshot: (id: string) => void;
  loadSnapshot: (id: string) => void;

  resetAll: () => void;
}

const FRESH = () => ({
  riders: seedRiders(),
  stages: JSON.parse(JSON.stringify(STAGES_2026)) as Stage[],
  selectedStage: 1,
  currentTeamIds: [] as string[],
  captainId: undefined as string | undefined,
  bank: 50_000_000,
  teamType: 'guld' as TeamType,
  contractsRemaining: null as number | null,
  risk: 'balanced' as RiskPreset,
  differential: false,
  horizonDepth: 3,
  // Pre-wired to the GitHub Action's published feed; harmlessly 404s until the
  // collector runs (during the Tour). Editable on Stages & Data → ①½.
  autoFetchUrl: 'https://raw.githubusercontent.com/bastianbw/domestique/main/data/latest.json',
  config: defaultConfig(),
  calibrationLog: [] as CalibrationReport[],
  configHistory: [] as EngineConfig[],
  snapshots: [] as Snapshot[],
  abandoned: [] as string[],
  loggedStages: [] as number[],
  importLog: [] as ImportLogEntry[],
});

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...FRESH(),

      setSelectedStage: (n) => set({ selectedStage: n }),
      setBank: (n) => set({ bank: n }),
      setTeamType: (t) =>
        set({ teamType: t, contractsRemaining: t === 'guld' ? null : (get().contractsRemaining ?? 8) }),
      setContracts: (n) => set({ contractsRemaining: n }),
      setRisk: (r) => set({ risk: r }),
      setDifferential: (b) => set({ differential: b }),
      setHorizonDepth: (n) => set({ horizonDepth: Math.max(1, Math.min(8, n)) }),
      setAutoFetchUrl: (u) => set({ autoFetchUrl: u.trim() }),

      // Pull a published result block from the auto-collector URL and import it.
      // `{stage}` in the URL is replaced with the stage number when provided.
      fetchResult: async (stage) => {
        const url = get().autoFetchUrl;
        if (!url) return { ok: false, messages: ['No auto-fetch URL set.'] };
        const target = stage ? url.replace('{stage}', String(stage)) : url;
        try {
          const res = await fetch(target, { cache: 'no-store' });
          if (!res.ok) return { ok: false, messages: [`Fetch failed: HTTP ${res.status} from ${target}`] };
          const text = await res.text();
          return get().importRaw(text);
        } catch (e) {
          return { ok: false, messages: [`Could not reach ${target}. Offline, or the collector hasn't published yet.`] };
        }
      },

      toggleRider: (id) => {
        const ids = get().currentTeamIds;
        if (ids.includes(id)) {
          const next = ids.filter((x) => x !== id);
          set({ currentTeamIds: next, captainId: get().captainId === id ? undefined : get().captainId });
        } else if (ids.length < 8) {
          set({ currentTeamIds: [...ids, id] });
        }
      },
      setTeam: (ids, captainId) => set({ currentTeamIds: ids.slice(0, 8), captainId }),
      setCaptain: (id) => set({ captainId: id }),
      clearTeam: () => set({ currentTeamIds: [], captainId: undefined }),

      updateRider: (id, patch) =>
        set({ riders: get().riders.map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
      updateStage: (n, patch) =>
        set({ stages: get().stages.map((s) => (s.stage === n ? { ...s, ...patch } : s)) }),
      replaceRiders: (riders) =>
        set({ riders, currentTeamIds: [], captainId: undefined }),

      importRaw: (raw) => {
        const parsed = parseImportBlock(raw);
        if (!parsed.ok || !parsed.block) {
          return { ok: false, messages: parsed.errors };
        }
        const block = parsed.block;
        if (block.type === 'stageResult') {
          const { messages, report } = get().logResult(block);
          return { ok: true, messages };
        }
        if (block.type === 'odds') {
          return applyOdds(block, get, set);
        }
        if (block.type === 'startlist') {
          return applyStartlist(block, set);
        }
        return { ok: false, messages: ['Unhandled block type.'] };
      },

      logResult: (block) => {
        const st = get();
        const stage = st.stages.find((s) => s.stage === block.stage);
        if (!stage) return { messages: [`Stage ${block.stage} not found.`] };

        const abandonedSet = new Set(st.abandoned);
        const growth = computeStageGrowth(block, st.riders, stage, {
          alreadyAbandoned: abandonedSet,
          lastStage: LAST_STAGE,
        });

        // Roll prices forward for every matched rider.
        const newByPriceId: Record<string, number> = {};
        for (const row of block.results) {
          const m = matchRider(row.rider, st.riders);
          if (!m.riderId) continue;
          const g = growth.byRider[m.riderId];
          const rider = st.riders.find((r) => r.id === m.riderId)!;
          newByPriceId[m.riderId] = rollPrice(rider.price, g?.growth ?? 0, row.newPrice);
          // carry GC position forward if provided
          if (typeof row.gcPos === 'number') newByPriceId[m.riderId + '__gc'] = row.gcPos;
        }

        const riders = st.riders.map((r) => {
          const g = growth.byRider[r.id];
          let price = r.price;
          if (newByPriceId[r.id] !== undefined) price = newByPriceId[r.id];
          else if (g) price = rollPrice(r.price, g.growth);
          const gcPos = newByPriceId[r.id + '__gc'];
          return { ...r, price, gcPosition: typeof gcPos === 'number' ? gcPos : r.gcPosition };
        });

        // Bank update.
        const bankUpd = applyToTeam(
          growth, st.currentTeamIds, st.captainId, st.bank, block.results, st.riders,
        );

        // Track abandonments.
        const newlyAbandoned: string[] = [];
        for (const name of block.dns ?? []) {
          const m = matchRider(name, st.riders);
          if (m.riderId && !abandonedSet.has(m.riderId)) newlyAbandoned.push(m.riderId);
        }

        // Calibration (auto-apply small EMA correction, keep history for undo).
        const { next: nextConfig, report } = calibrate(st.config, stage, block, st.riders);

        set({
          riders,
          bank: bankUpd.newBank,
          abandoned: [...st.abandoned, ...newlyAbandoned],
          loggedStages: st.loggedStages.includes(block.stage)
            ? st.loggedStages
            : [...st.loggedStages, block.stage],
          config: nextConfig,
          configHistory: [...st.configHistory.slice(-10), st.config],
          calibrationLog: [...st.calibrationLog, report],
          lastBankBreakdown: {
            captainBonus: bankUpd.captainBonus,
            etapebonus: bankUpd.etapebonus,
            interest: bankUpd.interest,
            teamGrowth: bankUpd.teamGrowth,
          },
          importLog: [
            {
              at: Date.now(), kind: 'stageResult' as const, stage: block.stage,
              summary: `Stage ${block.stage}: bank ${Math.round(bankUpd.newBank).toLocaleString('da-DK')} kr · ` +
                `captain +${Math.round(bankUpd.captainBonus / 1000)}k · etape +${Math.round(bankUpd.etapebonus / 1000)}k`,
              unmatched: growth.unmatched.map((u) => u.name),
            },
            ...st.importLog,
          ].slice(0, 50),
        });

        const messages = [
          `Logged stage ${block.stage}.`,
          `Team growth ${Math.round(bankUpd.teamGrowth).toLocaleString('da-DK')} kr · captain +${Math.round(bankUpd.captainBonus).toLocaleString('da-DK')} · Etapebonus +${bankUpd.etapebonus.toLocaleString('da-DK')} · interest +${bankUpd.interest.toLocaleString('da-DK')}`,
          `New bank: ${Math.round(bankUpd.newBank).toLocaleString('da-DK')} kr`,
        ];
        if (growth.unmatched.length) {
          messages.push(`⚠ Unmatched names (fix on Stages & Data): ${growth.unmatched.map((u) => u.name).join(', ')}`);
        }
        if (newlyAbandoned.length) {
          messages.push(`Marked abandoned: ${newlyAbandoned.length} rider(s) — −100k/stage from here.`);
        }
        return { messages, report };
      },

      undoCalibration: () => {
        const st = get();
        const prev = st.configHistory[st.configHistory.length - 1];
        if (!prev) return;
        set({
          config: prev,
          configHistory: st.configHistory.slice(0, -1),
          calibrationLog: st.calibrationLog.slice(0, -1),
        });
      },

      saveSnapshot: (name) => {
        const st = get();
        set({
          snapshots: [
            ...st.snapshots,
            { id: `snap_${Date.now()}`, name, riderIds: [...st.currentTeamIds], captainId: st.captainId, stage: st.selectedStage },
          ],
        });
      },
      deleteSnapshot: (id) => set({ snapshots: get().snapshots.filter((s) => s.id !== id) }),
      loadSnapshot: (id) => {
        const s = get().snapshots.find((x) => x.id === id);
        if (s) set({ currentTeamIds: [...s.riderIds], captainId: s.captainId });
      },

      resetAll: () => set({ ...FRESH() }),
    }),
    {
      name: 'domestique-v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

// ── helpers used by importRaw ────────────────────────────────────────────────

function applyOdds(
  block: OddsBlock,
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
): { ok: boolean; messages: string[] } {
  const st = get();
  const unmatched: string[] = [];
  const riders = st.riders.map((r) => ({ ...r }));
  for (const row of block.odds) {
    const m = matchRider(row.rider, riders);
    if (!m.riderId) { unmatched.push(row.rider); continue; }
    const idx = riders.findIndex((r) => r.id === m.riderId);
    riders[idx] = {
      ...riders[idx],
      odds: { win: row.win, top3: row.top3, top5: row.top5, top10: row.top10 },
    };
  }
  set({
    riders,
    importLog: [
      { at: Date.now(), kind: 'odds' as const, stage: block.stage, summary: `Odds for stage ${block.stage}: ${block.odds.length} riders`, unmatched },
      ...st.importLog,
    ].slice(0, 50),
  });
  const messages = [`Applied odds for ${block.odds.length - unmatched.length} riders on stage ${block.stage}.`];
  if (unmatched.length) messages.push(`⚠ Unmatched: ${unmatched.join(', ')}`);
  return { ok: true, messages };
}

function applyStartlist(
  block: StartlistBlock,
  set: (p: Partial<AppState>) => void,
): { ok: boolean; messages: string[] } {
  let seq = 0;
  const riders: Rider[] = block.riders.map((r) => ({
    id: `imp${++seq}`,
    name: r.name,
    team: r.team,
    archetype: (r.archetype ?? 'domestique') as Archetype,
    price: r.price,
    form: r.form ?? 70,
    pcsRank: r.pcsRank ?? 60,
    teamStrength: r.teamStrength ?? 65,
    injury: 'fit',
    breakawayTendency: r.breakawayTendency ?? 20,
  }));
  set({ riders, currentTeamIds: [], captainId: undefined });
  return { ok: true, messages: [`Imported start list: ${riders.length} riders. Existing team cleared.`] };
}

/** Effective contracts for the engine (null → Infinity). */
export function effectiveContracts(n: number | null): number {
  return n === null ? Infinity : n;
}
