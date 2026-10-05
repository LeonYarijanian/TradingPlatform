import { useEffect, useMemo, useRef } from 'react';
import { formatMoney } from '../simulation/pnl';
import { useSim } from '../simulation/simulationStore';
import { CountUp } from './CountUp';

/** Horizontal strip of trading-day cards; the simulated day glows. */
export function TradingTimeline() {
  const days = useSim((s) => s.days);
  const active = useSim((s) => s.clock.dayIndex);
  const finished = useSim((s) => s.clock.finished);
  const scroller = useRef<HTMLDivElement>(null);

  const best = useMemo(() => {
    let b = -1;
    days.forEach((d, i) => {
      if (d.status !== 'pending' && d.pnl > 0 && (b === -1 || d.pnl > days[b].pnl)) b = i;
    });
    return b;
  }, [days]);

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-day="${active}"]`);
    const box = scroller.current;
    if (!el || !box) return;
    const target = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
    box.scrollTo({ left: target, behavior: 'smooth' });
  }, [active]);

  return (
    <div className="timeline" ref={scroller} role="list" aria-label="Trading days">
      {days.map((d, i) => {
        const isActive = i === active && !finished;
        const hot = i === best && d.pnl > 0;
        return (
          <div
            key={d.date}
            data-day={i}
            role="listitem"
            className={`day-card ${d.status} ${isActive ? 'is-active' : ''} ${d.pnl < 0 ? 'is-red' : ''}`}
          >
            <span className="dc-label">{d.label}</span>
            {d.status === 'pending' ? (
              <span className="dc-pnl dim">—</span>
            ) : isActive ? (
              <span className="dc-pnl">
                {hot && <i className="dc-fire">🔥</i>}
                <CountUp value={d.pnl} duration={400} />
              </span>
            ) : (
              <span className="dc-pnl">
                {hot && <i className="dc-fire">🔥</i>}
                {formatMoney(d.pnl)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
