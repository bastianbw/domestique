'use client';
import { useStore } from '@/lib/store';
import { Elevation, STAGE_TYPE_LABEL } from './graphics';

// Stage selector + the roadbook elevation strip. Shared across pages.
export function StageBar() {
  const stages = useStore((s) => s.stages);
  const selected = useStore((s) => s.selectedStage);
  const setStage = useStore((s) => s.setSelectedStage);
  const logged = useStore((s) => s.loggedStages);
  const stage = stages.find((s) => s.stage === selected)!;

  return (
    <section className="card mb-5 overflow-hidden">
      {/* stage rail */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-ink-600/60 px-3 py-2.5">
        {stages.map((s) => {
          const isLogged = logged.includes(s.stage);
          const isSel = s.stage === selected;
          return (
            <button
              key={s.stage}
              onClick={() => setStage(s.stage)}
              title={`Stage ${s.stage}: ${s.route}`}
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-medium tabular-nums transition-all ${
                isSel
                  ? 'bg-gold text-ink-900 font-semibold shadow-[0_2px_10px_-2px_rgba(242,193,0,0.5)]'
                  : isLogged
                  ? 'bg-ink-700/60 text-chalk-500'
                  : 'text-chalk-300 hover:bg-ink-700'
              }`}
            >
              {s.stage}
              {isLogged && !isSel && <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-green/70" />}
            </button>
          );
        })}
      </div>

      {/* selected-stage hero */}
      <div className="flex items-center gap-4 p-4 sm:gap-5">
        <div className="relative h-16 w-40 shrink-0 overflow-hidden rounded-lg border border-ink-600/60 bg-ink-900/40 sm:w-52">
          <Elevation type={stage.type} className="h-full w-full" />
          <span className="absolute left-2 top-1.5 rounded bg-ink-900/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chalk-300">
            {STAGE_TYPE_LABEL[stage.type]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-chalk-100">Stage {stage.stage}</span>
            {stage.summitFinish && <span className="chip bg-polka/15 j-polka">Summit finish</span>}
            {stage.doubleSprint && <span className="chip bg-green/15 j-green">2× sprint</span>}
          </div>
          <div className="truncate text-sm text-chalk-300">{stage.route}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-chalk-500">
            <span>{stage.date}</span>
            <span className="text-ink-400">·</span>
            <span className="mono">{stage.km} km</span>
            {stage.note && <><span className="text-ink-400">·</span><span className="truncate">{stage.note}</span></>}
          </div>
        </div>
      </div>
    </section>
  );
}
