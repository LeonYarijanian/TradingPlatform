import * as THREE from 'three';
import { WORKERS } from '../data/workers';
import { getUi } from '../app/uiStore';
import { getSim } from '../simulation/simulationStore';
import type { OptionDirection, WorkerId, WorkerStatus } from '../types/trading';
import { SIGNAL_COLORS, PALETTE } from './palette';

/**
 * Per-tower visual state, derived once per frame from the simulation store.
 * Every 3D effect (spire, rings, aura, beam, sparks, lights, robot, popups)
 * reads from here so they stay perfectly in sync.
 */
export interface TowerFxState {
  status: WorkerStatus;
  /** Last non-null direction (kept while effects fade out). */
  direction: OptionDirection;
  /** Smoothed charge used by the aura, 0..1. */
  charge: number;
  rawCharge: number;
  /** Seconds since last FIRE (Infinity if never). */
  fireAge: number;
  /** Seconds since last trade close. */
  closeAge: number;
  lastPnl: number;
  /** Beam brightness 0..1 and vertical growth 0..1. */
  beam: number;
  beamGrow: number;
  /** Aura burst at fire time 0..1. */
  burst: number;
  /** Spire/ring brightness multiplier. */
  intensity: number;
  /** 0..1 oscillation for spire pulses. */
  pulse: number;
  highlight: number;
  color: THREE.Color;
  fireSeq: number;
  closeSeq: number;
}

const DIRECTION_COLOR: Record<OptionDirection, THREE.Color> = {
  CALL: new THREE.Color(SIGNAL_COLORS.CALL.aura),
  PUT: new THREE.Color(SIGNAL_COLORS.PUT.aura),
};
const IDLE_COLOR = new THREE.Color(PALETTE.cyan);

function initial(): TowerFxState {
  return {
    status: 'off-duty',
    direction: 'CALL',
    charge: 0,
    rawCharge: 0,
    fireAge: Infinity,
    closeAge: Infinity,
    lastPnl: 0,
    beam: 0,
    beamGrow: 0,
    burst: 0,
    intensity: 1,
    pulse: 0,
    highlight: 0,
    color: IDLE_COLOR.clone(),
    fireSeq: 0,
    closeSeq: 0,
  };
}

export const towerFx: Record<WorkerId, TowerFxState> = Object.fromEntries(WORKERS.map((w) => [w.id, initial()])) as Record<
  WorkerId,
  TowerFxState
>;

let lastRunId = -1;
let phase: Record<WorkerId, number> = Object.fromEntries(WORKERS.map((w) => [w.id, Math.random() * 10])) as Record<WorkerId, number>;

const BASE_INTENSITY: Record<WorkerStatus, number> = {
  'off-duty': 0.35,
  watching: 1,
  scanning: 1.1,
  charging: 1.4,
  ready: 2.6,
  firing: 4.5,
  managing: 2.2,
  trailing: 1.8,
  cooldown: 1.15,
};

const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Advance all tower effect states. Call exactly once per frame. */
export function updateTowerFx(dt: number): void {
  const sim = getSim();
  const ui = getUi();
  const reduced = ui.reducedMotion;
  if (sim.runId !== lastRunId) {
    lastRunId = sim.runId;
    for (const w of WORKERS) Object.assign(towerFx[w.id], initial(), { color: IDLE_COLOR.clone() });
    phase = Object.fromEntries(WORKERS.map((w) => [w.id, Math.random() * 10])) as Record<WorkerId, number>;
  }

  for (const w of WORKERS) {
    const fx = towerFx[w.id];
    const rt = sim.workers[w.id];
    const seq = sim.fx[w.id];
    fx.status = rt.status;
    if (rt.direction) fx.direction = rt.direction;

    if (seq.fireSeq > fx.fireSeq) {
      fx.fireSeq = seq.fireSeq;
      fx.fireAge = 0;
      if (seq.lastDirection) fx.direction = seq.lastDirection;
    } else {
      fx.fireAge += dt;
    }
    if (seq.closeSeq > fx.closeSeq) {
      fx.closeSeq = seq.closeSeq;
      fx.closeAge = 0;
      fx.lastPnl = seq.lastPnl;
    } else {
      fx.closeAge += dt;
    }

    // Charge display with hysteresis so auras stay visible at high replay speeds.
    const charging = rt.status === 'charging' || rt.status === 'ready' || (rt.status === 'scanning' && rt.charge > 0);
    fx.rawCharge = charging ? rt.charge / 100 : 0;
    if (fx.fireAge < 0.5) {
      fx.charge = damp(fx.charge, 0, 7, dt);
    } else if (fx.rawCharge > fx.charge) {
      fx.charge = damp(fx.charge, fx.rawCharge, 5, dt);
    } else {
      fx.charge = Math.max(fx.rawCharge, fx.charge - dt * 0.6);
    }

    // Aura burst at the moment of firing.
    fx.burst = fx.fireAge < 0.5 ? Math.sin((fx.fireAge / 0.5) * Math.PI) : 0;

    // Beam envelope (real-time so it reads well at any replay speed).
    const a = fx.fireAge;
    const holding = rt.status === 'firing' || rt.status === 'managing';
    let beam = 0;
    if (a < 0.3) beam = 0;
    else if (a < 0.45) beam = (a - 0.3) / 0.15;
    else if (a < 1.3) beam = 1;
    else if (a < 2.3) beam = 1 - 0.65 * ((a - 1.3) / 1.0);
    else beam = holding ? 0.35 : Math.max(0, 0.35 - (a - 2.3) * 0.5);
    if (a > 6 && holding) beam = 0.35;
    fx.beam = damp(fx.beam, beam, a < 0.5 ? 30 : 8, dt);
    fx.beamGrow = a < 0.3 ? 0 : Math.min(1, (a - 0.3) / 0.16);
    if (fx.beam < 0.01 && a > 1) fx.beamGrow = 0;

    // Spire pulse.
    const rate = rt.status === 'ready' ? 7 : rt.status === 'charging' ? 1 + fx.rawCharge * 4.5 : rt.status === 'firing' ? 9 : 0.7;
    phase[w.id] += dt * rate * Math.PI * 2 * (reduced ? 0.3 : 1);
    fx.pulse = 0.5 + 0.5 * Math.sin(phase[w.id]);

    // Dark tower: no data source behind it (live mode spare slots).
    let target = w.offline ? 0.08 : BASE_INTENSITY[rt.status];
    if (fx.fireAge < 0.6) target = 7;
    fx.intensity = damp(fx.intensity, target, 6, dt);

    const hl = ui.selectedWorkerId === w.id ? 1 : ui.hoveredWorkerId === w.id ? 0.7 : 0;
    fx.highlight = damp(fx.highlight, hl, 8, dt);

    const active = rt.status !== 'watching' && rt.status !== 'off-duty' && rt.status !== 'cooldown';
    const targetColor = active || fx.charge > 0.02 || fx.beam > 0.02 ? DIRECTION_COLOR[fx.direction] : IDLE_COLOR;
    fx.color.lerp(targetColor, 1 - Math.exp(-6 * dt));
  }
}
