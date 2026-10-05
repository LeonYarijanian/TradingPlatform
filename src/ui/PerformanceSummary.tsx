import { useEffect, useMemo, useRef, useState } from 'react';
import { closeSummary, replay } from '../app/actions';
import { useUi } from '../app/uiStore';
import { WORKERS } from '../data/workers';
import { formatCompact, formatMoney } from '../simulation/pnl';
import { summarize } from '../simulation/reducer';
import { useSim } from '../simulation/simulationStore';
import { CountUp } from './CountUp';
import { WorkerLeaderboard } from './WorkerLeaderboard';

type Phase = 'closed' | 'opening' | 'open' | 'closing';

/** Centered results screen over the blurred, still-living city. */
export function PerformanceSummary() {
  const open = useUi((s) => s.summaryOpen);
  const [phase, setPhase] = useState<Phase>('closed');
  const [snapshot, setSnapshot] = useState(() => takeSnapshot());
  const [countTo, setCountTo] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setSnapshot(takeSnapshot());
      setCountTo(0);
      setPhase('opening');
      const t1 = window.setTimeout(() => setPhase('open'), 30);
      const t2 = window.setTimeout(() => setCountTo(1), 200);
      const t3 = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 400);
      return () => [t1, t2, t3].forEach((t) => window.clearTimeout(t));
    }
    if (phase === 'open' || phase === 'opening') {
      setPhase('closing');
      const t = window.setTimeout(() => setPhase('closed'), 380);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const max = useMemo(() => Math.max(1, ...snapshot.days.map((d) => d.pnl)), [snapshot]);
  if (phase === 'closed') return null;

  const { summary, days } = snapshot;
  return (
    <div
      className={`summary-overlay phase-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label="Performance summary"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSummary();
      }}
    >
      <div className="summary-panel">
        <div className="sm-kicker">{summary.daysPlayed} TRADING DAYS</div>
        <CountUp value={countTo ? summary.total : 0} from={0} duration={800} className={`sm-total ${summary.total < 0 ? 'neg' : ''}`} />
        <div className="sm-sub">
          {summary.daysPlayed} trading days · {summary.green} green · {WORKERS.length} workers
        </div>

        <div className="sm-chart" role="img" aria-label="Daily P&L bar chart">
          {days.map((d, i) => {
            const h = d.status === 'pending' ? 0 : Math.max(2, (Math.max(0, d.pnl) / max) * 100);
            return (
              <div
                key={d.date}
                className={`sm-bar-slot ${d.status} ${d.pnl < 0 ? 'neg' : ''} ${summary.best?.index === i ? 'best' : ''}`}
                style={{ ['--h' as string]: `${h}%`, ['--d' as string]: `${400 + i * 28}ms` }}
              >
                <span className="sm-bar-wrap">
                  <span className="sm-bar">
                    <span className="sm-val">{d.status === 'pending' ? '' : formatCompact(d.pnl)}</span>
                  </span>
                </span>
                <span className="sm-date">{d.label.split(' ')[1]}</span>
              </div>
            );
          })}
        </div>

        {summary.best && summary.best.pnl > 0 && (
          <div className="sm-best">
            🔥 BEST DAY {formatMoney(summary.best.pnl)} · {summary.best.label}
          </div>
        )}

        <WorkerLeaderboard rows={summary.leaderboard.slice(0, 3)} />

        <div className="sm-actions">
          <button type="button" className="violet-btn" onClick={() => replay()}>
            ↻ Replay
          </button>
          <button type="button" className="violet-btn" ref={closeRef} onClick={() => closeSummary()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function takeSnapshot() {
  const state = useSim.getState();
  return { summary: summarize(state), days: state.days };
}
