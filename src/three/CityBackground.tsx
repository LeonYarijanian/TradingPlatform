import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useUi } from '../app/uiStore';
import { createRng, hashSeed, range } from '../simulation/rng';
import { buildWindowInstances, mergedBoxesGeometry } from './geometryUtils';
import { MATERIALS } from './materials';
import { hdr } from './palette';
import { createSkyMaterial } from './shaders';
import type { BoxSpec } from './towerDesign';
import { NO_RAYCAST, WindowsMesh } from './WindowsMesh';

function buildSkyline(): { boxes: BoxSpec[]; beacons: THREE.Vector3[] } {
  const rng = createRng(hashSeed('skyline'));
  const boxes: BoxSpec[] = [];
  const beacons: THREE.Vector3[] = [];
  // Kept low in the middle so the market wall reads above it; taller on the flanks.
  const rows = [
    { r: 24, n: 30, h: [1.2, 3.8] },
    { r: 31, n: 38, h: [1.8, 5.2] },
    { r: 38, n: 46, h: [2.4, 6.4] },
    { r: 64, n: 44, h: [5, 14] },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const a = -1.7 + (3.4 * i) / (row.n - 1) + range(rng, -0.03, 0.03);
      // Flanks sit further out so they frame rather than crowd the towers.
      const r = row.r + range(rng, -2, 2) + Math.max(0, Math.abs(a) - 0.9) * 9;
      const x = Math.sin(a) * r;
      const z = 2 - Math.cos(a) * r;
      if (z > 4 && Math.abs(x) < 17) continue;
      const w = range(rng, 1.2, 3.4);
      const d = range(rng, 1.2, 3.0);
      let h = range(rng, row.h[0], row.h[1]) * (1 + Math.max(0, Math.abs(a) - 0.55) * 1.6);
      if (rng() < 0.07) h *= 1.6;
      boxes.push({ x, y: 0, z, w, h, d, lit: range(rng, 0.05, 0.16) });
      if (h > 8 && rng() < 0.55) beacons.push(new THREE.Vector3(x, h + 0.15, z));
      // Occasional setback on taller blocks.
      if (h > 6 && rng() < 0.4) {
        const h2 = h * range(rng, 0.2, 0.45);
        boxes.push({ x, y: h, z, w: w * 0.6, h: h2, d: d * 0.6, lit: 0.12 });
        if (rng() < 0.6) beacons.push(new THREE.Vector3(x, h + h2 + 0.15, z));
      }
    }
  }
  return { boxes, beacons };
}

/** Purple gradient sky dome. */
export function Sky() {
  const material = useMemo(() => createSkyMaterial('#030210', '#1d0b52', '#5a22d6'), []);
  return (
    <mesh material={material} raycast={NO_RAYCAST} renderOrder={-10}>
      <sphereGeometry args={[190, 32, 16]} />
    </mesh>
  );
}

/** Dark skyline silhouettes with scattered windows and blinking rooftop beacons. */
export function Skyline() {
  const data = useMemo(() => {
    const { boxes, beacons } = buildSkyline();
    return {
      body: mergedBoxesGeometry(boxes),
      windows: buildWindowInstances(boxes, hashSeed('skyline-win'), {
        pitchX: 0.22,
        pitchY: 0.28,
        fillX: 0.42,
        fillY: 0.45,
        brightness: 0.5,
        warm: 0.12,
        skipBack: true,
      }),
      beacons,
    };
  }, []);
  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const reduced = useUi((s) => s.reducedMotion);
  const on = useMemo(() => hdr('#ff3d6e', 3), []);
  const off = useMemo(() => hdr('#3a0a18', 1), []);
  const white = useMemo(() => hdr('#ffffff', 2.4), []);
  const beaconGeo = useMemo(() => new THREE.SphereGeometry(0.09, 8, 6), []);
  const beaconMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);

  useFrame((state) => {
    const mesh = beaconRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    data.beacons.forEach((_, i) => {
      const phase = Math.sin(t * 2.2 + i * 1.7);
      const lit = reduced ? true : phase > 0.55;
      mesh.setColorAt(i, lit ? (i % 5 === 0 ? white : on) : off);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <mesh geometry={data.body} material={MATERIALS.buildingDark} raycast={NO_RAYCAST} />
      <WindowsMesh data={data.windows} />
      <instancedMesh
        ref={(m) => {
          beaconRef.current = m;
          if (!m) return;
          const mat = new THREE.Matrix4();
          data.beacons.forEach((p, i) => {
            mat.makeTranslation(p.x, p.y, p.z);
            m.setMatrixAt(i, mat);
            m.setColorAt(i, on);
          });
          m.instanceMatrix.needsUpdate = true;
        }}
        args={[beaconGeo, beaconMat, data.beacons.length]}
        raycast={NO_RAYCAST}
      />
    </group>
  );
}

/** Tiny rectangles drifting across the distant sky. */
export function SkyDashes({ count = 70 }: { count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const reduced = useUi((s) => s.reducedMotion);
  const items = useMemo(() => {
    const rng = createRng(hashSeed('dashes'));
    return Array.from({ length: count }, () => ({
      x: range(rng, -70, 70),
      y: range(rng, 13, 38),
      z: range(rng, -60, -22),
      speed: range(rng, 0.25, 1.1) * (rng() < 0.5 ? 1 : -1),
      len: range(rng, 0.3, 1.4),
      tint: rng(),
    }));
  }, [count]);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
    [],
  );
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      if (!reduced) it.x += it.speed * dt;
      if (it.x > 72) it.x = -72;
      if (it.x < -72) it.x = 72;
      m.makeScale(it.len, 0.06, 1);
      m.setPosition(it.x, it.y, it.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={(mesh) => {
        ref.current = mesh;
        if (!mesh) return;
        items.forEach((it, i) =>
          mesh.setColorAt(i, it.tint < 0.6 ? hdr('#c9b8ff', 1.1) : it.tint < 0.85 ? hdr('#7ff6ff', 1.2) : hdr('#ff6ab0', 1.1)),
        );
      }}
      args={[undefined, material, count]}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    >
      <planeGeometry args={[1, 1]} />
    </instancedMesh>
  );
}
