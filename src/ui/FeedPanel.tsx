import { liveFeeds } from '../live';
import { loadCapability } from '../live/claudeRuntime';
import { ROBINHOOD_SERVER } from '../live/config';
import type { FeedId, FeedStatus } from '../live/feed';
import { useLive } from '../live/liveStore';
import { toEt } from '../live/marketClock';
import { switchCityMode } from '../live/mode';
import { formatEtClock } from '../simulation/calendar';

const FEEDS: Array<{ id: FeedId; name: string }> = [
  { id: 'volx', name: 'VOLX DESK' },
  { id: 'rh-spx', name: 'SPX BOT' },
  { id: 'rh-me', name: 'MY ROBINHOOD' },
];

const PHASE_LABEL: Record<FeedStatus['phase'], string> = {
  connecting: 'connecting',
  live: 'live',
  synced: 'last sync',
  offline: 'offline',
  'needs-auth': 'reconnect',
  blocked: 'needs access',
  error: 'error',
};

/** "2:41 PM" today, "Mon 10/5 2:41 PM" on another day. */
function asOfText(ms: number): string {
  const at = toEt(ms);
  const today = toEt(Date.now()).date;
  const clock = formatEtClock(at.minuteOfDay - 570);
  if (at.date === today) return clock;
  const [, m, d] = at.date.split('-').map(Number);
  return `${m}/${d} ${clock}`;
}

async function allowRobinhood() {
  const permissions = await loadCapability('permissions');
  await permissions?.request([`mcp:${ROBINHOOD_SERVER}`]).catch(() => undefined);
  liveFeeds.robinhood.retry();
}

function FeedRow({ id, name }: { id: FeedId; name: string }) {
  const feed = useLive((s) => s.feeds[id]);
  let action: { label: string; run: () => void } | null = null;
  if (id === 'volx' && feed.phase !== 'live' && feed.phase !== 'connecting')
    action = { label: 'retry desk', run: () => liveFeeds.volx.retry() };
  else if (id !== 'volx' && feed.phase === 'blocked') action = { label: 'allow', run: () => void allowRobinhood() };
  else if (id !== 'volx' && (feed.phase === 'error' || feed.phase === 'needs-auth' || feed.phase === 'offline'))
    action = { label: 'retry', run: () => liveFeeds.robinhood.retry() };
  return (
    <li className={`feed-row ph-${feed.phase}`} title={feed.detail}>
      <span className="feed-top">
        <i className="feed-dot" aria-hidden="true" />
        <span className="feed-name">{name}</span>
        <span className="feed-phase">{PHASE_LABEL[feed.phase]}</span>
      </span>
      <span className="feed-detail">
        {feed.asOf && (feed.phase === 'live' || feed.phase === 'synced') ? `as of ${asOfText(feed.asOf)} · ` : ''}
        {feed.detail}
      </span>
      {action && (
        <button type="button" className="feed-act" onClick={action.run}>
          {action.label}
        </button>
      )}
    </li>
  );
}

/** Live mode: where each tower's data comes from, and whether it is flowing. */
export function FeedPanel() {
  return (
    <section className="feed-panel" aria-label="Live data feeds">
      <ul>
        {FEEDS.map((f) => (
          <FeedRow key={f.id} {...f} />
        ))}
      </ul>
      <button type="button" className="feed-mode" onClick={() => switchCityMode('demo')} title="Replay the 23-day demo run instead">
        view demo run ↗
      </button>
    </section>
  );
}
