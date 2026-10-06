import { memo } from 'react';
import { goToScene, selectWorker, takeManualControl } from '../app/transitions';
import { getUi, useUi } from '../app/uiStore';
import { WORKERS } from '../data/workers';
import { useLive } from '../live/liveStore';
import type { SessionPhase } from '../live/marketClock';
import { LIVE_MODE } from '../live/mode';
import { formatEtClock, formatSessionTime } from '../simulation/calendar';
import { useSim } from '../simulation/simulationStore';
import type { WorkerId } from '../types/trading';
import { CountUp } from './CountUp';
import { FeedPanel } from './FeedPanel';
import { statusDot, statusTone, STATUS_LABEL } from './format';

const PHASE_TAG: Record<SessionPhase, string> = { pre: 'PRE-MARKET', open: 'MARKET OPEN', post: 'AFTER HOURS', closed: 'MARKET CLOSED' };

/** Live mode: the real ET wall clock and where the session stands. */
function LiveClock() {
  const clock = useLive((s) => s.clock);
  const total = useSim((s) => s.days.length);
  return (
    <div className="hud-clock">
      <span className="hud-days">
        <b>{total}</b> DAY{total === 1 ? '' : 'S'}
      </span>
      <span className="hud-time">
        {clock ? `${clock.label} · ${formatEtClock(clock.minute)} ET` : '—'}
        {clock && <em className={`hud-phase ph-${clock.phase}`}>{PHASE_TAG[clock.phase]}</em>}
        <em className="hud-live">● LIVE</em>
      </span>
    </div>
  );
}

function Clock() {
  const day = useSim((s) => s.days[s.clock.dayIndex]);
  const minute = useSim((s) => Math.floor(s.clock.minute));
  const finished = useSim((s) => s.clock.finished);
  const total = useSim((s) => s.days.length);
  const live = useUi((s) => s.live);
  return (
    <div className="hud-clock">
      <span className="hud-days">
        <b>{total}</b> DAYS
      </span>
      <span className="hud-time">
        {day ? `${day.label} · ${formatSessionTime(minute)} ET` : '—'}
        {finished && <em className="hud-closed">CLOSED</em>}
        {live && <em className="hud-live">● LIVE</em>}
      </span>
    </div>
  );
}

const WorkerChip = memo(function WorkerChip({ id }: { id: WorkerId }) {
  const w = WORKERS.find((x) => x.id === id)!;
  const rt = useSim((s) => s.workers[id]);
  const selected = useUi((s) => (s.scene === 'city' ? s.selectedWorkerId === id : s.stationWorkerId === id));
  const tone = statusTone(rt);
  const label = w.offline
    ? 'offline · not connected'
    : rt.status === 'charging' || rt.status === 'ready'
      ? `${STATUS_LABEL[rt.status]} ${Math.round(rt.charge)}%`
      : STATUS_LABEL[rt.status];
  return (
    <button
      type="button"
      className={`hud-chip tone-${tone} ${selected ? 'is-selected' : ''} ${w.offline ? 'is-offline' : ''}`}
      style={{ ['--accent' as string]: w.accent }}
      onClick={() => {
        takeManualControl();
        if (getUi().scene === 'station') goToScene('station', id);
        else selectWorker(getUi().selectedWorkerId === id ? null : id);
      }}
      aria-label={`${w.displayName}: ${label}`}
    >
      <span className="chip-top">
        <span className="chip-name">
          {w.displayName}
          {w.paper && <i className="paper-tag">PAPER</i>}
        </span>
        {w.offline ? (
          <span className="chip-pnl dim">—</span>
        ) : (
          <CountUp value={rt.earned} className={`chip-pnl ${rt.earned < 0 ? 'neg' : ''}`} />
        )}
      </span>
      <span className="chip-status">
        <i className="chip-dot">{statusDot(rt.status)}</i> {label}
      </span>
    </button>
  );
});

/** Compact top-left game HUD: run clock + worker status chips. */
export function TopHUD() {
  return (
    <header className="top-hud" aria-label="Run status">
      {LIVE_MODE ? <LiveClock /> : <Clock />}
      <div className="hud-chips">
        {WORKERS.map((w) => (
          <WorkerChip key={w.id} id={w.id} />
        ))}
      </div>
      {LIVE_MODE && <FeedPanel />}
    </header>
  );
}
