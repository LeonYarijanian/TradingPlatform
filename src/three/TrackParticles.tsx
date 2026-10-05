import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useUi } from '../app/uiStore';
import { usePlayback } from '../simulation/simulationStore';
import { hdr } from './palette';
import { TRACK } from './layout';
import { NO_RAYCAST } from './WindowsMesh';

const COUNT = 30;

/** Bright rectangular packets gliding clockwise around the rail. */
export function TrackParticles({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const reduced = useUi((s) => s.reducedMotion);
  const offsets = useMemo(() => {
    // Little "trains": clusters of 1–3 cars.
    const list: Array<{ u: number; len: number; tint: number }> = [];
    let u = 0;
    while (list.length < COUNT) {
      const cars = 1 + Math.floor(Math.random() * 3);
      for (let c = 0; c < cars && list.length < COUNT; c++) {
        list.push({ u: u + c * 0.0075, len: 0.22 + Math.random() * 0.12, tint: Math.random() });
      }
      u += 1 / 13 + Math.random() * 0.03;
    }
    return list;
  }, []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  const travel = useRef(0);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    // Traffic speeds up a little when the simulation runs faster.
    const speed = usePlayback.getState().effectiveSpeed;
    travel.current += dt * (reduced ? 0.008 : 0.022 * Math.min(3, 0.8 + Math.sqrt(speed) * 0.35));
    offsets.forEach((o, i) => {
      const u = (((o.u + travel.current) % 1) + 1) % 1;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, tan);
      q.setFromAxisAngle(up, Math.atan2(tan.x, tan.z));
      p.y = TRACK.y + 0.04;
      s.set(0.07, 0.05, o.len);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={(mesh) => {
        ref.current = mesh;
        if (mesh) {
          offsets.forEach((o, i) => mesh.setColorAt(i, o.tint < 0.75 ? hdr('#ffffff', 3.2) : hdr('#7ff6ff', 2.6)));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }}
      args={[geometry, material, COUNT]}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    />
  );
}
