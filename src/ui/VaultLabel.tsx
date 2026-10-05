import { memo } from 'react';
import { openSummary } from '../app/actions';
import { takeManualControl } from '../app/transitions';
import { WORKERS } from '../data/workers';
import { useSim } from '../simulation/simulationStore';
import { CountUp } from './CountUp';

/** Floating black panel above the vault: total realized P&L. Click → summary. */
export const VaultLabel = memo(function VaultLabel() {
  const vault = useSim((s) => s.vault);
  const days = useSim((s) => s.days.length);
  const onShift = useSim((s) => WORKERS.filter((w) => s.workers[w.id].status !== 'off-duty').length);
  return (
    <button
      type="button"
      className="vault-label"
      onClick={() => {
        takeManualControl();
        openSummary();
      }}
      aria-label="Open performance summary"
    >
      <div className="vl-head">THE VAULT · {days} TRADING DAYS</div>
      <CountUp value={vault} className={`vl-total ${vault < 0 ? 'neg' : ''}`} duration={600} />
      <div className="vl-sub">
        {onShift} worker{onShift === 1 ? '' : 's'} on shift · tap for payout
      </div>
    </button>
  );
});
