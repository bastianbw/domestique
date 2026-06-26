'use client';
import { Fragment, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { useHydrated } from '@/lib/useHydrated';
import { StageBar } from '../components/StageBar';
import { RoleIcon, Jersey, CaptainStar, BarMeter, ContribBar } from '../components/graphics';
import { projectField } from '@/engine/growth';
import type { Archetype, Rider, RiderProjection } from '@/engine/types';
import { growth, priceM, pct, ARCHE_LABEL } from '@/lib/format';

/** Did this rider's distribution come from the betting market or the model? */
function riderHasOdds(r: Rider): boolean {
  const o = r.odds;
  return !!o && ((o.win ?? 0) > 1 || (o.top3 ?? 0) > 1 || (o.top5 ?? 0) > 1 || (o.top10 ?? 0) > 1);
}

type SortKey = 'xG' | 'perM' | 'xGfee' | 'price' | 'captainEV';

export default function RidersPage() {
  const hydrated = useHydrated();
  const riders = useStore((s) => s.riders);
  const stages = useStore((s) => s.stages);
  const selected = useStore((s) => s.selectedStage);
  const config = useStore((s) => s.config);
  const owned = useStore((s) => s.currentTeamIds);
  const toggleRider = useStore((s) => s.toggleRider);

  const [sort, setSort] = useState<SortKey>('xG');
  const [asc, setAsc] = useState(false);
  const [arch, setArch] = useState<Archetype | 'all'>('all');
  const [team, setTeam] = useState('all');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [q, setQ] = useState('');
  const [maxPrice, setMaxPrice] = useState(20);
  const [openId, setOpenId] = useState<string | null>(null);

  const stage = stages.find((s) => s.stage === selected)!;

  const rows = useMemo(() => {
    if (!hydrated) return [];
    const projs = projectField(riders, stage, config);
    const byId = new Map(projs.map((p) => [p.riderId, p]));
    const ownedSet = new Set(owned);
    return riders.map((r) => {
      const p = byId.get(r.id)!;
      const fee = ownedSet.has(r.id) ? 0 : r.price * 0.01;
      return {
        r, p,
        perM: p.xG / (r.price / 1_000_000),
        xGfee: p.xG - fee,
        owned: ownedSet.has(r.id),
      };
    });
  }, [hydrated, riders, stage, config, owned]);

  const teams = useMemo(() => ['all', ...Array.from(new Set(riders.map((r) => r.team))).sort()], [riders]);

  const filtered = useMemo(() => {
    let xs = rows.filter((x) => {
      if (arch !== 'all' && x.r.archetype !== arch) return false;
      if (team !== 'all' && x.r.team !== team) return false;
      if (ownedOnly && !x.owned) return false;
      if (x.r.price > maxPrice * 1_000_000) return false;
      if (q && !x.r.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    const get = (x: typeof rows[number]): number => {
      switch (sort) {
        case 'xG': return x.p.xG;
        case 'perM': return x.perM;
        case 'xGfee': return x.xGfee;
        case 'price': return x.r.price;
        case 'captainEV': return x.p.captainEV;
      }
    };
    xs.sort((a, b) => (asc ? get(a) - get(b) : get(b) - get(a)));
    return xs;
  }, [rows, arch, team, ownedOnly, maxPrice, q, sort, asc]);

  const maxXg = Math.max(1, ...rows.map((x) => x.p.xG));
  const maxPerM = Math.max(1, ...rows.map((x) => x.perM));

  function th(key: SortKey, label: string, right = false) {
    return (
      <th onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(false); } }} className={right ? 'text-right' : ''}>
        {label} <span className="text-gold">{sort === key ? (asc ? '▲' : '▼') : ''}</span>
      </th>
    );
  }

  if (!hydrated) return <div className="p-16 text-center text-sm text-chalk-500">Loading the field…</div>;

  return (
    <div className="space-y-5">
      <StageBar />
      <MyTeamBar />

      {/* filters */}
      <div className="card flex flex-wrap items-center gap-2.5 p-3">
        <input className="input w-44" placeholder="Search rider…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={arch} onChange={(e) => setArch(e.target.value as any)}>
          <option value="all">All archetypes</option>
          {Object.keys(ARCHE_LABEL).map((a) => <option key={a} value={a}>{ARCHE_LABEL[a]}</option>)}
        </select>
        <select className="input max-w-[180px]" value={team} onChange={(e) => setTeam(e.target.value)}>
          {teams.map((t) => <option key={t} value={t}>{t === 'all' ? 'All teams' : t}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[13px] text-chalk-300">
          ≤ <span className="mono font-medium text-gold">{maxPrice}M</span>
          <input type="range" className="accent-gold" min={2} max={20} step={0.5} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-chalk-300">
          <input type="checkbox" className="accent-gold" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> owned only
        </label>
        <span className="ml-auto text-[13px] text-chalk-500"><span className="mono text-chalk-300">{filtered.length}</span> riders</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="sheet">
          <thead>
            <tr>
              <th>Rider</th>
              <th className="hidden md:table-cell">Team</th>
              {th('price', 'Price', true)}
              {th('xG', 'xG')}
              {th('perM', 'xG / M')}
              {th('xGfee', 'xG − fee', true)}
              {th('captainEV', 'Capt EV', true)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ r, p, perM, xGfee, owned: own }) => (
              <Fragment key={r.id}>
              <tr className={own ? 'bg-gold/[0.04]' : ''}>
                <td>
                  <button
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                    title="Show xG breakdown"
                    className="flex items-center gap-2.5 text-left"
                  >
                    <span className={`text-chalk-500 transition-transform ${openId === r.id ? 'rotate-90' : ''}`}>›</span>
                    <RoleIcon role={r.archetype} size={16} />
                    <span className="font-medium text-chalk-100 hover:text-gold">{r.name}</span>
                    {r.jerseys?.map((j) => <Jersey key={j} kind={j} size={13} />)}
                    {r.injury !== 'fit' && <span className="chip bg-polka/15 j-polka capitalize">{r.injury}</span>}
                    {riderHasOdds(r) && <span className="chip bg-gold/15 text-gold">Market</span>}
                  </button>
                </td>
                <td className="hidden text-chalk-300 md:table-cell">{r.team}</td>
                <td className="mono tnum text-right text-chalk-200">{priceM(r.price)}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="mono tnum w-12 shrink-0 j-green">{growth(p.xG)}</span>
                    <BarMeter value={Math.max(0, p.xG)} max={maxXg} className="hidden w-14 sm:inline-block" />
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="mono tnum w-12 shrink-0 text-chalk-200">{growth(perM)}</span>
                    <BarMeter value={Math.max(0, perM)} max={maxPerM} tone="gold" className="hidden w-12 sm:inline-block" />
                  </div>
                </td>
                <td className={`mono tnum text-right ${xGfee < 0 ? 'j-polka' : 'text-chalk-200'}`}>{growth(xGfee)}</td>
                <td className="mono tnum text-right text-chalk-300">{growth(p.captainEV)}</td>
                <td className="text-right">
                  <button
                    onClick={() => toggleRider(r.id)}
                    className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                      own ? 'bg-polka/15 j-polka hover:bg-polka/25' : 'bg-green/15 j-green hover:bg-green/25'}`}
                  >
                    {own ? 'Sell' : 'Buy'}
                  </button>
                </td>
              </tr>
              {openId === r.id && (
                <tr className="bg-ink-900/50">
                  <td colSpan={8} className="!py-0">
                    <RiderDetail r={r} p={p} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-chalk-500">
        <span className="mono">xG</span> = expected DKK growth this stage · <span className="mono">xG/M</span> = growth per million spent ·
        <span className="mono"> xG−fee</span> = after the 1% transfer fee (0 if already owned).
      </p>
    </div>
  );
}

function RiderDetail({ r, p }: { r: Rider; p: RiderProjection }) {
  const fromMarket = riderHasOdds(r);
  const probs: Array<{ label: string; v: number }> = [
    { label: 'Win', v: p.pWin },
    { label: 'Top 5', v: p.pTop5 },
    { label: 'Top 15', v: p.pTop15 },
  ];
  const b = p.breakdown;
  const parts: Array<{ label: string; v: number }> = [
    { label: 'Stage placement', v: b.placement },
    { label: 'Sprint / mountain pts', v: b.sprintMtn },
    { label: 'GC bonus', v: b.gc },
    { label: 'Jerseys', v: b.jerseys },
    { label: 'Holdbonus', v: b.holdbonus },
    { label: 'Late-arrival penalty', v: b.lateArrival },
    { label: 'DNF risk', v: b.dnfRisk },
    { label: 'TTT', v: b.ttt },
  ].filter((x) => Math.abs(x.v) > 1);
  const scale = Math.max(1, ...parts.map((x) => Math.abs(x.v)));

  return (
    <div className="grid gap-5 px-3 py-4 sm:grid-cols-2">
      <div>
        <div className="eyebrow mb-2 flex items-center gap-2">
          Finish probabilities
          <span className={`chip ${fromMarket ? 'bg-gold/15 text-gold' : 'bg-ink-700 text-chalk-300'}`}>
            {fromMarket ? 'Market (odds)' : 'Model'}
          </span>
        </div>
        <div className="space-y-2">
          {probs.map((x) => (
            <div key={x.label} className="flex items-center gap-3">
              <span className="w-12 shrink-0 text-[12px] text-chalk-300">{x.label}</span>
              <BarMeter value={x.v} max={1} tone="gold" className="flex-1" />
              <span className="mono tnum w-12 shrink-0 text-right text-[12px] text-chalk-200">{pct(x.v)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-chalk-500">
          {fromMarket
            ? 'Anchored to your pasted betting odds (Shin-de-vigged) — the strongest signal.'
            : 'From the structural model + Monte-Carlo ensemble (rank × stage suitability × form, plus any weather/news nudges).'}
        </p>
      </div>

      <div>
        <div className="eyebrow mb-2">xG breakdown · <span className="mono j-green normal-case tracking-normal">{growth(p.xG)}</span></div>
        <div className="space-y-2">
          {parts.map((x) => (
            <div key={x.label} className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-[12px] text-chalk-300">{x.label}</span>
              <ContribBar value={x.v} scale={scale} />
              <span className={`mono tnum w-12 shrink-0 text-right text-[12px] ${x.v < 0 ? 'j-polka' : 'text-chalk-200'}`}>{growth(x.v)}</span>
            </div>
          ))}
          {parts.length === 0 && <p className="text-[12px] text-chalk-500">No material growth components this stage.</p>}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-chalk-500">
          Captain EV <span className="mono text-chalk-300">{growth(p.captainEV)}</span> — positive round growth counted twice.
        </p>
      </div>
    </div>
  );
}

function MyTeamBar() {
  const riders = useStore((s) => s.riders);
  const ids = useStore((s) => s.currentTeamIds);
  const captainId = useStore((s) => s.captainId);
  const bank = useStore((s) => s.bank);
  const toggleRider = useStore((s) => s.toggleRider);
  const setCaptain = useStore((s) => s.setCaptain);
  const clearTeam = useStore((s) => s.clearTeam);
  const saveSnapshot = useStore((s) => s.saveSnapshot);

  const byId = new Map(riders.map((r) => [r.id, r]));
  const picked = ids.map((id) => byId.get(id)).filter(Boolean) as typeof riders;
  const spend = picked.reduce((a, r) => a + r.price, 0);

  const teamCounts: Record<string, number> = {};
  picked.forEach((r) => { teamCounts[r.team] = (teamCounts[r.team] ?? 0) + 1; });
  const over2 = Object.entries(teamCounts).filter(([, c]) => c > 2).map(([t]) => t);
  const buyingPower = bank + spend;

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <h2 className="text-base font-semibold text-chalk-100">My team</h2>
        <span className={`mono text-[13px] font-medium ${ids.length === 8 ? 'j-green' : 'text-chalk-500'}`}>{ids.length}/8</span>
        <span className="text-[12px] text-chalk-500">spend <span className="mono">{priceM(spend)}</span> · buying power <span className="mono">{priceM(buyingPower)}</span></span>
        {over2.length > 0 && <span className="chip bg-polka/15 j-polka">&gt;2 from {over2.join(', ')}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost" disabled={ids.length === 0}
            onClick={() => { const n = prompt('Name this team snapshot'); if (n) saveSnapshot(n); }}>Save snapshot</button>
          <button className="btn-ghost j-polka" disabled={ids.length === 0}
            onClick={() => { if (confirm('Clear your team?')) clearTeam(); }}>Clear</button>
        </div>
      </div>
      {ids.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-chalk-500">
          No riders yet. Tap <span className="j-green font-medium">Buy</span> on any rider below to build your 8.
          Your team is saved in this browser and is the baseline the optimizer builds from next stage.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {picked.map((r) => {
            const isCap = captainId === r.id;
            return (
              <span key={r.id} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] ${
                isCap ? 'border-gold/50 bg-gold/5 text-chalk-100' : 'border-ink-500/70 bg-ink-700/40 text-chalk-200'}`}>
                <button title="set captain" onClick={() => setCaptain(r.id)} className="shrink-0">
                  <CaptainStar size={15} active={isCap} />
                </button>
                <RoleIcon role={r.archetype} size={13} />
                {r.name}
                <button title="remove" onClick={() => toggleRider(r.id)} className="ml-0.5 text-chalk-500 hover:j-polka">×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
