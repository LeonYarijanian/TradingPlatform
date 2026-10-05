import { BASE_MINUTES_PER_SECOND, engine } from '../simulation/controller';
import type { WorkerId } from '../types/trading';
import { goToScene } from './transitions';
import { useUi } from './uiStore';

type Phase = 'intro' | 'city' | 'station' | 'fast' | 'outro' | 'done';

/** Timeline of the AUTO DEMO (seconds), modelled on the reference recording. */
export const DEMO_TIMELINE = {
  introEnd: 6,
  cityEnd: 26,
  stationEnd: 38,
  /** The accelerated city phase lands the last session close here. */
  fastEnd: 96,
  /** Pause on the finished city before the summary opens. */
  outroHold: 1.4,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Drives scene changes and simulation speed while AUTO DEMO is on. It never
 * touches trading state directly — it only chooses where to look and how fast
 * the clock runs.
 */
export class DemoDirector {
  active = false;
  phase: Phase = 'done';
  /** Seconds since the director started. */
  t = 0;
  speed = 1;
  private phaseStart = 0;
  private fastEnd: number = DEMO_TIMELINE.fastEnd;
  private stationFire: { workerId: WorkerId; time: number } | null = null;

  start(fromScratch: boolean): void {
    this.active = true;
    this.t = 0;
    this.phaseStart = 0;
    if (fromScratch) {
      this.phase = 'intro';
      this.speed = 1;
      goToScene('station', 'qqq-og', { instant: true });
      useUi.setState({ selectedWorkerId: null });
    } else {
      // Resume mid-run: finish the remaining sessions in a compressed city sweep.
      this.phase = 'fast';
      const remainingShare = 1 - engine.currentTime / engine.totalMinutes;
      this.fastEnd = clamp(60 * remainingShare, 8, 60);
      goToScene('city');
    }
  }

  stop(): void {
    this.active = false;
    this.phase = 'done';
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseStart = this.t;
  }

  /** Returns the speed multiplier for this frame. */
  update(dt: number): number {
    this.t += dt;
    const now = engine.currentTime;
    switch (this.phase) {
      case 'intro':
        this.speed = 1;
        if (this.t >= DEMO_TIMELINE.introEnd) {
          goToScene('city');
          this.enter('city');
        }
        break;
      case 'city':
        this.speed = 2.4;
        if (this.t >= DEMO_TIMELINE.cityEnd) {
          // Visit the worker that is about to fire so the station shows a trade.
          this.stationFire = engine.findNextFire(now + 2.5);
          goToScene('station', this.stationFire?.workerId ?? 'qqq-trend');
          this.enter('station');
        }
        break;
      case 'station': {
        const fireAtSecond = this.phaseStart + 6.2;
        if (this.stationFire && now < this.stationFire.time) {
          const realLeft = Math.max(0.6, fireAtSecond - this.t);
          this.speed = clamp((this.stationFire.time - now) / (realLeft * BASE_MINUTES_PER_SECOND), 0.35, 10);
        } else {
          this.speed = 1;
        }
        if (this.t >= DEMO_TIMELINE.stationEnd) {
          goToScene('city');
          this.fastEnd = DEMO_TIMELINE.fastEnd;
          this.enter('fast');
        }
        break;
      }
      case 'fast': {
        const remainingMinutes = engine.totalMinutes - now;
        const remainingSeconds = Math.max(0.4, this.fastEnd - this.t);
        const target = clamp(remainingMinutes / remainingSeconds / BASE_MINUTES_PER_SECOND, 1, 80);
        // Ease into the fast-forward over the first few seconds.
        const ramp = clamp((this.t - this.phaseStart) / 4, 0, 1);
        this.speed = 2.4 + (target - 2.4) * ramp;
        if (engine.finished) this.enter('outro');
        break;
      }
      case 'outro':
        this.speed = 1;
        if (this.t - this.phaseStart >= DEMO_TIMELINE.outroHold) {
          useUi.setState({ summaryOpen: true });
          this.enter('done');
        }
        break;
      case 'done':
        this.speed = 1;
        break;
    }
    return this.speed;
  }
}

export const demoDirector = new DemoDirector();
