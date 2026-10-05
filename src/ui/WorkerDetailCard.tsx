import { goToScene, resetCamera, selectWorker } from '../app/transitions';
import { useUi } from '../app/uiStore';
import { WORKERS, WORKER_BY_ID } from '../data/workers';
import { formatSessionTime } from '../simulation/calendar';
import { formatMoney } from '../simulation/pnl';
import { useSim } from '../simulation/simulationStore';
import { CountUp } from './CountUp';
import { statusLine, statusTone } from './format';

function cycle(delta: number) {
  const ui = useUi.getState();
  const idx = WORKERS.findIndex((w) => w.id === ui.selectedWorkerId);
  const next = WORKERS[(idx + delta + WORKERS.length) % WORKERS.length];
  selectWorker(next.id);
}

/** Side panel for the focused tower in the city. */
export function WorkerDetailCard() {
  const id = useUi((s) => s.selectedWorkerId);
  const scene = useUi((s) => s.scene);
  const rt = useSim((s) => (id ? s.workers[id] : null));
  const thoughts = useSim((s) => (id ? s.thoughts[id] : null));
  if (!id || !rt || scene !== 'city') return null;
  const cfg = WORKER_BY_ID[id];
  const tone = statusTone(rt);
  const charge = rt.status === 'charging' || rt.status === 'ready' ? rt.charge : 0;
  const winRate = rt.wins + rt.losses > 0 ? Math.round((rt.wins / (rt.wins + rt.losses)) * 100) : null;
  return (
    <aside className={`detail-card tone-${tone}`} style={{ ['--accent' as string]: cfg.accent }} aria-label={`${cfg.displayName} details`}>
      <div className="dc-head">
        <button type="button" className="icon-btn" onClick={() => cycle(-1)} aria-label="Previous worker">
          ◂
        </button>
        <div className="dc-title">
          <span className="dc-name">{cfg.displayName}</span>
          <span className="dc-strategy">{cfg.strategy}</span>
        </div>
        <button type="button" className="icon-btn" onClick={() => cycle(1)} aria-label="Next worker">
          ▸
        </button>
        <button
          type="button"
          className="icon-btn close"
          onClick={() => {
            selectWorker(null);
            resetCamera();
          }}
          aria-label="Close details"
        >
          ✕
        </button>
      </div>
      <div className="dc-status">{statusLine(rt)}</div>
      <div className="dc-bar" aria-hidden>
        <i style={{ width: `${charge}%` }} />
      </div>
      <dl className="dc-stats">
        <div>
          <dt>EARNED</dt>
          <dd>
            <CountUp value={rt.earned} className={rt.earned < 0 ? 'neg' : 'pos'} />
          </dd>
        </div>
        <div>
          <dt>TODAY</dt>
          <dd className={rt.todayPnl < 0 ? 'neg' : 'pos'}>{formatMoney(rt.todayPnl)}</dd>
        </div>
        <div>
          <dt>TRADES</dt>
          <dd>
            {rt.tradesToday} today{winRate !== null ? ` · ${winRate}% win` : ''}
          </dd>
        </div>
        <div>
          <dt>POSITION</dt>
          <dd>{rt.position ? `${rt.position.direction} x${rt.position.contracts} @ ${rt.position.entryPrice.toFixed(2)}` : 'flat'}</dd>
        </div>
      </dl>
      <div className="dc-thoughts">
        <span className="dc-sub">THOUGHTS</span>
        {(thoughts ?? []).slice(0, 4).map((t) => (
          <div key={t.id} className={`dc-thought tone-${t.tone}`}>
            <span>{formatSessionTime(t.minute)}</span> {t.text}
          </div>
        ))}
        {thoughts?.length === 0 && <div className="dc-thought dim">watching the tape…</div>}
      </div>
      <button type="button" className="primary-btn" onClick={() => goToScene('station', id)}>
        ENTER WORKSTATION ▸ <kbd>↵</kbd>
      </button>
    </aside>
  );
}
