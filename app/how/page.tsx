'use client';
import {
  PLACEMENT_TABLE, GC_TABLE, ETAPEBONUS_TABLE, TTT_TABLE, HOLDBONUS_TABLE, JERSEY_PAYOUT,
} from '@/engine/rules';
import { kr } from '@/lib/format';

export default function HowPage() {
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h1 className="mono text-lg font-bold"><span className="j-yellow">D</span>OMESTIQUE — how it works</h1>
        <p className="mt-2 text-sm text-chalk-300">
          Domestique maximises your Holdet.dk <strong>team value growth (vækst) in DKK</strong> — not points — across all 21
          Tour de France 2026 stages. For each stage the engine builds a finishing-position probability distribution for every
          rider, then takes the expectation over the exact Holdet growth rules to get <span className="j-green">xG</span>
          (expected growth). The optimizer then picks the best legal 8-rider team.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mono text-sm font-bold">THE MODEL — signal blend</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-chalk-300">
          <li><strong>Betting odds</strong> (when pasted, de-vigged) anchor the head of the distribution — the strongest signal.</li>
          <li><strong>Stage-profile × archetype</strong> suitability (sprinter→flat, climber→summit, rouleur→ITT, team strength→TTT).</li>
          <li><strong>Form, PCS rank, team strength</strong> shape the rest of the curve.</li>
          <li><strong>Injury</strong>: <em>out</em> → non-starter; <em>doubt</em> → dampened.</li>
        </ol>
        <p className="mt-2 text-sm text-chalk-300">
          The expectation includes every rule component: placement, sprint/mountain points (×3,000, archetype + breakaway-weighted,
          double-sprint stages carry more), jerseys, GC bonus, Holdbonus, late-arrival penalty, DNF/DNS, and the TTT special case.
          Etapebonus and captain bonus are computed at the team level (exact Poisson-binomial for Etapebonus). After each logged
          stage a conservative EMA <strong>calibration</strong> nudges the stage-type weights toward reality — transparent and reversible.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mono text-sm font-bold">THE EXACT RULES (single source of truth)</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <RuleTable title="Etapeplacering (stage finish)" table={PLACEMENT_TABLE} note="16th+ pays 0" />
          <RuleTable title="Sammenlagt (GC after stage)" table={GC_TABLE} note="11th+ pays 0" />
          <RuleTable title="Etapebonus (your riders in top-15 → bank, once)" table={ETAPEBONUS_TABLE} keyLabel="in top15" />
          <RuleTable title="Holdtidskørsel TTT (all active riders)" table={TTT_TABLE} note="replaces placement/holdbonus/late/etapebonus on stage 1" />
          <RuleTable title="Holdbonus (rider's team result)" table={HOLDBONUS_TABLE} />
          <div>
            <h3 className="mono text-xs uppercase text-chalk-500">Jerseys (per day, to wearer)</h3>
            <table className="sheet mt-1"><tbody>
              {Object.entries(JERSEY_PAYOUT).map(([k, v]) => (
                <tr key={k}><td className="!font-sans capitalize">{k}</td><td className="text-right j-green">{kr(v)}</td></tr>
              ))}
            </tbody></table>
          </div>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-chalk-300">
          <li>• <strong>Sprint & mountain points:</strong> 3,000 kr each (negatives allowed).</li>
          <li>• <strong>Kaptajn:</strong> captain's positive round growth paid again (≈ ×2).</li>
          <li>• <strong>Sen ankomst:</strong> −3,000 per full minute behind the winner, capped at −90,000.</li>
          <li>• <strong>DNF:</strong> −50,000 that stage (points kept, no Holdbonus). <strong>DNS:</strong> −100,000 per remaining stage.</li>
          <li>• <strong>Finance:</strong> +0.5% bank interest per round; −1% transfer fee on every buy from stage 1.</li>
          <li>• <strong>Contracts:</strong> Guld = unlimited (default); Basis = 8 for the whole game (switchable on Stages & Data).</li>
        </ul>
      </section>

      <section className="card p-4">
        <h2 className="mono text-sm font-bold">DAILY LOOP (Phase 2 — no Claude Code needed)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-chalk-300">
          <li>In the <strong>free Claude chat app</strong>: “Start stage N” + optionally paste an odds screenshot / news.</li>
          <li>Chat-Claude reads ProCyclingStats, applies these rules, and emits <strong>one JSON block</strong>.</li>
          <li>Paste it into <strong>Stages &amp; Data → ① Import block</strong>. Prices roll forward, bank updates (captain, Etapebonus, interest), the model recalibrates.</li>
          <li>Open <strong>Optimal</strong> for the next stage’s best team.</li>
        </ol>
      </section>

      <section className="card p-4">
        <h2 className="mono text-sm font-bold">IMPORT SCHEMAS (what chat-Claude must produce)</h2>
        <Schema title="(a) Results block — after a stage" code={RESULTS_EXAMPLE} />
        <Schema title="(b) Odds block — optional, pre-stage" code={ODDS_EXAMPLE} />
        <Schema title="(c) Startlist block — once, before the Tour" code={STARTLIST_EXAMPLE} />
        <p className="mt-2 text-xs text-chalk-500">Name matching is accent- and typo-tolerant; unmatched names are reported so you can fix them.</p>
      </section>

      <section className="card p-4">
        <h2 className="mono text-sm font-bold">INSTALL & INDEPENDENCE</h2>
        <ul className="mt-2 space-y-1 text-sm text-chalk-300">
          <li>• <strong>Install:</strong> open in Chrome/Safari → “Add to Home Screen” / “Install”. Works offline after first load.</li>
          <li>• <strong>No accounts, no backend, no API key, no subscription.</strong> Your data lives in this browser (localStorage).</li>
          <li>• <strong>Portable:</strong> export/import your full state as JSON to share a setup or move devices.</li>
          <li>• Domestique never depends on Claude, Claude Code, or any service to operate during the race.</li>
        </ul>
      </section>
    </div>
  );
}

function RuleTable({ title, table, note, keyLabel }: { title: string; table: Record<number, number>; note?: string; keyLabel?: string }) {
  return (
    <div>
      <h3 className="mono text-xs uppercase text-chalk-500">{title}</h3>
      <table className="sheet mt-1"><tbody>
        {Object.entries(table).map(([k, v]) => (
          <tr key={k}><td>{keyLabel ? `${k} ${keyLabel}` : `pos ${k}`}</td><td className="text-right j-green">{kr(v)}</td></tr>
        ))}
      </tbody></table>
      {note && <p className="mono mt-1 text-[10px] text-chalk-500">{note}</p>}
    </div>
  );
}

function Schema({ title, code }: { title: string; code: string }) {
  return (
    <div className="mt-3">
      <div className="mono text-xs text-chalk-300">{title}</div>
      <pre className="mt-1 overflow-x-auto rounded border border-ink-600 bg-ink-900 p-2 text-[11px] j-green">{code}</pre>
    </div>
  );
}

const RESULTS_EXAMPLE = `{
  "type": "stageResult",
  "stage": 7,
  "results": [
    {"rider": "Jasper Philipsen", "pos": 1, "sprintPts": 20, "mtnPts": 0, "gap": 0},
    {"rider": "Jonathan Milan",   "pos": 2, "sprintPts": 17, "gap": 0},
    {"rider": "Tadej Pogacar",    "pos": 24, "gcPos": 1}
  ],
  "jerseys": {"yellow":"Tadej Pogacar","green":"Jasper Philipsen","polka":"...","white":"...","aggressive":"..."},
  "dnf": ["Some Rider"], "dns": ["Another Rider"],
  "teamResultTop3": ["Alpecin-Deceuninck","Lidl-Trek","Visma-LAB"]
}`;

const ODDS_EXAMPLE = `{ "type": "odds", "stage": 8,
  "odds": [ {"rider":"Jasper Philipsen","win":2.5,"top3":1.4,"top5":1.2,"top10":1.05} ] }`;

const STARTLIST_EXAMPLE = `{ "type": "startlist",
  "riders": [ {"name":"Jasper Philipsen","team":"Alpecin-Deceuninck","archetype":"sprinter","price":8000000,"form":88,"pcsRank":8} ] }`;
