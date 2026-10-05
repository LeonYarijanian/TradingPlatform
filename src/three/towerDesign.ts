import { WORKERS } from '../data/workers';
import type { WorkerConfig, WorkerId } from '../types/trading';
import { createRng, hashSeed, range } from '../simulation/rng';

/** Axis-aligned box: x/z are the center, y is the base. */
export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** Probability a window is lit. */
  lit?: number;
}

export interface TowerDesign {
  id: WorkerId;
  worker: WorkerConfig;
  platformSize: number;
  platformHeight: number;
  podium: BoxSpec;
  sections: BoxSpec[];
  crown: BoxSpec;
  /** Top of the roof structure (spire base). */
  roofY: number;
  spireTop: number;
  rings: Array<{ y: number; radius: number }>;
  auraCenterY: number;
  auraBaseRadius: number;
  auraMaxRadius: number;
  plaqueY: number;
  plaqueZ: number;
  statusY: number;
  /** Horizontal offset of the status card from the tower axis. */
  statusX: number;
  minis: BoxSpec[];
  trees: Array<[number, number, number, number]>;
}

type SectionRecipe = Array<[width: number, height: number]>;

const RECIPES: Record<WorkerId, { platform: number; podium: [number, number]; sections: SectionRecipe; spire: number }> = {
  qqq: {
    platform: 4.2,
    podium: [2.7, 0.9],
    sections: [
      [2.2, 4.3],
      [1.75, 2.0],
      [1.3, 1.4],
      [0.9, 0.9],
      [0.55, 0.55],
    ],
    spire: 2.25,
  },
  'qqq-og': {
    platform: 3.4,
    podium: [2.0, 0.6],
    sections: [
      [1.55, 3.7],
      [1.15, 1.5],
      [0.8, 0.8],
      [0.45, 0.45],
    ],
    spire: 1.15,
  },
  'qqq-trend': {
    platform: 3.2,
    podium: [1.8, 0.5],
    sections: [
      [1.3, 3.9],
      [0.95, 1.3],
      [0.6, 0.6],
    ],
    spire: 1.15,
  },
  spy: {
    platform: 3.2,
    podium: [2.0, 0.5],
    sections: [
      [1.6, 3.3],
      [1.2, 1.4],
      [0.75, 0.7],
    ],
    spire: 1.5,
  },
  iwm: {
    platform: 3.2,
    podium: [1.8, 0.5],
    sections: [
      [1.35, 3.4],
      [1.0, 1.2],
      [0.6, 0.55],
    ],
    spire: 1.3,
  },
};

export const PLATFORM_HEIGHT = 0.22;

function buildDesign(worker: WorkerConfig): TowerDesign {
  const recipe = RECIPES[worker.id];
  const [x, , z] = worker.position;
  const rng = createRng(hashSeed(`tower:${worker.id}`));
  const base = PLATFORM_HEIGHT;
  const podium: BoxSpec = { x, y: base, z, w: recipe.podium[0], h: recipe.podium[1], d: recipe.podium[0], lit: 0.5 };
  let y = base + recipe.podium[1];
  const sections: BoxSpec[] = recipe.sections.map(([w, h], i) => {
    const s: BoxSpec = { x, y, z, w, h, d: w, lit: i === 0 ? 0.62 : 0.7 };
    y += h;
    return s;
  });
  const crown: BoxSpec = {
    x,
    y,
    z,
    w: recipe.sections[recipe.sections.length - 1][0] * 0.55,
    h: 0.22,
    d: recipe.sections[recipe.sections.length - 1][0] * 0.55,
  };
  const roofY = y + crown.h;
  const spireTop = roofY + recipe.spire;
  const top = sections[sections.length - 1];
  const scale = worker.id === 'qqq' ? 1.3 : 1;
  const rings = [
    { y: top.y - 0.15, radius: top.w * 0.9 + 0.55 * scale },
    { y: roofY + recipe.spire * 0.35, radius: 0.42 * scale },
  ];

  // Mini skyscrapers placed in the ring between the podium and the platform edge.
  const minis: BoxSpec[] = [];
  const half = recipe.platform / 2;
  const inner = recipe.podium[0] / 2 + 0.12;
  const mid = inner + (half - inner) / 2;
  // Four corners, left, right and back (the front stays open for the plaque).
  const slots: Array<[number, number]> = [
    [-mid, -mid],
    [mid, -mid],
    [-mid, mid],
    [mid, mid],
    [-mid, 0],
    [mid, 0],
    [0, -mid],
  ];
  slots.forEach(([mx, mz], i) => {
    const room = half - inner - 0.08;
    const w = Math.min(room, range(rng, 0.28, 0.5));
    const h = range(rng, 0.7, 2.2) * (worker.id === 'qqq' ? 1.2 : 1) * (i < 4 ? 1 : 0.75);
    minis.push({ x: x + mx, y: base, z: z + mz, w, h, d: w, lit: 0.55 });
  });

  const trees: Array<[number, number, number, number]> = [];
  const treeRing = half - 0.18;
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const tx = x + side * range(rng, 0.25, inner - 0.05);
    const tz = z + treeRing;
    trees.push([tx, base, tz, range(rng, 0.22, 0.36)]);
  }
  trees.push([x - treeRing, base, z + treeRing - 0.3, 0.3], [x + treeRing, base, z + treeRing - 0.3, 0.26]);

  const topY = top.y + top.h;
  return {
    id: worker.id,
    worker,
    platformSize: recipe.platform,
    platformHeight: PLATFORM_HEIGHT,
    podium,
    sections,
    crown,
    roofY,
    spireTop,
    rings,
    auraCenterY: topY * 0.66,
    auraBaseRadius: 1.4 * scale,
    auraMaxRadius: 3.2 * (worker.id === 'qqq' ? 1.18 : 1),
    plaqueY: base + recipe.podium[1] + recipe.sections[0][1] * (worker.id === 'qqq' ? 0.55 : 0.5),
    plaqueZ: z + recipe.sections[0][0] / 2 + 0.05,
    // The tall QQQ tower carries its card beside the spire so it stays in frame.
    statusY: worker.id === 'qqq' ? spireTop - 1.15 : spireTop + 0.95,
    statusX: worker.id === 'qqq' ? 1.95 : 0,
    minis,
    trees,
  };
}

export const TOWER_DESIGNS: Record<WorkerId, TowerDesign> = Object.fromEntries(WORKERS.map((w) => [w.id, buildDesign(w)])) as Record<
  WorkerId,
  TowerDesign
>;
