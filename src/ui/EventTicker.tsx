import { WORKER_BY_ID } from '../data/workers';
import { formatSessionTime } from '../simulation/calendar';
import { useSim } from '../simulation/simulationStore';
import type { LogEntry } from '../types/trading';
import { useThrottledSim } from './useThrottled';

const VISIBLE = 5;

/** Terminal-style stream of the latest trades and bot chatter. */
export function EventTicker() {
  const entries = useThrottledSim((s) => s.ticker, 260);
  const days = useSim((s) => s.days);
  // Oldest of the visible window on top, newest at the bottom (terminal style).
  const rows = entries.slice(0, VISIBLE).reverse();
  return (
    <div className="ticker" role="log" aria-live="off" aria-label="Trade events">
      {rows.length === 0 && <div className="tk-row dim">awaiting first signal…</div>}
      {rows.map((e: LogEntry, i) => {
        const w = WORKER_BY_ID[e.workerId];
        const prev = rows[i - 1];
        const showDate = !prev || prev.dayIndex !== e.dayIndex;
        return (
          <div key={e.id} className={`tk-row tone-${e.tone} ${i === rows.length - 1 ? 'is-new' : ''}`}>
            <span className="tk-name" style={{ color: w.accent }}>
              {w.displayName}
            </span>
            <span className="tk-time">
              {showDate && days[e.dayIndex] ? `${days[e.dayIndex].label} ` : ''}
              {formatSessionTime(e.minute)}
            </span>
            <span className="tk-text">{e.text}</span>
          </div>
        );
      })}
    </div>
  );
}
