import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, range, type Rng } from '../simulation/rng';
import type { BoxSpec } from './towerDesign';

export interface WindowInstances {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
  seeds: Float32Array;
}

export interface WindowOptions {
  /** Horizontal pitch between window centers. */
  pitchX?: number;
  /** Vertical pitch between floors. */
  pitchY?: number;
  /** Window size relative to pitch. */
  fillX?: number;
  fillY?: number;
  /** Global brightness multiplier. */
  brightness?: number;
  /** Probability multiplier for lit windows. */
  litScale?: number;
  /** Fraction of warm (pale yellow) windows. */
  warm?: number;
  /** Skip faces pointing away from the camera (-z) to save instances. */
  skipBack?: boolean;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const FACES: Array<{ nx: number; nz: number; rot: number }> = [
  { nx: 0, nz: 1, rot: 0 },
  { nx: 1, nz: 0, rot: Math.PI / 2 },
  { nx: -1, nz: 0, rot: -Math.PI / 2 },
  { nx: 0, nz: -1, rot: Math.PI },
];

function windowColor(rng: Rng, warm: number, brightness: number): [number, number, number] {
  const r = rng();
  const b = range(rng, 0.9, 2.1) * brightness;
  if (r < warm) return [1.0 * b, 0.84 * b, 0.55 * b];
  if (r < warm + 0.3) return [0.6 * b, 0.9 * b, 1.0 * b];
  if (r < warm + 0.36) return [0.28 * b * 0.5, 0.32 * b * 0.5, 0.7 * b * 0.5];
  return [0.95 * b, 0.97 * b, 1.0 * b];
}

/** Lays out tiny lit windows over the four faces of each box. */
export function buildWindowInstances(boxes: BoxSpec[], seed: number, opts: WindowOptions = {}): WindowInstances {
  const { pitchX = 0.15, pitchY = 0.19, fillX = 0.55, fillY = 0.55, brightness = 1, litScale = 1, warm = 0.08, skipBack = false } = opts;
  const rng = createRng(seed);
  const matrices: number[] = [];
  const colors: number[] = [];
  const seeds: number[] = [];

  for (const box of boxes) {
    const lit = (box.lit ?? 0.6) * litScale;
    const rows = Math.floor((box.h - pitchY * 0.6) / pitchY);
    // Some buildings get horizontal "office floor" banding.
    const banded = rng() < 0.35;
    const rowLit = Array.from({ length: Math.max(0, rows) }, () => (banded ? (rng() < 0.55 ? 1.25 : 0.35) : 1));
    for (const face of FACES) {
      if (skipBack && face.nz < 0) continue;
      const faceWidth = face.nx === 0 ? box.w : box.d;
      const cols = Math.floor((faceWidth - pitchX * 0.5) / pitchX);
      if (cols <= 0 || rows <= 0) continue;
      const startX = -((cols - 1) * pitchX) / 2;
      const offset = (face.nx === 0 ? box.d : box.w) / 2 + 0.004;
      tmpQ.setFromAxisAngle(UP, face.rot);
      tmpS.set(pitchX * fillX, pitchY * fillY, 1);
      for (let r = 0; r < rows; r++) {
        const y = box.y + pitchY * 0.65 + r * pitchY;
        for (let c = 0; c < cols; c++) {
          if (rng() > lit * rowLit[r]) continue;
          const along = startX + c * pitchX;
          // Local face coordinates → world.
          const lx = face.nx === 0 ? along * (face.nz > 0 ? 1 : -1) : face.nx * offset;
          const lz = face.nx === 0 ? face.nz * offset : along * (face.nx > 0 ? -1 : 1);
          tmpP.set(box.x + lx, y, box.z + lz);
          tmpM.compose(tmpP, tmpQ, tmpS);
          matrices.push(...tmpM.elements);
          colors.push(...windowColor(rng, warm, brightness));
          seeds.push(rng() * 100);
        }
      }
    }
  }
  return {
    count: seeds.length,
    matrices: new Float32Array(matrices),
    colors: new Float32Array(colors),
    seeds: new Float32Array(seeds),
  };
}

export function mergeWindowInstances(parts: WindowInstances[]): WindowInstances {
  const count = parts.reduce((a, p) => a + p.count, 0);
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  let o = 0;
  for (const p of parts) {
    matrices.set(p.matrices, o * 16);
    colors.set(p.colors, o * 3);
    seeds.set(p.seeds, o);
    o += p.count;
  }
  return { count, matrices, colors, seeds };
}

/** One LineSegments geometry holding the 12 edges of every box. */
export function boxEdgesGeometry(boxes: BoxSpec[], verticalOnly = false): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const b of boxes) {
    const x0 = b.x - b.w / 2;
    const x1 = b.x + b.w / 2;
    const z0 = b.z - b.d / 2;
    const z1 = b.z + b.d / 2;
    const y0 = b.y;
    const y1 = b.y + b.h;
    const corners: Array<[number, number]> = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      if (!verticalOnly) {
        pos.push(ax, y1, az, bx, y1, bz);
        pos.push(ax, y0, az, bx, y0, bz);
      }
      pos.push(ax, y0, az, ax, y1, az);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Square frame of thin bars (glowing platform outline). */
export function frameGeometry(size: number, thickness: number, height: number): THREE.BufferGeometry {
  const half = size / 2;
  const bars = [
    new THREE.BoxGeometry(size + thickness, height, thickness).translate(0, 0, half),
    new THREE.BoxGeometry(size + thickness, height, thickness).translate(0, 0, -half),
    new THREE.BoxGeometry(thickness, height, size).translate(half, 0, 0),
    new THREE.BoxGeometry(thickness, height, size).translate(-half, 0, 0),
  ];
  const merged = mergeGeometries(bars);
  bars.forEach((b) => b.dispose());
  return merged;
}

/** Boxes merged into a single geometry (static building bodies). */
export function mergedBoxesGeometry(boxes: BoxSpec[]): THREE.BufferGeometry {
  const parts = boxes.map((b) => new THREE.BoxGeometry(b.w, b.h, b.d).translate(b.x, b.y + b.h / 2, b.z));
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Rectangle outline in the XY plane (billboards, monitor bezels). */
export function rectFrameGeometry(width: number, height: number, thickness: number, depth = thickness): THREE.BufferGeometry {
  const bars = [
    new THREE.BoxGeometry(width + thickness, thickness, depth).translate(0, height / 2, 0),
    new THREE.BoxGeometry(width + thickness, thickness, depth).translate(0, -height / 2, 0),
    new THREE.BoxGeometry(thickness, height, depth).translate(width / 2, 0, 0),
    new THREE.BoxGeometry(thickness, height, depth).translate(-width / 2, 0, 0),
  ];
  const merged = mergeGeometries(bars);
  bars.forEach((b) => b.dispose());
  return merged;
}
