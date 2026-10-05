// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveScene, goToScene, pendingStationWorker, TRANSITION_IN_MS, TRANSITION_OUT_MS } from './transitions';
import { useUi } from './uiStore';

describe('scene transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUi.setState({ scene: 'city', stationWorkerId: 'qqq-og', transition: null });
  });
  afterEach(() => vi.useRealTimers());

  it('flies out, swaps the scene, then settles', () => {
    goToScene('station', 'spy');
    expect(useUi.getState().transition?.phase).toBe('out');
    expect(useUi.getState().scene).toBe('city');
    expect(effectiveScene()).toBe('station');
    expect(pendingStationWorker()).toBe('spy');
    vi.advanceTimersByTime(TRANSITION_OUT_MS);
    expect(useUi.getState().scene).toBe('station');
    expect(useUi.getState().stationWorkerId).toBe('spy');
    vi.advanceTimersByTime(TRANSITION_IN_MS);
    expect(useUi.getState().transition).toBeNull();
  });

  it('does not restart when asked for the same destination again (key repeat)', () => {
    goToScene('station', 'spy');
    const started = useUi.getState().transition!.startedAt;
    vi.advanceTimersByTime(200);
    goToScene('station', 'spy');
    expect(useUi.getState().transition!.startedAt).toBe(started);
    vi.advanceTimersByTime(TRANSITION_OUT_MS - 200);
    expect(useUi.getState().scene).toBe('station');
  });

  it('can be redirected back to the city mid fly-in', () => {
    goToScene('station', 'iwm');
    vi.advanceTimersByTime(100);
    goToScene('city');
    vi.advanceTimersByTime(TRANSITION_OUT_MS + TRANSITION_IN_MS);
    expect(useUi.getState().scene).toBe('city');
    expect(useUi.getState().transition).toBeNull();
  });
});
