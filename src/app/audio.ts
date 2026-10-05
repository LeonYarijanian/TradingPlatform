import { useEffect } from 'react';
import { WORKERS } from '../data/workers';
import { useSim } from '../simulation/simulationStore';
import { getUi, useUi } from './uiStore';

/**
 * Tiny WebAudio synth: a quiet charging hum, a short energy pulse on FIRE,
 * a soft chime on profit and a success tone for the summary. No samples.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private humGain: GainNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private lastFire = 0;
  private lastChime = 0;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.ctx.destination);
      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      this.humOsc = this.ctx.createOscillator();
      this.humOsc.type = 'sawtooth';
      this.humOsc.frequency.value = 70;
      this.humOsc.connect(filter).connect(this.humGain).connect(this.master);
      this.humOsc.start();
    }
    void this.ctx.resume();
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !getUi().muted;
  }

  setHum(level: number): void {
    if (!this.ctx || !this.humGain || !this.humOsc) return;
    const t = this.ctx.currentTime;
    const on = this.ready ? level : 0;
    this.humGain.gain.setTargetAtTime(on * 0.08, t, 0.08);
    this.humOsc.frequency.setTargetAtTime(60 + on * 130, t, 0.1);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  fire(): void {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastFire < 180) return;
    this.lastFire = now;
    this.tone(180, 0.35, 'sawtooth', 0.35, 880);
    this.tone(90, 0.45, 'sine', 0.5, 45);
  }

  chime(win: boolean): void {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastChime < 150) return;
    this.lastChime = now;
    if (win) {
      this.tone(1046.5, 0.25, 'sine', 0.22);
      this.tone(1568, 0.35, 'sine', 0.16, undefined, 0.07);
    } else {
      this.tone(330, 0.3, 'triangle', 0.2, 220);
    }
  }

  success(): void {
    if (!this.ready) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.16, undefined, i * 0.09));
  }
}

export const audio = new AudioEngine();

/** Wires sounds to the same event stream that drives the visuals. */
export function useAudioReactions(): void {
  useEffect(() => {
    const seen = Object.fromEntries(WORKERS.map((w) => [w.id, { fire: 0, close: 0 }]));
    let lastRun = -1;
    const unsubSim = useSim.subscribe((s) => {
      if (s.runId !== lastRun) {
        lastRun = s.runId;
        WORKERS.forEach((w) => (seen[w.id] = { fire: s.fx[w.id].fireSeq, close: s.fx[w.id].closeSeq }));
        return;
      }
      let maxCharge = 0;
      for (const w of WORKERS) {
        const fx = s.fx[w.id];
        if (fx.fireSeq > seen[w.id].fire) audio.fire();
        if (fx.closeSeq > seen[w.id].close) audio.chime(fx.lastPnl >= 0);
        seen[w.id] = { fire: fx.fireSeq, close: fx.closeSeq };
        const rt = s.workers[w.id];
        if (rt.status === 'charging' || rt.status === 'ready') maxCharge = Math.max(maxCharge, rt.charge / 100);
      }
      audio.setHum(maxCharge);
    });
    const unsubUi = useUi.subscribe((s, prev) => {
      if (s.summaryOpen && !prev.summaryOpen) audio.success();
      if (s.muted && !prev.muted) audio.setHum(0);
    });
    return () => {
      unsubSim();
      unsubUi();
    };
  }, []);
}
