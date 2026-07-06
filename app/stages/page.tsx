'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useHydrated } from '@/lib/useHydrated';
import { StageBar } from '../components/StageBar';
import { STAGE_TYPE_LABEL } from '../components/Elevation';
import { parseStartlistText } from '@/engine/importSchema';
import type { StageResultBlock, StageType, Archetype, InjuryFlag } from '@/engine/types';
import { ARCHE_LABEL, priceM } from '@/lib/format';

export default function StagesPage() {
  const hydrated = useHydrated();
  if (!hydrated) return <div className="p-16 text-center text-sm text-chalk-500">Loading…</div>;
  return (
    <div className="space-y-3">
      <StageBar />
      <ImportSection />
      <AutoFetchSection />
      <ManualResultSection />
      <StartlistSection />
      <RiderEditor />
      <StageEditor />
      <CalibrationSection />
      <SnapshotSection />
      <StateSection />
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-4 text-left">
        <span className="text-sm font-semibold text-chalk-100">{title}</span>
        <span className="text-lg text-chalk-500">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="border-t border-ink-600/60 p-4">{children}</div>}
    </div>
  );
}

// ── 1. Paste-one-block import (primary daily loop) ──
function ImportSection() {
  const importRaw = useStore((s) => s.importRaw);
  const fetchFeatures = useStore((s) => s.fetchFeatures);
  const [raw, setRaw] = useState('');
  const [msgs, setMsgs] = useState<string[]>([]);
  const [ok, setOk] = useState(true);
  const [busy, setBusy] = useState(false);

  return (
    <Section title="① IMPORT BLOCK  (paste from Claude chat — primary daily loop)" defaultOpen>
      <p className="mb-2 text-sm text-chalk-300">
        Paste one JSON block: <span className="j-green">stageResult</span>, <span className="j-yellow">odds</span>,{' '}
        <span className="j-white">startlist</span>, <span className="text-sky-300">weather</span>, or <span className="text-orange-300">news</span>.
        Weather &amp; news are optional and only nudge the model. See <a className="underline" href="/how">How it works</a> for the exact schema.
      </p>
      <textarea className="input h-32 w-full font-mono text-xs" value={raw}
        placeholder='{"type":"stageResult","stage":7,"results":[{"rider":"Jasper Philipsen","pos":1,"sprintPts":20}], ...}'
        onChange={(e) => setRaw(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-accent" onClick={() => {
          const res = importRaw(raw);
          setOk(res.ok); setMsgs(res.messages);
          if (res.ok) setRaw('');
        }}>Import</button>
        <button className="btn" onClick={() => { setRaw(''); setMsgs([]); }}>Clear</button>
        <button className="btn" disabled={busy} title="Pulls data/rider_features.json from GitHub: archetype, PCS rank, form, team strength & terrain affinity for ~750 riders. Fixes wrong archetypes/ranks without any copy-paste."
          onClick={async () => {
            setBusy(true);
            const res = await fetchFeatures();
            setOk(res.ok); setMsgs(res.messages); setBusy(false);
          }}>{busy ? 'Fetching…' : '⬇ Enrich riders from PCS (GitHub)'}</button>
      </div>
      {msgs.length > 0 && (
        <ul className={`mono mt-2 space-y-0.5 text-xs ${ok ? 'text-chalk-300' : 'j-polka'}`}>
          {msgs.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </Section>
  );
}

// ── 1½. Auto-fetch results from the collector URL ──
function AutoFetchSection() {
  const url = useStore((s) => s.autoFetchUrl);
  const setUrl = useStore((s) => s.setAutoFetchUrl);
  const fetchResult = useStore((s) => s.fetchResult);
  const stage = useStore((s) => s.selectedStage);
  const [msgs, setMsgs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function pull() {
    setBusy(true);
    const res = await fetchResult(url.includes('{stage}') ? stage : undefined);
    setMsgs(res.messages);
    setBusy(false);
  }

  return (
    <Section title="①½ AUTO-FETCH RESULTS  (optional — from the GitHub collector)">
      <p className="mb-2 text-xs text-chalk-500">
        Paste the raw URL your collector publishes to (e.g.{' '}
        <code className="mono">https://raw.githubusercontent.com/USER/domestique-data/main/latest.json</code>,
        or a per-stage URL containing <code className="mono">{'{stage}'}</code>). Then press Fetch — it imports
        exactly like a pasted block. The nightly collector now publishes an <span className="text-sky-300">array</span>{' '}
        bundling today’s result + tomorrow’s <span className="text-sky-300">weather</span> forecast (Open-Meteo), and both
        are applied in one fetch. Leave blank to use manual paste only.
      </p>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-[260px] flex-1" placeholder="https://raw.githubusercontent.com/…/latest.json"
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn-accent" disabled={busy || !url} onClick={pull}>
          {busy ? 'Fetching…' : `Fetch${url.includes('{stage}') ? ` stage ${stage}` : ' latest'}`}
        </button>
      </div>
      {msgs.length > 0 && <ul className="mono mt-2 space-y-0.5 text-xs text-chalk-300">{msgs.map((m, i) => <li key={i}>{m}</li>)}</ul>}
    </Section>
  );
}

// ── 2. Manual result entry (fallback) ──
function ManualResultSection() {
  const stage = useStore((s) => s.selectedStage);
  const logResult = useStore((s) => s.logResult);
  const [order, setOrder] = useState('');
  const [yellow, setYellow] = useState('');
  const [green, setGreen] = useState('');
  const [polka, setPolka] = useState('');
  const [white, setWhite] = useState('');
  const [dnf, setDnf] = useState('');
  const [msgs, setMsgs] = useState<string[]>([]);

  function submit() {
    const names = order.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const block: StageResultBlock = {
      type: 'stageResult', stage,
      results: names.map((rider, i) => ({ rider, pos: i + 1 })),
      jerseys: { yellow: yellow || undefined, green: green || undefined, polka: polka || undefined, white: white || undefined },
      dnf: dnf.split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
    };
    const res = logResult(block);
    setMsgs(res.messages);
  }

  return (
    <Section title={`② MANUAL RESULT ENTRY  (fallback) — stage ${stage}`}>
      <p className="mb-2 text-xs text-chalk-500">Paste the top finishers in order, one name per line (position = line number). Jerseys & DNF optional.</p>
      <textarea className="input h-28 w-full font-mono text-xs" placeholder={'Jasper Philipsen\nJonathan Milan\n...'} value={order} onChange={(e) => setOrder(e.target.value)} />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <L label="Yellow"><input className="input w-full" value={yellow} onChange={(e) => setYellow(e.target.value)} /></L>
        <L label="Green"><input className="input w-full" value={green} onChange={(e) => setGreen(e.target.value)} /></L>
        <L label="Polka"><input className="input w-full" value={polka} onChange={(e) => setPolka(e.target.value)} /></L>
        <L label="White"><input className="input w-full" value={white} onChange={(e) => setWhite(e.target.value)} /></L>
      </div>
      <L label="DNF (comma or newline)"><input className="input mt-2 w-full" value={dnf} onChange={(e) => setDnf(e.target.value)} /></L>
      <button className="btn-accent mt-2" onClick={submit}>Log stage {stage}</button>
      {msgs.length > 0 && <ul className="mono mt-2 space-y-0.5 text-xs text-chalk-300">{msgs.map((m, i) => <li key={i}>{m}</li>)}</ul>}
    </Section>
  );
}

// ── 3. Startlist text import ──
function StartlistSection() {
  const replaceRiders = useStore((s) => s.replaceRiders);
  const riders = useStore((s) => s.riders);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  function apply() {
    const { riders: rows, warnings } = parseStartlistText(text);
    if (!rows.length) { setMsg('No riders parsed. Use: name, team, archetype, price'); return; }
    let seq = 0;
    replaceRiders(rows.map((r) => ({
      id: `sl${++seq}`, name: r.name, team: r.team,
      archetype: (r.archetype ?? 'domestique') as Archetype, price: r.price,
      form: r.form ?? 70, pcsRank: r.pcsRank ?? 60, teamStrength: 65,
      injury: 'fit', breakawayTendency: 20,
    })));
    setMsg(`Imported ${rows.length} riders. ${warnings.length ? warnings.length + ' warnings.' : ''}`);
    setText('');
  }

  return (
    <Section title={`③ START LIST IMPORT  (CSV/free-text) — currently ${riders.length} riders`}>
      <p className="mb-2 text-xs text-chalk-500">One rider per line: <code className="mono">name, team, archetype, price</code> (price like 9.5M or 9500000). Replaces the whole field.</p>
      <textarea className="input h-28 w-full font-mono text-xs" placeholder={'Jasper Philipsen, Alpecin-Deceuninck, sprinter, 9.5M\nTadej Pogacar, UAE Emirates, gc, 12M'} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn mt-2" onClick={apply}>Import start list</button>
      {msg && <p className="mono mt-2 text-xs text-chalk-300">{msg}</p>}
    </Section>
  );
}

// ── 4. Rider editor ──
function RiderEditor() {
  const riders = useStore((s) => s.riders);
  const updateRider = useStore((s) => s.updateRider);
  const [q, setQ] = useState('');
  const shown = riders.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60);

  return (
    <Section title="④ EDIT RIDERS  (archetype, form, rank, team strength, GC, injury, odds, ownership)">
      <input className="input mb-2 w-48" placeholder="Filter riders…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="mb-2 text-xs text-chalk-500">
        <span className="mono">PCS</span> = season rank (1 = best in the world; a default of 60 means unenriched — use{' '}
        <span className="mono">① Enrich riders from PCS</span>) · <span className="mono">Form</span> = recency-weighted
        recent finishing quality, 40–96 · <span className="mono">GC</span> = current Tour classification position, 0
        until a stage result sets it · <span className="mono">Brk</span> = breakaway tendency, 0–100.
      </p>
      <div className="overflow-x-auto">
        <table className="sheet">
          <thead><tr>
            <th>Rider</th>
            <th title="Archetype: sprinter / puncheur / climber / gc / rouleur / breakaway / domestique">Arch</th>
            <th title="Recency-weighted recent finishing quality, scaled 40–96">Form</th>
            <th title="ProCyclingStats season rank — 1 is the best rider in the world; lower is better">PCS</th>
            <th title="Team strength 0–100 — drives TTT payout, sprint trains, Holdbonus">TeamStr</th>
            <th title="Current Tour general-classification position — 0 means not yet established (no stage logged)">GC</th>
            <th title="Breakaway tendency, 0–100 (derived from historical breakaway km)">Brk</th>
            <th>Injury</th>
            <th title="Manual ownership % guess, for differential mode">Own%</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="!font-sans">{r.name} <span className="text-chalk-500">{priceM(r.price)}</span></td>
                <td>
                  <select className="input !py-0.5" value={r.archetype} onChange={(e) => updateRider(r.id, { archetype: e.target.value as Archetype })}>
                    {Object.keys(ARCHE_LABEL).map((a) => <option key={a} value={a}>{ARCHE_LABEL[a]}</option>)}
                  </select>
                </td>
                <NumCell v={r.form} on={(n) => updateRider(r.id, { form: n })} />
                <NumCell v={r.pcsRank} on={(n) => updateRider(r.id, { pcsRank: n })} />
                <NumCell v={r.teamStrength} on={(n) => updateRider(r.id, { teamStrength: n })} />
                <NumCell v={r.gcPosition ?? 0} on={(n) => updateRider(r.id, { gcPosition: n || undefined })} />
                <NumCell v={r.breakawayTendency} on={(n) => updateRider(r.id, { breakawayTendency: n })} />
                <td>
                  <select className="input !py-0.5" value={r.injury} onChange={(e) => updateRider(r.id, { injury: e.target.value as InjuryFlag })}>
                    <option value="fit">fit</option><option value="doubt">doubt</option><option value="out">out</option>
                  </select>
                </td>
                <NumCell v={r.ownershipPct ?? 0} on={(n) => updateRider(r.id, { ownershipPct: n || undefined })} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── 5. Stage editor ──
function StageEditor() {
  const stages = useStore((s) => s.stages);
  const updateStage = useStore((s) => s.updateStage);
  const TYPES: StageType[] = ['flat', 'hilly', 'summit', 'high_mtn', 'ttt', 'hilly_itt'];
  return (
    <Section title="⑤ EDIT STAGES  (type, sprint/mtn points, summit, double-sprint)">
      <div className="overflow-x-auto">
        <table className="sheet">
          <thead><tr><th>#</th><th>Route</th><th>Type</th><th>SprintPts</th><th>MtnPts</th><th>Summit</th><th>2×Spr</th></tr></thead>
          <tbody>
            {stages.map((st) => (
              <tr key={st.stage}>
                <td>{st.stage}</td>
                <td className="!font-sans text-chalk-300">{st.route}</td>
                <td>
                  <select className="input !py-0.5" value={st.type} onChange={(e) => updateStage(st.stage, { type: e.target.value as StageType })}>
                    {TYPES.map((t) => <option key={t} value={t}>{STAGE_TYPE_LABEL[t]}</option>)}
                  </select>
                </td>
                <NumCell v={st.sprintPtsOnOffer} on={(n) => updateStage(st.stage, { sprintPtsOnOffer: n })} />
                <NumCell v={st.mtnPtsOnOffer} on={(n) => updateStage(st.stage, { mtnPtsOnOffer: n })} />
                <td><input type="checkbox" checked={!!st.summitFinish} onChange={(e) => updateStage(st.stage, { summitFinish: e.target.checked })} /></td>
                <td><input type="checkbox" checked={!!st.doubleSprint} onChange={(e) => updateStage(st.stage, { doubleSprint: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── 6. Calibration log ──
function CalibrationSection() {
  const log = useStore((s) => s.calibrationLog);
  const undo = useStore((s) => s.undoCalibration);
  return (
    <Section title={`⑥ CALIBRATION LOG  (${log.length} adjustments)`}>
      <p className="mb-2 text-xs text-chalk-500">After each logged stage the model nudges its stage-type weights toward observed reality (conservative EMA). Transparent and reversible.</p>
      <button className="btn mb-2" onClick={undo} disabled={!log.length}>Undo last calibration</button>
      <div className="space-y-2">
        {[...log].reverse().map((r, i) => (
          <div key={i} className="mono rounded border border-ink-600 p-2 text-xs">
            <div className="text-chalk-300">Stage {r.stage} ({r.stageType}) · accuracy err {r.brierLike.toFixed(3)} · η {r.learningRate}</div>
            {r.deltas.map((d) => (
              <span key={d.archetype} className={`mr-3 ${d.delta > 0 ? 'j-green' : 'j-polka'}`}>
                {d.archetype} {d.delta > 0 ? '+' : ''}{d.delta.toFixed(3)}
              </span>
            ))}
          </div>
        ))}
        {!log.length && <p className="mono text-xs text-chalk-500">No stages logged yet.</p>}
      </div>
    </Section>
  );
}

// ── 7. Snapshots ──
function SnapshotSection() {
  const snaps = useStore((s) => s.snapshots);
  const save = useStore((s) => s.saveSnapshot);
  const load = useStore((s) => s.loadSnapshot);
  const del = useStore((s) => s.deleteSnapshot);
  const [name, setName] = useState('');
  return (
    <Section title={`⑦ TEAM SNAPSHOTS  (${snaps.length})`}>
      <div className="flex gap-2">
        <input className="input" placeholder="Snapshot name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" onClick={() => { if (name) { save(name); setName(''); } }}>Save current team</button>
      </div>
      <div className="mt-2 space-y-1">
        {snaps.map((sn) => (
          <div key={sn.id} className="mono flex items-center gap-2 text-xs">
            <span className="text-chalk-100">{sn.name}</span>
            <span className="text-chalk-500">stage {sn.stage} · {sn.riderIds.length} riders</span>
            <button className="btn !py-0.5 ml-auto" onClick={() => load(sn.id)}>Load</button>
            <button className="btn !py-0.5 j-polka" onClick={() => del(sn.id)}>×</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── 8. Export / import / reset full state ──
function StateSection() {
  const resetAll = useStore((s) => s.resetAll);
  const [msg, setMsg] = useState('');

  function exportState() {
    const raw = localStorage.getItem('domestique-v1') ?? '{}';
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `domestique-state-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  function importState(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        JSON.parse(text); // validate
        localStorage.setItem('domestique-v1', text);
        setMsg('State imported. Reloading…');
        setTimeout(() => location.reload(), 600);
      } catch {
        setMsg('Invalid state file.');
      }
    };
    reader.readAsText(file);
  }

  return (
    <Section title="⑧ EXPORT / IMPORT / RESET STATE  (portable, share a setup)">
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={exportState}>Export state (JSON)</button>
        <label className="btn cursor-pointer">
          Import state
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importState(e.target.files[0])} />
        </label>
        <button className="btn j-polka" onClick={() => { if (confirm('Reset everything to the seed data?')) { resetAll(); setMsg('Reset.'); } }}>Reset all</button>
      </div>
      {msg && <p className="mono mt-2 text-xs text-chalk-300">{msg}</p>}
    </Section>
  );
}

// ── small helpers ──
function NumCell({ v, on }: { v: number; on: (n: number) => void }) {
  return <td><input type="number" className="input !w-16 !py-0.5" value={v} onChange={(e) => on(Number(e.target.value))} /></td>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mono text-[11px] text-chalk-500">{label}</span>{children}</label>;
}
