'use client';
import { useMemo } from 'react';
import { useStore, effectiveContracts } from '@/lib/store';
import { useHydrated } from '@/lib/useHydrated';
import { StageBar } from './components/StageBar';
import { projectField } from '@/engine/growth';
import { optimize } from '@/engine/optimizer';
import { forwardValues } from '@/engine/horizon';
import type { OptimizerInput, RiskPreset, OptimizedTeam } from '@/engine/types';
import { kr, growth, priceM, ARCHE_LABEL } from '@/lib/format';

const RISKS: RiskPreset[] = ['safe', 'balanced', 'aggressive'];

export default function OptimalPage() {
  const hydrated = useHydrated();
  const s = useStore();
  const stage = s.stages.find((x) => x.stage === s.selectedStage)!;

  const projections = useMemo(
    () => (hydrated ? projectField(s.riders, stage, s.config) : []),
    [hydrated, s.riders, stage, s.config],
  );

  // Real buying power = bank + the value of riders you'd sell. Holding a team
  // ties up value in riders, so the team budget is NOT just the leftover bank.
  const ownedValue = useMemo(
    () => s.currentTeamIds.reduce((a, id) => a + (s.riders.find((r) => r.id === id)?.price ?? 0), 0),
    [s.currentTeamIds, s.riders],
  );
  const buyingPower = s.bank + ownedValue;

  // Forward-looking value (to the next rest day) baked into selection — no knob.
  const forward = useMemo(
    () => (hydrated ? forwardValues(s.riders, s.stages, s.selectedStage, s.config) : null),
    [hydrated, s.riders, s.stages, s.selectedStage, s.config],
  );

  // Fees only bite once the race has started (initial squad / stage-1 are free).
  const chargeFees = s.loggedStages.length > 0;

  const baseInput = useMemo<OptimizerInput>(() => ({
    stage,
    riders: s.riders,
    projections,
    budget: buyingPower,
    currentTeam: s.currentTeamIds.length === 8 ? s.currentTeamIds : undefined,
    teamType: s.teamType,
    contractsRemaining: effectiveContracts(s.contractsRemaining),
    risk: s.risk,
    forwardValueById: forward?.values,
    chargeFees,
  }), [stage, s.riders, projections, buyingPower, s.currentTeamIds, s.teamType, s.contractsRemaining, s.risk, forward, chargeFees]);

  const recommended = useMemo(() => (hydrated ? optimize(baseInput) : null), [hydrated, baseInput]);

  // Odds coverage for this stage: how much of the field is market-driven vs pure
  // model guesswork. Low coverage → trust the EV less.
  const oddsCoverage = useMemo(() => {
    const starters = s.riders.filter((r) => r.injury !== 'out');
    const withOdds = starters.filter((r) => {
      const o = r.odds;
      return !!o && (!!o.win || !!o.top3 || !!o.top5 || !!o.top10);
    }).length;
    return { withOdds, total: starters.length, pct: starters.length ? withOdds / starters.length : 0 };
  }, [s.riders]);

  // The three risk presets side by side (§8.2 "show how the team changes").
  const presets = useMemo(() => {
    if (!hydrated) return {} as Record<RiskPreset, OptimizedTeam>;
    const out = {} as Record<RiskPreset, OptimizedTeam>;
    for (const r of RISKS) out[r] = optimize({ ...baseInput, risk: r });
    return out;
  }, [hydrated, baseInput]);

  if (!hydrated || !recommended || !forward) return <div className="mono p-8 text-center text-chalk-500">Optimising…</div>;

  const riderById = new Map(s.riders.map((r) => [r.id, r]));
  const projById = new Map(projections.map((p) => [p.riderId, p]));

  return (
    <div>
      <StageBar />

      {/* control bar */}
      <div className="card mb-3 grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        <label className="block">
          <span className="mono text-[11px] text-chalk-500">BANK (kr)</span>
          <input
            type="number"
            className="input mt-1 w-full"
            value={s.bank}
            onChange={(e) => s.setBank(Number(e.target.value))}
          />
          <span className="mono text-[10px] text-chalk-500">
            buying power {(buyingPower / 1_000_000).toFixed(1)}M{ownedValue > 0 ? ` (bank + ${(ownedValue / 1_000_000).toFixed(1)}M team)` : ''}
          </span>
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
          <span className="mono text-[10px] text-chalk-500">
            Max EV · plans through stage {forward.stages[forward.stages.length - 1] ?? s.selectedStage}{!chargeFees ? ' · transfers free (pre-race)' : ''}
          </span>
        </div>
        <div>
          <span className="mono text-[11px] text-chalk-500">ODDS COVERAGE</span>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-ink-700">
            <div className={`h-full ${oddsCoverage.pct >= 0.5 ? 'bg-green' : oddsCoverage.pct >= 0.2 ? 'bg-yellow' : 'bg-polka'}`}
              style={{ width: `${Math.round(oddsCoverage.pct * 100)}%` }} />
          </div>
          <span className="mono text-[10px] text-chalk-500">
            {oddsCoverage.withOdds}/{oddsCoverage.total} riders have odds ({Math.round(oddsCoverage.pct * 100)}%)
            {oddsCoverage.pct < 0.2 ? ' — mostly model guesswork; paste an odds block' : ''}
          </span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* recommended team */}
        <div className="card p-3 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="mono text-sm font-bold">RECOMMENDED XI <span className="text-chalk-500">· {s.risk} · max EV</span></h2>
            <button className="btn-accent" onClick={() => s.setTeam(recommended.riderIds, recommended.captainId)}>Adopt this team</button>
          </div>
          <table className="sheet">
            <thead><tr><th>Rider</th><th>Team</th><th>Arch</th><th>Price</th><th>xG (stage)</th><th>Block</th><th></th></tr></thead>
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
                    <td className="text-chalk-300" title="discounted xG through the rest of this block (to the next rest day)">{growth(forward.values[r.id] ?? 0)}</td>
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
      {(() => {
        const noTeam = s.currentTeamIds.length !== 8;
        const captainChange = !noTeam && recommended.captainId !== s.captainId;
        const ridersChange = recommended.buys.length > 0;
        const recCaptainName = riderById.get(recommended.captainId)?.name ?? '—';
        const curCaptainName = s.captainId ? (riderById.get(s.captainId)?.name ?? '—') : 'none set';
        const nm = (id: string) => riderById.get(id)?.name ?? '(unknown rider)';

        return (
          <div className="card mt-3 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="mono text-sm font-bold">WHAT TO ACTUALLY DO</h2>
              {!noTeam && (ridersChange || captainChange) && (
                <button className="btn-accent" onClick={() => s.setTeam(recommended.riderIds, recommended.captainId)}>
                  Apply all
                </button>
              )}
            </div>

            {noTeam ? (
              <p className="text-sm text-chalk-300">
                Pick your current 8 riders (on the <span className="j-yellow">Riders</span> page or by adopting a team) to get
                concrete sell/buy moves and a keep-vs-swap comparison. Right now this is a from-scratch build — the recommended
                captain is <span className="j-yellow">{recCaptainName}</span>.
              </p>
            ) : !ridersChange && !captainChange ? (
              <p className="text-sm j-green">
                Stand pat — your 8 riders and captain (<span className="j-yellow">{recCaptainName}</span>) already maximise
                expected net growth for this stage.
              </p>
            ) : (
              <div className="space-y-2 text-sm">
                {ridersChange && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <div>
                      <div className="mono text-[11px] text-chalk-500">SELL</div>
                      {recommended.sells.map((id) => <div key={id} className="j-polka">− {nm(id)}</div>)}
                    </div>
                    <div>
                      <div className="mono text-[11px] text-chalk-500">BUY</div>
                      {recommended.buys.map((id) => (
                        <div key={id} className="j-green">+ {nm(id)} <span className="text-chalk-500">({priceM(riderById.get(id)!.price)})</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {captainChange && (
                  <div className="flex items-center gap-2">
                    <span className="mono text-[11px] text-chalk-500">CAPTAIN</span>
                    <span className="text-sm">
                      {ridersChange ? <>captain the new XI’s <span className="j-yellow">{recCaptainName}</span></>
                        : <>keep your 8 — switch captain from <span className="text-chalk-300">{curCaptainName}</span> to <span className="j-yellow">{recCaptainName}</span></>}
                    </span>
                    <button className="btn !py-0.5" onClick={() => s.setCaptain(recommended.captainId)}>Set ©</button>
                  </div>
                )}

                {ridersChange && (
                  <div className="mono text-xs text-chalk-300">
                    Fee cost {growth(-recommended.transferFees)} · net expected gain vs standing pat{' '}
                    <span className={recommended.netGainVsHold >= 0 ? 'j-green' : 'j-polka'}>{growth(recommended.netGainVsHold)}</span>
                  </div>
                )}
                {ridersChange && recommended.netGainVsHold < 0 && (
                  <p className="j-polka text-xs">↳ The fees outweigh the gain across your horizon — consider keeping your riders (the captain switch above is still free).</p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* why these riders — forward value to the next rest day */}
      <div className="card mt-3 p-3">
        <h2 className="mono mb-2 text-sm font-bold">WHY THESE RIDERS · through stage {forward.stages[forward.stages.length - 1] ?? s.selectedStage}</h2>
        <p className="mono mb-2 text-[10px] text-chalk-500">
          The squad is chosen for its value over the rest of this block (auto-horizon to the next rest day), not just today —
          so a rider who is better across the upcoming stages is preferred even if someone else edges this one stage.
        </p>
        <div className="grid gap-1 sm:grid-cols-2">
          {recommended.riderIds
            .map((id) => ({ r: riderById.get(id)!, hv: forward.hv[id] }))
            .sort((a, b) => (b.hv?.value ?? 0) - (a.hv?.value ?? 0))
            .map(({ r, hv }) => (
              <div key={r.id} className="mono text-[11px] text-chalk-300">
                <span className="text-chalk-100">{r.name}</span>:{' '}
                {hv?.keyStages.length
                  ? <>peaks on stages <span className="j-green">{hv.keyStages.join(', ')}</span> · block value {growth(hv.value)}</>
                  : <>steady · block value {growth(hv?.value ?? 0)}</>}
              </div>
            ))}
        </div>
      </div>

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

function Metric({ label, value, accent, big }: { label: string; value: string; accent?: 'yellow' | 'green' | 'polka'; big?: boolean }) {
  const cls = accent === 'yellow' ? 'j-yellow' : accent === 'green' ? 'j-green' : accent === 'polka' ? 'j-polka' : 'text-chalk-100';
  return (
    <div className="flex items-baseline justify-between">
      <span className="mono text-[11px] text-chalk-500">{label}</span>
      <span className={`mono tnum ${big ? 'text-lg font-bold' : 'text-sm'} ${cls}`}>{value}</span>
    </div>
  );
}
