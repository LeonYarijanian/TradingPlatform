import { useEffect } from 'react';
import { engine, stepSimulation } from '../simulation/controller';
import { usePlayback } from '../simulation/simulationStore';
import { demoDirector } from './director';
import { getUi, useUi } from './uiStore';

/**
 * The single clock of the app. Every frame it asks the director (if AUTO DEMO
 * is on) for a speed, advances the engine, and the engine's events flow into
 * the store — so every view updates from the same tick.
 */
export function useSimulationLoop(): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let wasFinished = engine.finished;
    let finishedAt = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const ui = getUi();
      const playback = usePlayback.getState();

      if (ui.ready && !ui.live) {
        let speed = playback.speed;
        if (ui.autoDemo) {
          if (!demoDirector.active) demoDirector.start(engine.currentTime === 0);
          if (playback.playing) speed = demoDirector.update(dt);
        } else if (demoDirector.active) {
          demoDirector.stop();
        }

        if (playback.playing) stepSimulation(dt, speed);
        if (Math.abs(playback.effectiveSpeed - speed) > 0.05) usePlayback.setState({ effectiveSpeed: speed });

        // Manual runs also end on the summary.
        if (engine.finished && !wasFinished) finishedAt = now;
        if (finishedAt && !ui.autoDemo && now - finishedAt > 1400) {
          finishedAt = 0;
          useUi.setState({ summaryOpen: true });
        }
        if (!engine.finished) finishedAt = 0;
        wasFinished = engine.finished;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
}
