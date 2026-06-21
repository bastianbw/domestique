'use client';
import { useMemo } from 'react';
import { useStore, effectiveContracts } from '@/lib/store';
import { useHydrated } from '@/lib/useHydrated';
import { StageBar } from './components/StageBar';
import { projectField } from '@/engine/growth';
import { optimize } from '@/engine/optimizer';
import { horizonValues, keepVsSwap } from '@/engine/horizon';
import type { OptimizerInput, RiskPreset, OptimizedTeam } from '@/engine/types';
import { kr, growth, priceM, pct, ARCHE_LABEL } from '@/lib/format';

const RISKS: RiskPreset[] = ['safe', 'balanced', 'aggressive'];

export default function OptimalPage() {
  const hydrated = useHydrated();
  const s = useStore();
  const stage = s.stages.find((x) => x.stage === s.selectedStage)!;

  const projections = useMemo(
    () => (hydrated ? projectField(s.riders, stage, s.config) : []),
    [hydrated, s.riders, stage, s.config],
  );

  const baseInput = useMemo<OptimizerInput>(() => ({
    stage,
    riders: s.riders,
    projections,
    budget: s.bank,
    currentTeam: s.currentTeamIds.length === 8 ? s.currentTeamIds : undefined,
    teamType: s.teamType,
    contractsRemaining: effectiveContracts(s.contractsRemaining),
    risk: s.risk,
    differential: s.differential,
  }), [stage, s.riders, projections, s.bank, s.currentTeamIds, s.teamType, s.contractsRemaining, s.risk, s.differential]);

  const recommended = useMemo(() => (hydrated ? optimize(baseInput) : null), [hydrated, baseInput]);

  // The three risk presets side by side (§8.2 "show how the team changes").
  const presets = useMemo(() => {
    if (!hydrated) return {} as Record<RiskPreset, OptimizedTeam>;
    const out = {} as Record<RiskPreset, OptimizedTeam>;
    for (const r of RISKS) out[r] = optimize({ ...baseInput, risk: r });
    return out;
  }, [hydrated, baseInput]);

  // Horizon reasoning across the upcoming stages.
  const horizon = useMemo(() => {
    if (!hydrated || !recommended) return null;
    const upcoming = s.stages.filter((x) => x.stage >= s.selectedStage).slice(0, s.horizonDepth);
    const hv = horizonValues(s.riders, upcoming, s.config, s.horizonDepth);
    return { hv, upcoming };
  }, [hydrated, recommended, s.riders, s.stages, s.selectedStage, s.config, s.horizonDepth]);

  if (!hydrated || !recommended) return <div className="mono p-8 text-center text-chalk-500">Optimising…</div>;

  const riderById = new Map(s.riders.map((r) => [r.id, r]));
  const projById = new Map(projections.map((p) => [p.riderId, p]));

  return (
    <div>
      <StageBar />

      {/* control bar */}
      <div className="card mb-3 grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
        <label className="block">
          <span className="mono text-[11px] text-chalk-500">BANK / BUDGET (kr)</span>
          <input
            type="number"
            className="input mt-1 w-full"
            value={s.bank}
            onChange={(e) => s.setBank(Number(e.target.value))}
          />
        </label>
        <div>
          <span className="mono text-[11px] text-chalk-500">RISK</span>
          <div className="mt-1 flex gap-1">
            {RISKS.map((r) => (
              <button key={r} onClick={() => s.setRisk(r)}
                className={`mono flex-1 rounded px-1 py-1 text-[11px] capitalize ${s.risk === r ? 'bg-yellow text-ink-900 font-bold' : 'bg-ink-700 text-chalk-300'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mono text-[11px] text-chalk-500">OBJECTIVE</span>
          <div className="mt-1 flex gap-1">
            <button onClick={() => s.setDifferential(false)}
              className={`mono flex-1 rounded px-1 py-1 text-[11px] ${!s.differential ? 'bg-green text-ink-900 font-bold' : 'bg-ink-700 text-chalk-300'}`}>Max EV</button>
            <button onClick={() => s.setDifferential(true)}
              className={`mono flex-1 rounded px-1 py-1 text-[11px] ${s.differential ? 'bg-green text-ink-900 font-bold' : 'bg-ink-700 text-chalk-300'}`}>Differential</button>
          </div>
        </div>
        <label className="block">
          <span className="mono text-[11px] text-chalk-500">HORIZON (stages)</span>
          <input type="number" min={1} max={8} className="input mt-1 w-full"
            value={s.horizonDepth} onChange={(e) => s.setHorizonDepth(Number(e.target.value))} />
        </label>
      </div>

      {/* my saved team — persists in this browser and is the baseline next day */}
      <MyTeamPanel riderById={riderById} />

      <div className="grid gap-3 lg:grid-cols-3">
        {/* recommended team */}
        <div className="card p-3 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="mono text-sm font-bold">RECOMMENDED XI <span className="text-chalk-500">· {s.risk}{s.differential ? ' · differential' : ''}</span></h2>
            <button className="btn-accent" onClick={() => s.setTeam(recommended.riderIds, recommended.captainId)}>Adopt this team</button>
          </div>
          <table className="sheet">
            <thead><tr><th>Rider</th><th>Team</th><th>Arch</th><th>Price</th><th>xG</th><th>P(t15)</th><th></th></tr></thead>
            <tbody>
              {recommended.riderIds
                .map((id) => ({ r: riderById.get(id)!, p: projById.get(id)! }))
                .sort((a, b) => b.p.xG - a.p.xG)
                .map(({ r, p }) => (
                  <tr key={r.id}>
                    <td className="!font-sans font-medium">
                      {r.name}
                      {recommended.captainId === r.id && <span className="ml-1 chip bg-yellow/20 j-yellow">©  captain</span>}
                      {recommended.buys.includes(r.id) && <span className="ml-1 chip bg-green/15 j-green">buy</span>}
                    </td>
                    <td className="text-chalk-300">{r.team}</td>
                    <td className="text-chalk-500">{ARCHE_LABEL[r.archetype]}</td>
                    <td>{priceM(r.price)}</td>
                    <td className="j-green">{growth(p.xG)}</td>
                    <td>{pct(p.pTop15)}</td>
                    <td>{recommended.captainId !== r.id && (
                      <button className="mono text-[11px] text-chalk-500 hover:j-yellow" onClick={() => s.setCaptain(r.id)}>set ©</button>
                    )}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* metrics */}
        <div className="card space-y-1 p-3">
          <h2 className="mono mb-2 text-sm font-bold">EXPECTED RETURN</h2>
          <Metric label="Σ rider xG" value={growth(recommended.expectedGrowth)} />
          <Metric label="Captain bonus" value={growth(recommended.captainBonus)} accent="yellow" />
          <Metric label="Exp. Etapebonus" value={growth(recommended.expectedEtapebonus)} accent="green" />
          <Metric label="Exp. Holdbonus" value={growth(recommended.expectedHoldbonus)} />
          <Metric label="Transfer fees" value={growth(-recommended.transferFees)} accent="polka" />
          <div className="my-1 border-t border-ink-600" />
          <Metric label="Net after fees" value={growth(recommended.expectedGrowthAfterFees)} big />
          <div className="my-1 border-t border-ink-600" />
          <Metric label="Spend" value={`${kr(recommended.spend)} kr`} />
          <Metric label="Bank left" value={`${kr(recommended.bankLeft)} kr`} />
          {s.teamType === 'basis' && <Metric label="Contracts used" value={`${recommended.contractsUsed}`} />}
        </div>
      </div>

      {/* what to actually do */}
      <div className="card mt-3 p-3">
        <h2 className="mono mb-2 text-sm font-bold">WHAT TO ACTUALLY DO</h2>
        {s.currentTeamIds.length !== 8 ? (
          <p className="text-sm text-chalk-300">
            Pick your current 8 riders (on the <span className="j-yellow">Riders</span> page or by adopting a team) to get concrete sell/buy moves and a keep-vs-swap comparison. Right now this is a from-scratch build.
          </p>
        ) : recommended.buys.length === 0 ? (
          <p className="text-sm j-green">Stand pat — your current team already maximises expected net growth for this stage.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div>
                <div className="mono text-[11px] text-chalk-500">SELL</div>
                {recommended.sells.map((id) => <div key={id} className="j-polka">− {riderById.get(id)?.name}</div>)}
              </div>
              <div>
                <div className="mono text-[11px] text-chalk-500">BUY</div>
                {recommended.buys.map((id) => <div key={id} className="j-green">+ {riderById.get(id)?.name} <span className="text-chalk-500">({priceM(riderById.get(id)!.price)})</span></div>)}
              </div>
            </div>
            <div className="mono text-xs text-chalk-300">
              Fee cost {growth(-recommended.transferFees)} · net expected gain vs standing pat{' '}
              <span className={recommended.netGainVsHold >= 0 ? 'j-green' : 'j-polka'}>{growth(recommended.netGainVsHold)}</span>
            </div>
            {recommended.netGainVsHold < 0 && (
              <p className="j-polka text-xs">↳ The fees outweigh the gain across your horizon — consider keeping your team.</p>
            )}
          </div>
        )}
      </div>

      {/* horizon reasoning */}
      {horizon && (
        <div className="card mt-3 p-3">
          <h2 className="mono mb-2 text-sm font-bold">HORIZON · stages {horizon.upcoming.map((x) => x.stage).join(', ')}</h2>
          <div className="grid gap-1 sm:grid-cols-2">
            {recommended.riderIds
              .map((id) => ({ r: riderById.get(id)!, hv: horizon.hv[id] }))
              .sort((a, b) => (b.hv?.value ?? 0) - (a.hv?.value ?? 0))
              .map(({ r, hv }) => (
                <div key={r.id} className="mono text-[11px] text-chalk-300">
                  <span className="text-chalk-100">{r.name}</span>:{' '}
                  {hv?.keyStages.length
                    ? <>suits stages <span className="j-green">{hv.keyStages.join(', ')}</span> · horizon {growth(hv.value)}</>
                    : <>low upcoming value · horizon {growth(hv?.value ?? 0)}</>}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* preset comparison */}
      <div className="card mt-3 p-3">
        <h2 className="mono mb-2 text-sm font-bold">RISK PRESETS — net after fees</h2>
        <div className="grid grid-cols-3 gap-2">
          {RISKS.map((r) => {
            const t = presets[r];
            return (
              <button key={r} onClick={() => s.setRisk(r)}
                className={`rounded border p-2 text-left ${s.risk === r ? 'border-yellow/50 bg-yellow/5' : 'border-ink-600'}`}>
                <div className="mono text-[11px] uppercase text-chalk-500">{r}</div>
                <div className="mono text-sm j-green">{growth(t?.expectedGrowthAfterFees ?? 0)}</div>
                <div className="mono text-[10px] text-chalk-500">cap: {riderById.get(t?.captainId ?? '')?.name?.split(' ').slice(-1)[0]}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MyTeamPanel({ riderById }: { riderById: Map<string, ReturnType<typeof useStore.getState>['riders'][number]> }) {
  const ids = useStore((s) => s.currentTeamIds);
  const captainId = useStore((s) => s.captainId);
  const saveSnapshot = useStore((s) => s.saveSnapshot);
  const clearTeam = useStore((s) => s.clearTeam);
  const snapshots = useStore((s) => s.snapshots);

  if (ids.length === 0) {
    return (
      <div className="card mb-3 p-3 text-sm text-chalk-300">
        <span className="mono text-[11px] text-chalk-500">MY TEAM · </span>
        none saved yet. Press <span className="j-yellow">Adopt this team</span> below, or pick riders on the{' '}
        <span className="j-yellow">Riders</span> page. Your team is remembered in this browser and becomes the
        baseline the optimizer builds from tomorrow (after you log the stage result).
      </div>
    );
  }

  const spend = ids.reduce((a, id) => a + (riderById.get(id)?.price ?? 0), 0);

  return (
    <div className="card mb-3 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="mono text-sm font-bold">MY TEAM</span>
        <span className="mono text-[11px] text-chalk-500">
          {ids.length}/8 · spend {(spend / 1_000_000).toFixed(1)}M · kept in this browser, used as tomorrow’s baseline
        </span>
        <div className="ml-auto flex gap-2">
          <button className="btn !py-1" onClick={() => {
            const name = prompt('Name this saved team', `Team stage ${useStore.getState().selectedStage}`);
            if (name) saveSnapshot(name);
          }}>Save as snapshot</button>
          <button className="btn !py-1 j-polka" onClick={() => { if (confirm('Clear your current team?')) clearTeam(); }}>Clear</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const r = riderById.get(id);
          if (!r) return null;
          return (
            <span key={id} className={`chip border ${captainId === id ? 'border-yellow/50 j-yellow' : 'border-ink-500 text-chalk-300'}`}>
              {captainId === id ? '© ' : ''}{r.name}
            </span>
          );
        })}
      </div>
      {snapshots.length > 0 && (
        <div className="mono mt-2 text-[11px] text-chalk-500">
          {snapshots.length} saved snapshot{snapshots.length > 1 ? 's' : ''} — load them on Stages &amp; Data → ⑦.
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent, big }: { label: string; value: string; accent?: 'yellow' | 'green' | 'polka'; big?: boolean }) {
  const cls = accent === 'yellow' ? 'j-yellow' : accent === 'green' ? 'j-green' : accent === 'polka' ? 'j-polka' : 'text-chalk-100';
  return (
    <div className="flex items-baseline justify-between">
      <span className="mono text-[11px] text-chalk-500">{label}</span>
      <span className={`mono tnum ${big ? 'text-lg font-bold' : 'text-sm'} ${cls}`}>{value}</span>
    </div>
  );
}
