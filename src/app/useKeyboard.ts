import { useEffect } from 'react';
import { WORKERS, workerByHotkey } from '../data/workers';
import { engine } from '../simulation/controller';
import { usePlayback } from '../simulation/simulationStore';
import { closeSummary, openSummary, replay } from './actions';
import { audio } from './audio';
import { goToScene, resetCamera, selectWorker, takeManualControl } from './transitions';
import { getUi, useUi } from './uiStore';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** Global keyboard shortcuts. */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const ui = getUi();
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';

      switch (e.key) {
        case 'Escape':
          if (ui.summaryOpen) closeSummary();
          else if (ui.debugOpen) useUi.setState({ debugOpen: false });
          else if (ui.scene === 'station') {
            takeManualControl();
            goToScene('city');
          } else if (ui.selectedWorkerId) {
            selectWorker(null);
            resetCamera();
          } else resetCamera();
          return;
        case ' ':
          if (onButton) return;
          e.preventDefault();
          usePlayback.getState().togglePlaying();
          return;
        case 'Enter':
          if (onButton) return;
          if (ui.scene === 'city' && ui.selectedWorkerId) {
            takeManualControl();
            goToScene('station', ui.selectedWorkerId);
          }
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          takeManualControl();
          const delta = e.key === 'ArrowLeft' ? -1 : 1;
          const current = ui.scene === 'station' ? ui.stationWorkerId : ui.selectedWorkerId;
          const idx = current ? WORKERS.findIndex((w) => w.id === current) : delta > 0 ? -1 : 0;
          const next = WORKERS[(idx + delta + WORKERS.length) % WORKERS.length];
          if (ui.scene === 'station') goToScene('station', next.id);
          else selectWorker(next.id);
          return;
        }
        case 'm':
        case 'M': {
          const muted = !ui.muted;
          useUi.setState({ muted });
          if (!muted) audio.unlock();
          return;
        }
        case 'r':
        case 'R':
          resetCamera();
          return;
        case 'p':
        case 'P':
          if (ui.summaryOpen) closeSummary();
          else {
            takeManualControl();
            openSummary();
          }
          return;
        case 'a':
        case 'A':
          if (ui.autoDemo) useUi.setState({ autoDemo: false });
          else if (engine.finished) replay();
          else useUi.setState({ autoDemo: true });
          return;
        case '`':
        case '~':
          useUi.setState({ debugOpen: !ui.debugOpen });
          return;
        default: {
          const n = Number(e.key);
          const w = Number.isInteger(n) ? workerByHotkey(n) : undefined;
          if (!w) return;
          takeManualControl();
          if (ui.scene === 'station') goToScene('station', w.id);
          else selectWorker(w.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
