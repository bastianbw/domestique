'use client';
import { useMemo } from 'react';
import { useStore, effectiveContracts } from '@/lib/store';
import { useHydrated } from '@/lib/useHydrated';
import { StageBar } from './components/StageBar';
import { RoleIcon, Jersey, CaptainStar, BarMeter, ContribBar, PelotonBanner } from './components/graphics';
import { projectField, fieldHasOdds } from '@/engine/growth';
import { optimize } from '@/engine/optimizer';
import { simulateJoint } from '@/engine/simulate';
import { forwardValues } from '@/engine/horizon';
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

  // Real buying power = bank + the value of riders you'd sell. Holding a team
  // ties up value in riders, so the team budget is NOT just the leftover bank.
  const ownedValue = useMemo(
    () => s.currentTeamIds.reduce((a, id) => a + (s.riders.find((r) => r.id === id)?.price ?? 0), 0),
    [s.currentTeamIds, s.riders],
  );
  const buyingPower = s.bank + ownedValue;

  // Forward-looking value (to the next rest day) baked into selection — no knob.
  // Reuses `projections` (the current stage is always the horizon's first
  // stage) instead of re-running that same Monte Carlo simulation twice.
  const forward = useMemo(
    () => (hydrated ? forwardValues(s.riders, s.stages, s.selectedStage, s.config, projections) : null),
    [hydrated, s.riders, s.stages, s.selectedStage, s.config, projections],
  );

  // Fees only bite once the race has started (initial squad / stage-1 are free).
  const chargeFees = s.loggedStages.length > 0;

  // Joint Monte-Carlo samples for a correlated Etapebonus (no-odds stages only —
  // when odds drive the marginals the sim samples wouldn't match them).
  const jointSamples = useMemo(
    () => (hydrated && !fieldHasOdds(s.riders, s.selectedStage)
      ? simulateJoint(s.riders, stage, s.config).samples
      : undefined),
    [hydrated, s.riders, stage, s.config, s.selectedStage],
  );

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
    forwardVarianceById: forward?.variances,
    chargeFees,
    jointSamples,
  }), [stage, s.riders, projections, buyingPower, s.currentTeamIds, s.teamType, s.contractsRemaining, s.risk, forward, chargeFees, jointSamples]);

  const recommended = useMemo(() => (hydrated ? optimize(baseInput) : null), [hydrated, baseInput]);

  // Odds coverage for this stage: how much of the field is market-driven vs pure
  // model guesswork. Low coverage → trust the EV less.
  const oddsCoverage = useMemo(() => {
    const starters = s.riders.filter((r) => r.injury !== 'out');
    const withOdds = starters.filter((r) => {
      const o = r.oddsByStage?.[s.selectedStage];
      return !!o && (!!o.win || !!o.top3 || !!o.top5 || !!o.top10);
    }).length;
    return { withOdds, total: starters.length, pct: starters.length ? withOdds / starters.length : 0 };
  }, [s.riders, s.selectedStage]);

  // The three risk presets side by side (§8.2 "show how the team changes").
  const presets = useMemo(() => {
    if (!hydrated) return {} as Record<RiskPreset, OptimizedTeam>;
    const out = {} as Record<RiskPreset, OptimizedTeam>;
    for (const r of RISKS) out[r] = optimize({ ...baseInput, risk: r });
    return out;
  }, [hydrated, baseInput]);

  if (!hydrated || !recommended || !forward)
    return <div className="p-16 text-center text-sm text-chalk-500">Optimising the field…</div>;

  const riderById = new Map(s.riders.map((r) => [r.id, r]));
  const projById = new Map(projections.map((p) => [p.riderId, p]));
  const lastStage = forward.stages[forward.stages.length - 1] ?? s.selectedStage;

  const recRows = recommended.riderIds
    .map((id) => ({ r: riderById.get(id)!, p: projById.get(id)! }))
    .sort((a, b) => b.p.xG - a.p.xG);
  const maxXg = Math.max(1, ...recRows.map(({ p }) => p.xG));

  // EV breakdown for the visual bar list
  const breakdown = [
    { label: 'Rider xG', value: recommended.expectedGrowth, tone: 'green' as const },
    { label: 'Captain bonus', value: recommended.captainBonus, tone: 'gold' as const },
    { label: 'Etapebonus', value: recommended.expectedEtapebonus, tone: 'green' as const },
    { label: 'Holdbonus', value: recommended.expectedHoldbonus, tone: 'green' as const },
    { label: 'Transfer fees', value: -recommended.transferFees, tone: 'polka' as const },
  ];
  const evScale = Math.max(1, ...breakdown.map((b) => Math.abs(b.value)));

  return (
    <div className="space-y-5">
      {/* hero */}
      <section className="relative overflow-hidden rounded-2xl border border-ink-500/70 bg-gradient-to-br from-ink-800 to-ink-850 px-5 py-5 shadow-card sm:px-6">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 text-gold/20">
          <PelotonBanner className="h-full w-full" />
        </div>
        <div className="relative max-w-xl">
          <p className="eyebrow">Tour de France 2026 · Holdet.dk</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-chalk-100">Your optimal team for stage {stage.stage}</h1>
          <p className="mt-1.5 text-sm text-chalk-300">
            Picked to maximise expected <span className="text-chalk-100">value growth in DKK</span> through stage {lastStage}, not just today.
          </p>
        </div>
      </section>

      <StageBar />

      {/* control bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="card flex flex-col gap-1 p-4">
          <span className="eyebrow">Buying power (kr)</span>
          {/* Edit TOTAL buying power (cash + team value), not raw cash — entering a
              full budget while owning a team used to double-count. Cash is derived. */}
          <input
            type="number"
            className="input mono mt-0.5 w-full"
            value={buyingPower}
            onChange={(e) => s.setBank(Math.max(0, Number(e.target.value) - ownedValue))}
          />
          <span className="text-[12px] text-chalk-500">
            {ownedValue > 0
              ? <>cash <span className="mono text-chalk-300">{(s.bank / 1_000_000).toFixed(1)}M</span> + <span className="mono text-chalk-300">{(ownedValue / 1_000_000).toFixed(1)}M</span> in your team</>
              : 'cash available for your 8 riders'}
          </span>
        </label>

        <div className="card flex flex-col gap-1 p-4">
          <span className="eyebrow">Risk profile</span>
          <div className="mt-0.5 flex gap-1 rounded-lg border border-ink-500/60 bg-ink-900/50 p-1">
            {RISKS.map((r) => (
              <button key={r} onClick={() => s.setRisk(r)}
                className={`flex-1 rounded-md px-1 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                  s.risk === r ? 'bg-gold text-ink-900' : 'text-chalk-300 hover:bg-ink-700'}`}>
                {r}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-chalk-500">
            Max EV · through stage {lastStage}{!chargeFees ? ' · transfers free' : ''}
          </span>
        </div>

        <div className="card flex flex-col gap-1.5 p-4">
          <span className="eyebrow">Odds coverage</span>
          <BarMeter value={oddsCoverage.pct} max={1} className="mt-1"
            tone={oddsCoverage.pct >= 0.5 ? 'green' : oddsCoverage.pct >= 0.2 ? 'gold' : 'polka'} />
          <span className="text-[12px] text-chalk-500">
            <span className="mono text-chalk-300">{oddsCoverage.withOdds}/{oddsCoverage.total}</span> riders priced ({Math.round(oddsCoverage.pct * 100)}%)
            {oddsCoverage.pct < 0.2 ? ' — mostly model; paste odds' : ''}
          </span>
        </div>
      </div>

      {recommended.riderIds.length < 8 && (
        <div className="card border-polka/40 bg-polka/5 p-4">
          <p className="text-sm j-polka">
            ⚠ Your buying power (<span className="mono">{(buyingPower / 1_000_000).toFixed(1)}M</span>) only affords{' '}
            <span className="mono">{recommended.riderIds.length}</span> riders — the field's cheapest 8 cost more than that.
          </p>
          <p className="mt-1 text-[13px] text-chalk-300">
            Almost always the imported <span className="font-medium">prices are too high</span> (check them on Stages &amp; Data → ④ Edit riders — a top rider should be ~10–12M, not 10,000+). Fix the price column/units in ③, or raise buying power above.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* recommended team */}
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-ink-600/60 px-4 py-3.5">
            <div>
              <h2 className="text-base font-semibold text-chalk-100">Recommended XI</h2>
              <p className="text-[12px] text-chalk-500 capitalize">{s.risk} · maximum expected value</p>
            </div>
            <button className="btn-accent" onClick={() => s.setTeam(recommended.riderIds, recommended.captainId)}>Adopt team</button>
          </div>
          <table className="sheet">
            <thead>
              <tr>
                <th>Rider</th>
                <th className="hidden sm:table-cell">Team</th>
                <th className="text-right">Price</th>
                <th>Stage xG</th>
                <th className="hidden text-right sm:table-cell">Block</th>
              </tr>
            </thead>
            <tbody>
              {recRows.map(({ r, p }) => {
                const isCap = recommended.captainId === r.id;
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <button onClick={() => s.setCaptain(r.id)} title={isCap ? 'captain' : 'set captain'} className="shrink-0">
                          <CaptainStar size={17} active={isCap} />
                        </button>
                        <RoleIcon role={r.archetype} size={16} />
                        <span className="font-medium text-chalk-100">{r.name}</span>
                        {r.jerseys?.map((j) => <Jersey key={j} kind={j} size={14} />)}
                        {recommended.buys.includes(r.id) && <span className="chip bg-green/15 j-green">Buy</span>}
                      </div>
                    </td>
                    <td className="hidden text-chalk-300 sm:table-cell">{r.team}</td>
                    <td className="mono tnum text-right text-chalk-200">{priceM(r.price)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="mono tnum w-14 shrink-0 j-green">{growth(p.xG)}</span>
                        <BarMeter value={Math.max(0, p.xG)} max={maxXg} className="w-16" />
                      </div>
                    </td>
                    <td className="mono tnum hidden text-right text-chalk-300 sm:table-cell"
                      title="discounted xG through the rest of this block">{growth(forward.values[r.id] ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* expected return — visual breakdown */}
        <div className="card flex flex-col p-4">
          <h2 className="eyebrow">Expected return</h2>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[13px] text-chalk-300">Net after fees</span>
            <span className="mono tnum text-2xl font-semibold j-green">{growth(recommended.expectedGrowthAfterFees)}</span>
          </div>
          <div className="mt-4 space-y-3">
            {breakdown.map((b) => (
              <div key={b.label}>
                <div className="mb-1 flex items-baseline justify-between text-[12px]">
                  <span className="text-chalk-300">{b.label}</span>
                  <span className={`mono tnum ${b.value < 0 ? 'j-polka' : b.tone === 'gold' ? 'j-yellow' : 'text-chalk-200'}`}>{growth(b.value)}</span>
                </div>
                <ContribBar value={b.value} scale={evScale} tone={b.tone} />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1.5 border-t border-ink-600/60 pt-3 text-[13px]">
            <Stat label="Spend" value={`${kr(recommended.spend)} kr`} />
            <Stat label="Bank left" value={`${kr(recommended.bankLeft)} kr`} />
            {s.teamType === 'basis' && <Stat label="Contracts used" value={`${recommended.contractsUsed}`} />}
          </div>
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
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-chalk-100">What to do</h2>
              {!noTeam && (ridersChange || captainChange) && (
                <button className="btn-accent" onClick={() => s.setTeam(recommended.riderIds, recommended.captainId)}>Apply all</button>
              )}
            </div>

            {noTeam ? (
              <p className="text-sm leading-relaxed text-chalk-300">
                Pick your current 8 riders (on the <span className="font-medium text-gold">Riders</span> page or by adopting a team) to get
                concrete sell/buy moves and a keep-vs-swap comparison. Right now this is a from-scratch build — the recommended
                captain is <span className="font-medium text-chalk-100">{recCaptainName}</span>.
              </p>
            ) : !ridersChange && !captainChange ? (
              <div className="text-sm j-green">
                <p>
                  Stand pat — your 8 riders and captain (<span className="font-medium">{recCaptainName}</span>) already maximise
                  expected net growth for this stage.
                </p>
                {typeof recommended.swapConfidence === 'number' && recommended.swapConfidence < 1 && (
                  <p className="mt-1 text-[13px] text-chalk-400">
                    ↳ A higher-mean transfer set exists, but we&apos;re only {pct(recommended.swapConfidence)} sure it actually beats
                    holding once uncertainty is accounted for — Safe requires 65%+ confidence, so we&apos;re keeping your riders.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {ridersChange && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-polka/20 bg-polka/5 p-3">
                      <div className="eyebrow mb-1.5 j-polka">Sell</div>
                      {recommended.sells.map((id) => <div key={id} className="text-chalk-200">− {nm(id)}</div>)}
                    </div>
                    <div className="rounded-xl border border-green/20 bg-green/5 p-3">
                      <div className="eyebrow mb-1.5 j-green">Buy</div>
                      {recommended.buys.map((id) => (
                        <div key={id} className="text-chalk-200">+ {nm(id)} <span className="mono text-chalk-500">({priceM(riderById.get(id)!.price)})</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {captainChange && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-600/60 bg-ink-900/30 p-3">
                    <CaptainStar size={16} />
                    <span>
                      {ridersChange ? <>captain the new XI’s <span className="font-medium text-gold">{recCaptainName}</span></>
                        : <>keep your 8 — switch captain from <span className="text-chalk-300">{curCaptainName}</span> to <span className="font-medium text-gold">{recCaptainName}</span></>}
                    </span>
                    <button className="btn !py-1 ml-auto" onClick={() => s.setCaptain(recommended.captainId)}>Set captain</button>
                  </div>
                )}

                {ridersChange && (
                  <div className="text-[13px] text-chalk-300">
                    Fee cost <span className="mono">{growth(-recommended.transferFees)}</span> · net expected gain vs standing pat{' '}
                    <span className={`mono ${recommended.netGainVsHold >= 0 ? 'j-green' : 'j-polka'}`}>{growth(recommended.netGainVsHold)}</span>
                    {typeof recommended.swapConfidence === 'number' && (
                      <> · <span className="mono">{pct(recommended.swapConfidence)}</span> confident this beats holding</>
                    )}
                  </div>
                )}
                {ridersChange && recommended.netGainVsHold < 0 && (
                  <p className="j-polka text-[13px]">↳ The fees outweigh the gain across your horizon — consider keeping your riders (the captain switch above is still free).</p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* why these riders */}
        <div className="card p-4">
          <h2 className="text-base font-semibold text-chalk-100">Why these riders</h2>
          <p className="mt-0.5 text-[12px] text-chalk-500">
            Chosen for value over the rest of this block (through stage {lastStage}), not just today.
          </p>
          <div className="mt-3 space-y-2.5">
            {recommended.riderIds
              .map((id) => ({ r: riderById.get(id)!, hv: forward.hv[id] }))
              .sort((a, b) => (b.hv?.value ?? 0) - (a.hv?.value ?? 0))
              .map(({ r, hv }) => {
                const v = hv?.value ?? 0;
                return (
                  <div key={r.id} className="flex items-center gap-3">
                    <RoleIcon role={r.archetype} size={15} />
                    <span className="w-32 shrink-0 truncate text-[13px] font-medium text-chalk-200">{r.name}</span>
                    <BarMeter value={Math.max(0, v)} max={Math.max(1, ...recommended.riderIds.map((id) => forward.hv[id]?.value ?? 0))} className="flex-1" />
                    <span className="mono tnum w-14 shrink-0 text-right text-[12px] j-green">{growth(v)}</span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* risk presets */}
        <div className="card p-4">
          <h2 className="text-base font-semibold text-chalk-100">Risk presets</h2>
          <p className="mt-0.5 text-[12px] text-chalk-500">Expected value through the block — balanced is the max; safe trades a little for a steadier, lower-churn team, aggressive for upside.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {RISKS.map((r) => {
              const t = presets[r];
              const max = Math.max(1, ...RISKS.map((x) => presets[x]?.expectedValue ?? 0));
              return (
                <button key={r} onClick={() => s.setRisk(r)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    s.risk === r ? 'border-gold/50 bg-gold/5' : 'border-ink-600/60 hover:bg-ink-700/40'}`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-chalk-500 capitalize">{r}</div>
                  <div className="mono tnum mt-1 text-base font-semibold j-green">{growth(t?.expectedValue ?? 0)}</div>
                  <BarMeter value={Math.max(0, t?.expectedValue ?? 0)} max={max} tone="gold" className="mt-2" />
                  <div className="mt-2 text-[11px] text-chalk-500">cap · {riderById.get(t?.captainId ?? '')?.name?.split(' ').slice(-1)[0]}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-chalk-500">{label}</span>
      <span className="mono tnum text-chalk-200">{value}</span>
    </div>
  );
}
