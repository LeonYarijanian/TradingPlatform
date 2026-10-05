import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { WORKERS } from '../data/workers';
import { getSim } from '../simulation/simulationStore';
import type { WorkerId } from '../types/trading';
import { GEOMETRIES, MATERIALS } from './materials';
import { hdr, PALETTE } from './palette';
import { PLAZA_RADIUS, VAULT_BASE_HEIGHT, VAULT_DOME_RADIUS, VAULT_POS, VAULT_WALL_HEIGHT } from './layout';
import { createFlowMaterial, createGridMaterial } from './shaders';
import { TOWER_DESIGNS } from './towerDesign';
import { vaultPulse } from './Vault';
import { NO_RAYCAST } from './WindowsMesh';

/** Ground plane with a faint neon grid. */
export function Ground() {
  const material = useMemo(() => createGridMaterial({ color: '#4a2bd8', base: '#04031a', scale: 1, fade: 60, lineWidth: 0.9 }), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} material={material} raycast={NO_RAYCAST}>
      <planeGeometry args={[420, 420]} />
    </mesh>
  );
}

/** Glowing feeder paths from each worker's block into the vault plaza. */
export function VaultPaths() {
  const items = useMemo(() => {
    return WORKERS.map((w) => {
      const d = TOWER_DESIGNS[w.id];
      const [x, , z] = w.position;
      const start = new THREE.Vector3(x, 0.02, z + d.platformSize / 2 + 0.1);
      const dir = new THREE.Vector3(VAULT_POS[0] - start.x, 0, VAULT_POS[2] - start.z);
      const len = dir.length() - PLAZA_RADIUS - 0.05;
      dir.normalize();
      const mid = start.clone().addScaledVector(dir, len / 2);
      const angle = Math.atan2(dir.x, dir.z);
      const material = createFlowMaterial(PALETTE.cyan);
      return { id: w.id, mid, len, angle, material };
    });
  }, []);
  const last = useRef<Record<string, number>>({});
  const boost = useRef<Record<string, number>>({});

  useFrame((state, dt) => {
    const sim = getSim();
    for (const item of items) {
      const seq = sim.fx[item.id].closeSeq;
      if (seq !== last.current[item.id]) {
        if (seq > (last.current[item.id] ?? 0) && sim.fx[item.id].lastPnl > 0) boost.current[item.id] = 1;
        last.current[item.id] = seq;
      }
      const b = Math.max(0, (boost.current[item.id] ?? 0) - dt * 0.9);
      boost.current[item.id] = b;
      item.material.uniforms.uTime.value = state.clock.elapsedTime * (1 + b * 3);
      item.material.uniforms.uBoost.value = b;
      item.material.uniforms.uColor.value.set(b > 0.05 ? PALETTE.green : PALETTE.cyan);
    }
  });

  return (
    <group>
      {items.map((it) => (
        <mesh
          key={it.id}
          position={it.mid}
          rotation={[-Math.PI / 2, 0, it.angle - Math.PI / 2]}
          material={it.material}
          raycast={NO_RAYCAST}
        >
          <planeGeometry args={[it.len, 0.09]} />
        </mesh>
      ))}
    </group>
  );
}

/** Every stylized cyan cone tree in the city, one instanced draw call. */
export function CityTrees() {
  const matrices = useMemo(() => {
    const list: Array<[number, number, number, number]> = [];
    for (const w of WORKERS) list.push(...TOWER_DESIGNS[w.id].trees);
    const [vx, , vz] = VAULT_POS;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + 0.2;
      const r = PLAZA_RADIUS - 0.42 + (i % 2) * 0.12;
      list.push([vx + Math.sin(a) * r, 0.1, vz + Math.cos(a) * r, 0.3 + (i % 3) * 0.05]);
    }
    // Scattered "city island" trees in the open ground.
    const scatter: Array<[number, number]> = [
      [-10.5, 4],
      [-9.2, 6.2],
      [10.2, 4.4],
      [9.4, 6.6],
      [-5.6, 6.5],
      [5.8, 6.9],
      [-12.8, -1.5],
      [12.6, -1.2],
      [-3.4, 8.6],
      [3.6, 8.9],
    ];
    scatter.forEach(([x, z], i) => list.push([x, 0, z, 0.32 + (i % 3) * 0.08]));
    const m = new THREE.Matrix4();
    return list.map(([x, y, z, s]) => {
      const h = s * 2.2;
      return m.clone().compose(new THREE.Vector3(x, y + h / 2 + 0.05, z), new THREE.Quaternion(), new THREE.Vector3(s, h, s));
    });
  }, []);

  return (
    <instancedMesh
      args={[GEOMETRIES.cone, MATERIALS.tree, matrices.length]}
      raycast={NO_RAYCAST}
      ref={(mesh) => {
        if (!mesh) return;
        matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
        mesh.instanceMatrix.needsUpdate = true;
      }}
    />
  );
}

interface Packet {
  active: boolean;
  age: number;
  from: THREE.Vector3;
  ctrl: THREE.Vector3;
  to: THREE.Vector3;
  amount: number;
}

const POOL = 14;
const FLIGHT = 1.15;

/** Profit packets that arc from a tower into the vault when a trade closes green. */
export function VaultFlows() {
  const packets = useMemo<Packet[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        active: false,
        age: 0,
        from: new THREE.Vector3(),
        ctrl: new THREE.Vector3(),
        to: new THREE.Vector3(),
        amount: 0,
      })),
    [],
  );
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const trailRefs = useRef<Array<THREE.Mesh | null>>([]);
  const last = useRef<Partial<Record<WorkerId, number>>>({});
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: hdr(PALETTE.green, 3.5) }), []);
  const trailMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: hdr(PALETTE.green, 1.6),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const target = useMemo(
    () => new THREE.Vector3(VAULT_POS[0], 0.1 + VAULT_BASE_HEIGHT + VAULT_WALL_HEIGHT + VAULT_DOME_RADIUS * 0.7, VAULT_POS[2]),
    [],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const tmp2 = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const sim = getSim();
    for (const w of WORKERS) {
      const seq = sim.fx[w.id].closeSeq;
      const prev = last.current[w.id] ?? seq;
      last.current[w.id] = seq;
      if (seq > prev && sim.fx[w.id].lastPnl > 0) {
        const p = packets.find((k) => !k.active) ?? packets[0];
        const d = TOWER_DESIGNS[w.id];
        p.active = true;
        p.age = 0;
        p.amount = sim.fx[w.id].lastPnl;
        p.from.set(w.position[0], d.podium.y + d.podium.h + 0.4, w.position[2] + d.podium.d / 2);
        p.to.copy(target);
        p.ctrl.set((p.from.x + p.to.x) / 2, Math.max(p.from.y, p.to.y) + 3.2, (p.from.z + p.to.z) / 2);
      }
    }
    packets.forEach((p, i) => {
      const mesh = refs.current[i];
      const trail = trailRefs.current[i];
      if (!mesh || !trail) return;
      if (!p.active) {
        mesh.visible = false;
        trail.visible = false;
        return;
      }
      p.age += dt;
      const k = Math.min(1, p.age / FLIGHT);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const bez = (t: number, out: THREE.Vector3) =>
        out
          .copy(p.from)
          .multiplyScalar((1 - t) * (1 - t))
          .addScaledVector(p.ctrl, 2 * (1 - t) * t)
          .addScaledVector(p.to, t * t);
      bez(e, tmp);
      bez(Math.max(0, e - 0.08), tmp2);
      mesh.visible = true;
      mesh.position.copy(tmp);
      const size = 0.08 + Math.min(0.1, p.amount / 9000);
      mesh.scale.setScalar(size * (1 - k * 0.3));
      trail.visible = true;
      trail.position.copy(tmp).add(tmp2).multiplyScalar(0.5);
      trail.lookAt(tmp);
      trail.scale.set(size * 0.6, size * 0.6, Math.max(0.01, tmp.distanceTo(tmp2)));
      if (k >= 1) {
        p.active = false;
        vaultPulse.value = Math.min(1.6, vaultPulse.value + 0.4);
      }
    });
  });

  return (
    <group>
      {packets.map((_, i) => (
        <mesh
          key={`p${i}`}
          ref={(m) => {
            refs.current[i] = m;
          }}
          geometry={GEOMETRIES.octa}
          material={material}
          visible={false}
          raycast={NO_RAYCAST}
        />
      ))}
      {packets.map((_, i) => (
        <mesh
          key={`t${i}`}
          ref={(m) => {
            trailRefs.current[i] = m;
          }}
          geometry={GEOMETRIES.box}
          material={trailMat}
          visible={false}
          raycast={NO_RAYCAST}
        />
      ))}
    </group>
  );
}
