// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_TOTAL_TARGET } from '../data/demoRun';
import { engine, resetRun, stepSimulation } from '../simulation/controller';
import { useSim } from '../simulation/simulationStore';
import { DEMO_TIMELINE, DemoDirector } from './director';
import { useUi } from './uiStore';

/** Drive the director exactly like the app's rAF loop, at 60 fps of simulated time. */
function run(director: DemoDirector, seconds: number, onFrame?: (t: number) => void) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const speed = director.update(dt);
    stepSimulation(dt, speed);
    vi.advanceTimersByTime(dt * 1000);
    onFrame?.(director.t);
  }
}

describe('auto demo director', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUi.setState({ scene: 'city', summaryOpen: false, transition: null, autoDemo: true });
    resetRun();
  });
  afterEach(() => vi.useRealTimers());

  it('plays the reference sequence: station → city → station (with a FIRE) → fast city → summary', () => {
    const director = new DemoDirector();
    director.start(true);
    expect(useUi.getState().scene).toBe('station');
    expect(useUi.getState().stationWorkerId).toBe('qqq-og');

    const scenes: Array<{ t: number; scene: string }> = [];
    let stationFire: { t: number; worker: string } | null = null;
    let lastScene = useUi.getState().scene;
    let secondVisitWorker: string | null = null;
    let firesBefore = 0;

    run(director, 110, (t) => {
      const ui = useUi.getState();
      if (ui.scene !== lastScene) {
        scenes.push({ t, scene: ui.scene });
        lastScene = ui.scene;
        if (ui.scene === 'station') {
          secondVisitWorker = ui.stationWorkerId;
          firesBefore = useSim.getState().fx[ui.stationWorkerId].fireSeq;
        }
      }
      if (secondVisitWorker && ui.scene === 'station' && !stationFire) {
        const seq = useSim.getState().fx[secondVisitWorker as 'qqq'].fireSeq;
        if (seq > firesBefore) stationFire = { t, worker: secondVisitWorker };
      }
    });

    // Scene changes happen at the scripted beats (allowing for the ~0.43 s transition).
    expect(scenes.map((s) => s.scene)).toEqual(['city', 'station', 'city']);
    expect(scenes[0].t).toBeGreaterThan(DEMO_TIMELINE.introEnd);
    expect(scenes[0].t).toBeLessThan(DEMO_TIMELINE.introEnd + 1);
    expect(scenes[1].t).toBeGreaterThan(DEMO_TIMELINE.cityEnd);
    expect(scenes[2].t).toBeGreaterThan(DEMO_TIMELINE.stationEnd);

    // The worker we visit fires while we're watching it.
    expect(stationFire).not.toBeNull();
    expect(stationFire!.t).toBeGreaterThan(DEMO_TIMELINE.cityEnd);
    expect(stationFire!.t).toBeLessThan(DEMO_TIMELINE.stationEnd);

    // The run completes and the summary opens around the 1:38 mark.
    expect(engine.finished).toBe(true);
    expect(useSim.getState().vault).toBe(RUN_TOTAL_TARGET);
    expect(useUi.getState().summaryOpen).toBe(true);
  });

  it('finishes the fast-forward close to the scripted end time', () => {
    const director = new DemoDirector();
    director.start(true);
    let finishedAt = -1;
    run(director, 105, (t) => {
      if (finishedAt < 0 && engine.finished) finishedAt = t;
    });
    expect(finishedAt).toBeGreaterThan(DEMO_TIMELINE.fastEnd - 3);
    expect(finishedAt).toBeLessThan(DEMO_TIMELINE.fastEnd + 1.5);
  });

  it('resumes mid-run with a compressed city sweep', () => {
    engine.advance(engine.totalMinutes / 2);
    const director = new DemoDirector();
    director.start(false);
    expect(director.phase).toBe('fast');
    run(director, 45);
    expect(engine.finished).toBe(true);
  });
});
