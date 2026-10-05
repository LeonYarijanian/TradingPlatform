import type { OptionDirection, WorkerId } from '../types/trading';
import { SimulationEngine } from './SimulationEngine';
import { useSim } from './simulationStore';

/** Session minutes that elapse per real second at 1x. A full session ≈ 65 s at 1x. */
export const BASE_MINUTES_PER_SECOND = 6;

/**
 * The demo engine. It is just one `BotEventSource`; swapping it for a
 * websocket/SSE source (see `liveSources.ts`) feeds the same store.
 */
export const engine = new SimulationEngine();
engine.subscribe((events) => useSim.getState().ingest(events));

export function resetRun(): void {
  engine.reset();
}

/** Advance the demo by `realSeconds` at `speed`× (1x = BASE_MINUTES_PER_SECOND). */
export function stepSimulation(realSeconds: number, speed: number): void {
  if (engine.finished) return;
  engine.advance(realSeconds * BASE_MINUTES_PER_SECOND * speed);
}

export function injectSignal(workerId: WorkerId, direction: OptionDirection): void {
  engine.inject(workerId, direction);
}

export function endDay(): void {
  engine.endDay();
}

export function skipToEnd(): void {
  if (!engine.finished) engine.advance(engine.totalMinutes - engine.currentTime);
}
