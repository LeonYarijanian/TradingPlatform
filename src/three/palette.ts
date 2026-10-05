import * as THREE from 'three';
import type { OptionDirection } from '../types/trading';

/** Scene palette (sRGB hex). Bright accents are pushed into HDR so bloom picks them up. */
export const PALETTE = {
  black: '#04030B',
  black2: '#050510',
  navy: '#07072A',
  navy2: '#090A3C',
  indigo: '#2010C7',
  indigo2: '#321CFF',
  purple: '#5C19E6',
  violet: '#7D28FF',
  cyan: '#47F4FF',
  mint: '#5DFFDA',
  green: '#63FF9A',
  white: '#F8FAFF',
  magenta: '#FF267A',
  red: '#FF365F',
  yellow: '#FFD247',
  orange: '#FFAA38',
  building: '#0a0a1d',
  buildingEdge: '#24206a',
  fog: '#0b0722',
} as const;

/** HDR color: sRGB hex scaled into linear >1 range for bloom. */
export function hdr(hex: string, intensity = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

export const SIGNAL_COLORS: Record<OptionDirection, { core: string; shell: string; aura: string }> = {
  CALL: { core: '#EFFFF8', shell: PALETTE.mint, aura: '#36FFB8' },
  PUT: { core: '#FFF0F4', shell: PALETTE.magenta, aura: '#FF2E6A' },
};

export function signalColor(direction: OptionDirection | null): string {
  if (direction === 'CALL') return SIGNAL_COLORS.CALL.shell;
  if (direction === 'PUT') return SIGNAL_COLORS.PUT.shell;
  return PALETTE.cyan;
}
