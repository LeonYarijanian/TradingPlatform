import { useEffect, useState } from 'react';
import { useUi } from '../app/uiStore';
import { WORKERS } from '../data/workers';

const MIN_MS = 1500;

/** Boot sequence in the same aesthetic, fading into the city. */
export function LoadingScreen() {
  const ready = useUi((s) => s.ready);
  const [shown, setShown] = useState(0);
  const [minDone, setMinDone] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const timers = WORKERS.map((_, i) => window.setTimeout(() => setShown(i + 1), 220 + i * 210));
    const min = window.setTimeout(() => setMinDone(true), MIN_MS);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(min);
    };
  }, []);

  const leaving = ready && minDone;
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setGone(true), 700);
    return () => window.clearTimeout(t);
  }, [leaving]);

  if (gone) return null;
  return (
    <div className={`loading-screen ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite">
      <div className="ls-box">
        <div className="ls-title">
          INITIALIZING WORKERS<span className="ls-dots">...</span>
        </div>
        {WORKERS.map((w, i) => (
          <div key={w.id} className={`ls-line ${i < shown ? 'on' : ''} ${w.offline ? 'is-offline' : ''}`}>
            <span className="ls-name">{w.displayName}</span>
            <span className="ls-fill" />
            <span className="ls-ok">{i < shown ? (w.offline ? 'OFFLINE' : 'ONLINE') : '…'}</span>
          </div>
        ))}
        <div className={`ls-line vault ${shown >= WORKERS.length ? 'on' : ''}`}>
          <span className="ls-name">THE VAULT</span>
          <span className="ls-fill" />
          <span className="ls-ok">{ready ? 'SEALED' : 'SYNCING'}</span>
        </div>
      </div>
    </div>
  );
}
