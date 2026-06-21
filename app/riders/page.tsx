'use client';
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { useHydrated } from '@/lib/useHydrated';
import { StageBar } from '../components/StageBar';
import { projectField } from '@/engine/growth';
import type { Archetype } from '@/engine/types';
import { growth, priceM, pct, kr, ARCHE_LABEL } from '@/lib/format';

type SortKey = 'xG' | 'perM' | 'xGfee' | 'pTop5' | 'pTop15' | 'pWin' | 'price' | 'captainEV';

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
        case 'pTop5': return x.p.pTop5;
        case 'pTop15': return x.p.pTop15;
        case 'pWin': return x.p.pWin;
        case 'price': return x.r.price;
        case 'captainEV': return x.p.captainEV;
      }
    };
    xs.sort((a, b) => (asc ? get(a) - get(b) : get(b) - get(a)));
    return xs;
  }, [rows, arch, team, ownedOnly, maxPrice, q, sort, asc]);

  const maxXg = Math.max(1, ...rows.map((x) => x.p.xG));
  const maxPerM = Math.max(1, ...rows.map((x) => x.perM));

  function th(key: SortKey, label: string) {
    return (
      <th onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(false); } }}>
        {label} {sort === key ? (asc ? '▲' : '▼') : ''}
      </th>
    );
  }

  if (!hydrated) return <Skeleton />;

  return (
    <div>
      <StageBar />

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <input className="input w-40" placeholder="Search rider…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={arch} onChange={(e) => setArch(e.target.value as any)}>
          <option value="all">All archetypes</option>
          {Object.keys(ARCHE_LABEL).map((a) => <option key={a} value={a}>{ARCHE_LABEL[a]}</option>)}
        </select>
        <select className="input" value={team} onChange={(e) => setTeam(e.target.value)}>
          {teams.map((t) => <option key={t} value={t}>{t === 'all' ? 'All teams' : t}</option>)}
        </select>
        <label className="mono flex items-center gap-1 text-xs text-chalk-300">
          ≤ <span className="j-yellow">{maxPrice}M</span>
          <input type="range" min={2} max={20} step={0.5} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} />
        </label>
        <label className="mono flex items-center gap-1 text-xs text-chalk-300">
          <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> owned
        </label>
        <span className="mono ml-auto text-xs text-chalk-500">{filtered.length} riders</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="sheet">
          <thead>
            <tr>
              <th>Rider</th>
              <th>Team</th>
              <th>Arch</th>
              {th('price', 'Price')}
              {th('xG', 'xG')}
              {th('perM', 'xG/M')}
              {th('xGfee', 'xG−fee')}
              {th('pWin', 'P(win)')}
              {th('pTop5', 'P(t5)')}
              {th('pTop15', 'P(t15)')}
              {th('captainEV', 'Capt EV')}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ r, p, perM, xGfee, owned: own }) => (
              <tr key={r.id} className={own ? 'bg-yellow/5' : ''}>
                <td className="!font-sans">
                  <span className="font-medium">{r.name}</span>
                  {r.jerseys?.map((j) => (
                    <span key={j} className={`ml-1 inline-block h-2 w-2 rounded-full ${jerseyDot(j)}`} title={j} />
                  ))}
                  {r.injury !== 'fit' && <span className="ml-1 chip bg-polka/15 j-polka">{r.injury}</span>}
                </td>
                <td className="text-chalk-300">{r.team}</td>
                <td className="text-chalk-500">{ARCHE_LABEL[r.archetype]}</td>
                <td>{priceM(r.price)}</td>
                <td style={{ background: `rgba(25,179,90,${(Math.max(0, p.xG) / maxXg * 0.5).toFixed(3)})` }}>{growth(p.xG)}</td>
                <td style={{ background: `rgba(245,212,6,${(Math.max(0, perM) / maxPerM * 0.4).toFixed(3)})` }}>{growth(perM)}</td>
                <td className={xGfee < 0 ? 'j-polka' : ''}>{growth(xGfee)}</td>
                <td>{pct(p.pWin)}</td>
                <td>{pct(p.pTop5)}</td>
                <td>{pct(p.pTop15)}</td>
                <td className="text-chalk-300">{growth(p.captainEV)}</td>
                <td>
                  <button
                    onClick={() => toggleRider(r.id)}
                    className={`mono rounded px-1.5 py-0.5 text-[11px] ${own ? 'bg-polka/20 j-polka' : 'bg-green/20 j-green'}`}
                  >
                    {own ? '− sell' : '+ buy'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono mt-2 text-[11px] text-chalk-500">
        xG = expected DKK growth this stage · xG/M = growth per million · xG−fee = after the 1% transfer fee (0 if owned).
      </p>
    </div>
  );
}

function jerseyDot(j: string) {
  return { yellow: 'bg-yellow', green: 'bg-green', polka: 'bg-polka', white: 'bg-white', aggressive: 'bg-polka' }[j] ?? 'bg-chalk-500';
}

function Skeleton() {
  return <div className="mono p-8 text-center text-chalk-500">Loading board…</div>;
}
