'use client';
import { useStore } from '@/lib/store';
import { Elevation, STAGE_TYPE_LABEL } from './Elevation';

// Stage selector + the roadbook elevation strip. Shared across pages.
export function StageBar() {
  const stages = useStore((s) => s.stages);
  const selected = useStore((s) => s.selectedStage);
  const setStage = useStore((s) => s.setSelectedStage);
  const logged = useStore((s) => s.loggedStages);
  const stage = stages.find((s) => s.stage === selected)!;

  return (
    <div className="card mb-4 overflow-hidden">
      <div className="flex flex-wrap gap-1 border-b border-ink-600 p-2">
        {stages.map((s) => {
          const isLogged = logged.includes(s.stage);
          return (
            <button
              key={s.stage}
              onClick={() => setStage(s.stage)}
              title={`Stage ${s.stage}: ${s.route}`}
              className={`mono h-7 w-7 rounded text-xs transition-colors ${
                s.stage === selected
                  ? 'bg-yellow text-ink-900 font-bold'
                  : isLogged
                  ? 'bg-ink-600 text-chalk-500 line-through'
                  : 'bg-ink-700 text-chalk-300 hover:bg-ink-600'
              }`}
            >
              {s.stage}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 p-3">
        <div className="h-12 w-32 shrink-0 sm:w-44">
          <Elevation type={stage.type} className="h-full w-full" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="mono text-sm font-bold">Stage {stage.stage}</span>
            <span className="chip border border-ink-500 text-chalk-300">{STAGE_TYPE_LABEL[stage.type]}</span>
            {stage.summitFinish && <span className="chip bg-polka/15 j-polka">summit</span>}
            {stage.doubleSprint && <span className="chip bg-green/15 j-green">2× sprint</span>}
          </div>
          <div className="truncate text-sm text-chalk-300">{stage.route}</div>
          <div className="mono text-[11px] text-chalk-500">
            {stage.date} · {stage.km}km · {stage.note}
          </div>
        </div>
      </div>
    </div>
  );
}
