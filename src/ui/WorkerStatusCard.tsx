import { memo, useEffect, useRef, useState } from 'react';
import { WORKER_BY_ID } from '../data/workers';
import { formatMoney } from '../simulation/pnl';
import { useSim } from '../simulation/simulationStore';
import type { WorkerId } from '../types/trading';
import { CountUp } from './CountUp';
import { statusLine, statusTone } from './format';

/** Floating card above each skyscraper: name, live status, earned. */
export const WorkerStatusCard = memo(function WorkerStatusCard({ workerId }: { workerId: WorkerId }) {
  const worker = useSim((s) => s.workers[workerId]);
  const cfg = WORKER_BY_ID[workerId];
  const tone = statusTone(worker);
  const charge = worker.status === 'charging' || worker.status === 'ready' ? worker.charge : 0;
  return (
    <div className={`status-card tone-${tone} st-${worker.status}`} style={{ ['--accent' as string]: cfg.accent }}>
      <PnlPopups workerId={workerId} />
      <div className="sc-name">{cfg.displayName}</div>
      <div className="sc-status">{statusLine(worker)}</div>
      {charge > 0 && (
        <div className="sc-bar">
          <i style={{ width: `${charge}%` }} />
        </div>
      )}
      <div className="sc-earned">
        earned <CountUp value={worker.earned} className={worker.earned < 0 ? 'neg' : 'pos'} />
      </div>
    </div>
  );
});

/** "+$412" floating up from the card whenever a trade closes. */
function PnlPopups({ workerId }: { workerId: WorkerId }) {
  const closeSeq = useSim((s) => s.fx[workerId].closeSeq);
  const lastPnl = useSim((s) => s.fx[workerId].lastPnl);
  const [items, setItems] = useState<Array<{ id: number; pnl: number }>>([]);
  const seen = useRef(closeSeq);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    if (closeSeq === 0) {
      seen.current = 0;
      setItems([]);
      return;
    }
    if (closeSeq <= seen.current) return;
    seen.current = closeSeq;
    const id = closeSeq;
    setItems((list) => [...list.slice(-2), { id, pnl: lastPnl }]);
    timers.current.push(window.setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 1700));
  }, [closeSeq, lastPnl]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  return (
    <div className="pnl-popups">
      {items.map((i) => (
        <span key={i.id} className={i.pnl >= 0 ? 'pos' : 'neg'}>
          {formatMoney(i.pnl)}
        </span>
      ))}
    </div>
  );
}

/** Black plaque mounted on the tower: name + cumulative P&L. */
export const TowerPlaque = memo(function TowerPlaque({ workerId }: { workerId: WorkerId }) {
  const earned = useSim((s) => s.workers[workerId].earned);
  const cfg = WORKER_BY_ID[workerId];
  return (
    <div className="tower-plaque">
      <div className="tp-name">{cfg.displayName}</div>
      <CountUp value={earned} className={`tp-pnl ${earned < 0 ? 'neg' : 'pos'}`} />
    </div>
  );
});
