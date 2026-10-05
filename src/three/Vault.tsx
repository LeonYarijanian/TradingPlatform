import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { openSummary } from '../app/actions';
import { takeManualControl } from '../app/transitions';
import { getUi } from '../app/uiStore';
import { getSim } from '../simulation/simulationStore';
import { VaultLabel } from '../ui/VaultLabel';
import { GEOMETRIES, MATERIALS } from './materials';
import { hdr, PALETTE } from './palette';
import { PLAZA_RADIUS, VAULT_BASE_HEIGHT, VAULT_DOME_RADIUS, VAULT_POS, VAULT_WALL_HEIGHT, VAULT_WALL_RADIUS } from './layout';
import { NO_RAYCAST } from './WindowsMesh';

const PANELS = 20;
const DOME_BASE = new THREE.Color('#fff6e8');

/** Module-level pulse the flow packets bump when profit lands. */
export const vaultPulse = { value: 0 };

/** The treasury: warm gold wall segments under an intensely glowing white dome. */
export function Vault({ showLabel }: { showLabel: boolean }) {
  const [vx, , vz] = VAULT_POS;
  const wallTop = VAULT_BASE_HEIGHT + VAULT_WALL_HEIGHT;

  const mats = useMemo(
    () => ({
      dome: new THREE.MeshBasicMaterial({ color: hdr('#fff8ee', 3.2) }),
      halo: new THREE.MeshBasicMaterial({
        color: hdr('#ffd9a0', 0.5),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      panel: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.orange, 2.1) }),
      panelDim: new THREE.MeshBasicMaterial({ color: hdr('#ff8a1f', 1.1) }),
      trim: new THREE.MeshBasicMaterial({ color: hdr('#ffffff', 2.6) }),
      plazaRing: new THREE.MeshBasicMaterial({ color: hdr('#e9ecff', 2.2) }),
      plazaInner: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.cyan, 1.1) }),
      wall: new THREE.MeshStandardMaterial({
        color: '#1a0c08',
        roughness: 0.6,
        metalness: 0.3,
        emissive: '#3a1a05',
        emissiveIntensity: 0.6,
      }),
      plaza: new THREE.MeshStandardMaterial({ color: '#0a0920', roughness: 0.45, metalness: 0.5 }),
    }),
    [],
  );

  const geo = useMemo(() => {
    const panel = new THREE.BoxGeometry(0.13, VAULT_WALL_HEIGHT * 0.78, 0.04);
    const panels: THREE.Matrix4[] = [];
    for (let i = 0; i < PANELS; i++) {
      const a = (i / PANELS) * Math.PI * 2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(
          Math.sin(a) * (VAULT_WALL_RADIUS + 0.015),
          VAULT_BASE_HEIGHT + VAULT_WALL_HEIGHT / 2,
          Math.cos(a) * (VAULT_WALL_RADIUS + 0.015),
        ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a),
        new THREE.Vector3(1, 1, 1),
      );
      panels.push(m);
    }
    return {
      panel,
      panels,
      dome: new THREE.SphereGeometry(VAULT_DOME_RADIUS, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      halo: new THREE.SphereGeometry(VAULT_DOME_RADIUS * 1.35, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      wall: new THREE.CylinderGeometry(VAULT_WALL_RADIUS, VAULT_WALL_RADIUS, VAULT_WALL_HEIGHT, 48, 1),
      base: new THREE.CylinderGeometry(VAULT_WALL_RADIUS + 0.28, VAULT_WALL_RADIUS + 0.36, VAULT_BASE_HEIGHT, 48, 1),
      plaza: new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS + 0.08, 0.1, 64, 1),
      trimTop: new THREE.TorusGeometry(VAULT_WALL_RADIUS + 0.03, 0.035, 8, 96),
      trimLow: new THREE.TorusGeometry(VAULT_WALL_RADIUS + 0.03, 0.022, 8, 96),
      plazaRing: new THREE.TorusGeometry(PLAZA_RADIUS, 0.035, 6, 160),
      plazaInner: new THREE.TorusGeometry(PLAZA_RADIUS - 0.45, 0.014, 6, 160),
    };
  }, []);

  const panelRef = useRef<THREE.InstancedMesh>(null);
  const lastSeq = useRef(0);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state, dt) => {
    const sim = getSim();
    if (sim.vaultSeq !== lastSeq.current) {
      if (sim.vaultSeq > lastSeq.current && sim.lastDeposit && sim.lastDeposit.amount > 0)
        vaultPulse.value = Math.min(1.5, vaultPulse.value + 0.35);
      lastSeq.current = sim.vaultSeq;
    }
    vaultPulse.value = Math.max(0, vaultPulse.value - dt * 1.6);
    const p = vaultPulse.value;
    const breathe = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 1.4);
    mats.dome.color.copy(DOME_BASE).multiplyScalar(3.0 + p * 2.5 + breathe * 0.25);
    mats.halo.opacity = 0.22 + p * 0.35 + breathe * 0.05;
    mats.plazaRing.color.setRGB(2.1 + p, 2.15 + p * 1.6, 2.3 + p);
    if (lightRef.current) lightRef.current.intensity = 22 + p * 30;
  });

  const onClick = () => {
    if (getUi().scene !== 'city') return;
    takeManualControl();
    openSummary();
  };

  return (
    <group position={[vx, 0, vz]}>
      <mesh geometry={geo.plaza} material={mats.plaza} position={[0, 0.05, 0]} raycast={NO_RAYCAST} />
      <mesh
        geometry={geo.plazaRing}
        material={mats.plazaRing}
        position={[0, 0.11, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        raycast={NO_RAYCAST}
      />
      <mesh
        geometry={geo.plazaInner}
        material={mats.plazaInner}
        position={[0, 0.11, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        raycast={NO_RAYCAST}
      />
      <mesh geometry={geo.base} material={MATERIALS.platform} position={[0, 0.1 + VAULT_BASE_HEIGHT / 2, 0]} raycast={NO_RAYCAST} />
      <group position={[0, 0.1, 0]}>
        <mesh geometry={geo.wall} material={mats.wall} position={[0, VAULT_BASE_HEIGHT + VAULT_WALL_HEIGHT / 2, 0]} raycast={NO_RAYCAST} />
        <instancedMesh
          ref={(m) => {
            panelRef.current = m;
            if (m) {
              geo.panels.forEach((mat, i) => m.setMatrixAt(i, mat));
              m.instanceMatrix.needsUpdate = true;
            }
          }}
          args={[geo.panel, mats.panel, PANELS]}
          raycast={NO_RAYCAST}
        />
        <mesh geometry={geo.trimTop} material={mats.trim} position={[0, wallTop, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST} />
        <mesh
          geometry={geo.trimLow}
          material={mats.trim}
          position={[0, VAULT_BASE_HEIGHT + 0.03, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          raycast={NO_RAYCAST}
        />
        <mesh geometry={geo.dome} material={mats.dome} position={[0, wallTop, 0]} raycast={NO_RAYCAST} />
        <mesh geometry={geo.halo} material={mats.halo} position={[0, wallTop - 0.02, 0]} raycast={NO_RAYCAST} />
        <mesh
          geometry={GEOMETRIES.sphere}
          material={mats.trim}
          position={[0, wallTop + VAULT_DOME_RADIUS + 0.06, 0]}
          scale={0.07}
          raycast={NO_RAYCAST}
        />
      </group>
      <pointLight ref={lightRef} position={[0, 1.6, 0.4]} color={PALETTE.orange} intensity={22} distance={10} decay={2} />

      {/* Click target */}
      <mesh
        position={[0, 0.9, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={() => {
          if (getUi().scene === 'city') document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <cylinderGeometry args={[1.5, 1.5, 1.9, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {showLabel && (
        <Html position={[0, 2.75, -0.2]} center zIndexRange={[16, 8]}>
          <VaultLabel />
        </Html>
      )}
    </group>
  );
}
