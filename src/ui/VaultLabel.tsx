import { memo } from 'react';
import { openSummary } from '../app/actions';
import { takeManualControl } from '../app/transitions';
import { WORKERS } from '../data/workers';
import { LIVE_START } from '../live/config';
import { LIVE_MODE } from '../live/mode';
import { useSim } from '../simulation/simulationStore';
import { CountUp } from './CountUp';

const sinceLabel = (() => {
  const [, m, d] = LIVE_START.split('-').map(Number);
  return `${m}/${d}`;
})();

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
      <div className="vl-head">{LIVE_MODE ? `THE VAULT · REALIZED SINCE ${sinceLabel}` : `THE VAULT · ${days} TRADING DAYS`}</div>
      <CountUp value={vault} className={`vl-total ${vault < 0 ? 'neg' : ''}`} duration={600} />
      <div className="vl-sub">
        {onShift} {LIVE_MODE ? 'desk' : 'worker'}
        {onShift === 1 ? '' : 's'} on shift · {LIVE_MODE ? 'incl. VolX paper' : 'tap for payout'}
      </div>
    </button>
  );
});
