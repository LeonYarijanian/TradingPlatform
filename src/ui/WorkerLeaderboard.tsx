import { formatMoney } from '../simulation/pnl';
import type { WorkerId } from '../types/trading';

const MEDALS = ['🏆', '🥈', '🥉'];

export function WorkerLeaderboard({ rows }: { rows: Array<{ id: WorkerId; name: string; earned: number }> }) {
  return (
    <ol className="sm-leaderboard" aria-label="Worker leaderboard">
      {rows.map((r, i) => (
        <li key={r.id} style={{ ['--d' as string]: `${900 + i * 90}ms` }}>
          <span className="lb-medal">{MEDALS[i] ?? `${i + 1}.`}</span>
          <span className="lb-name">{r.name}</span>
          <span className={`lb-val ${r.earned < 0 ? 'neg' : ''}`}>{formatMoney(r.earned)}</span>
        </li>
      ))}
    </ol>
  );
}
