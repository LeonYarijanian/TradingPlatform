import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getUi } from '../app/uiStore';
import { rectFrameGeometry } from './geometryUtils';
import { hdr, PALETTE } from './palette';
import { towerFx } from './towerFx';
import { NO_RAYCAST } from './WindowsMesh';

const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Arm rest pose (hands at the keyboard) and FIRE pose (victory V, arms up).
 * shoulderZ is the outward tilt for an arm hanging down; it flips sign once the
 * arm is raised, so the raised pose uses a negative value.
 */
const REST = { shoulderX: 1.15, shoulderZ: 0.08, elbowX: 0.5 };
const FIRE = { shoulderX: 2.78, shoulderZ: -0.68, elbowX: 0.18 };

interface ArmRefs {
  outer: THREE.Group | null;
  inner: THREE.Group | null;
  elbow: THREE.Group | null;
}

/**
 * Stylized low-poly robot: glossy mint sphere head, black headset ear modules,
 * antenna with a glowing ball, dark torso with a mint stripe, segmented arms.
 * Faces -z (toward the monitors).
 */
export function RobotWorker({ position = [-0.14, 0, 0.18] as [number, number, number] }) {
  const mats = useMemo(
    () => ({
      shell: new THREE.MeshPhysicalMaterial({
        color: '#a9ffe9',
        emissive: new THREE.Color('#2fbf9c'),
        emissiveIntensity: 0.32,
        roughness: 0.22,
        metalness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        sheen: 0.4,
        sheenColor: new THREE.Color('#d8fff6'),
      }),
      limb: new THREE.MeshPhysicalMaterial({
        color: '#c8fff1',
        emissive: new THREE.Color('#2fbf9c'),
        emissiveIntensity: 0.22,
        roughness: 0.3,
        metalness: 0.1,
        clearcoat: 0.7,
      }),
      dark: new THREE.MeshStandardMaterial({ color: '#07070f', roughness: 0.45, metalness: 0.55 }),
      joint: new THREE.MeshStandardMaterial({ color: '#0b0b14', roughness: 0.35, metalness: 0.7 }),
      glow: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.mint, 2.6) }),
      glowSoft: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.mint, 1.4) }),
      antenna: new THREE.MeshBasicMaterial({ color: hdr('#eafffa', 3) }),
      visor: new THREE.MeshStandardMaterial({ color: '#05060c', roughness: 0.15, metalness: 0.9 }),
      chair: new THREE.MeshStandardMaterial({ color: '#050509', roughness: 0.6, metalness: 0.4 }),
      chairEdge: new THREE.MeshBasicMaterial({ color: hdr('#4b2bff', 1.6) }),
    }),
    [],
  );

  const chairFrame = useMemo(() => rectFrameGeometry(0.52, 0.76, 0.075, 0.07), []);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const antennaRef = useRef<THREE.Mesh>(null);
  const arms = useRef<{ left: ArmRefs; right: ArmRefs }>({
    left: { outer: null, inner: null, elbow: null },
    right: { outer: null, inner: null, elbow: null },
  });
  const state = useRef({ armsUp: 0, yaw: 0, pitch: 0, lastFireSeq: -1, celebrate: 99 });

  useFrame((frame, rawDt) => {
    const ui = getUi();
    if (ui.scene !== 'station') return;
    const dt = Math.min(rawDt, 0.1);
    const t = frame.clock.elapsedTime;
    const fx = towerFx[ui.stationWorkerId];
    const s = state.current;
    const reduced = ui.reducedMotion;

    // A new FIRE (for the worker on screen) kicks off the celebration.
    if (fx.fireSeq !== s.lastFireSeq) {
      if (s.lastFireSeq >= 0 && fx.fireAge < 0.5) s.celebrate = 0;
      s.lastFireSeq = fx.fireSeq;
    }
    s.celebrate += dt;
    const c = s.celebrate;
    const target = c < 0.22 ? smooth(c / 0.22) : c < 1.05 ? 1 : c < 1.6 ? 1 - smooth((c - 1.05) / 0.55) : 0;
    s.armsUp = damp(s.armsUp, target, 22, dt);

    const charging = fx.status === 'charging' || fx.status === 'ready';
    const inTrade = fx.status === 'managing' || fx.status === 'trailing' || fx.status === 'firing';

    // Head: glance at the scanner while charging, otherwise follow the chart.
    const yawTarget = charging
      ? 0.42 + 0.04 * Math.sin(t * 1.3)
      : inTrade
        ? -0.05 + 0.06 * Math.sin(t * 0.8)
        : 0.05 * Math.sin(t * 0.37) - 0.04;
    const pitchTarget = s.armsUp > 0.3 ? -0.25 : charging ? 0.12 : 0.05 + 0.04 * Math.sin(t * 0.6);
    s.yaw = damp(s.yaw, yawTarget, 3.2, dt);
    s.pitch = damp(s.pitch, pitchTarget, 3.2, dt);
    if (headRef.current) {
      headRef.current.rotation.set(s.pitch, s.yaw, reduced ? 0 : 0.03 * Math.sin(t * 0.9) * (1 - s.armsUp));
      headRef.current.position.y = 0.6 + (reduced ? 0 : 0.008 * Math.sin(t * 2.1)) + s.armsUp * 0.02;
    }

    // Breathing / lean.
    if (torsoRef.current) {
      const breathe = reduced ? 0 : Math.sin(t * 2.0);
      torsoRef.current.scale.set(1 + breathe * 0.006, 1 + breathe * 0.012, 1 + breathe * 0.006);
      const lean = charging ? 0.1 + fx.charge * 0.1 : inTrade ? 0.06 : 0.03;
      torsoRef.current.rotation.x = damp(torsoRef.current.rotation.x, lean - s.armsUp * 0.12, 4, dt);
      torsoRef.current.rotation.z = reduced ? 0 : 0.015 * Math.sin(t * 0.7);
    }

    // Arms.
    (['left', 'right'] as const).forEach((side, i) => {
      const a = arms.current[side];
      const sign = side === 'left' ? -1 : 1;
      const typing = charging && !reduced ? 0.07 * Math.sin(t * 17 + i * Math.PI) * (1 - s.armsUp) : 0;
      const wave = !reduced ? -0.06 * Math.sin(t * 9 + i) * s.armsUp : 0;
      if (a.inner) a.inner.rotation.x = THREE.MathUtils.lerp(REST.shoulderX, FIRE.shoulderX, s.armsUp) + typing * 0.4;
      if (a.outer) a.outer.rotation.z = sign * THREE.MathUtils.lerp(REST.shoulderZ, FIRE.shoulderZ + wave, s.armsUp);
      if (a.elbow) a.elbow.rotation.x = THREE.MathUtils.lerp(REST.elbowX, FIRE.elbowX, s.armsUp) + typing;
    });

    // Antenna light flashes on fire; pulses while charging.
    const flash = c < 1.2 ? 1 - c / 1.2 : 0;
    const pulse = charging ? 0.5 + 0.5 * Math.sin(t * (4 + fx.charge * 10)) : 0.3 + 0.2 * Math.sin(t * 1.5);
    const color = fx.color;
    mats.antenna.color
      .setRGB(1, 1, 1)
      .lerp(color, charging || flash > 0 ? 0.55 : 0.15)
      .multiplyScalar(2 + pulse * 1.5 + flash * 6);
    if (antennaRef.current) antennaRef.current.scale.setScalar(0.034 * (1 + flash * 0.8));
    mats.glow.color.set(PALETTE.mint).multiplyScalar(2.2 + flash * 3 + pulse * 0.6);
  });

  const renderArm = (side: 'left' | 'right') => {
    const sx = side === 'left' ? -0.265 : 0.265;
    const refs = arms.current[side];
    return (
      <group position={[sx, 0.47, 0]} ref={(g) => void (refs.outer = g)}>
        <group ref={(g) => void (refs.inner = g)} rotation={[REST.shoulderX, 0, 0]}>
          <mesh material={mats.joint} raycast={NO_RAYCAST}>
            <sphereGeometry args={[0.068, 20, 14]} />
          </mesh>
          <mesh material={mats.limb} position={[0, -0.155, 0]} raycast={NO_RAYCAST}>
            <cylinderGeometry args={[0.046, 0.042, 0.27, 14]} />
          </mesh>
          <mesh material={mats.glowSoft} position={[0, -0.155, 0]} raycast={NO_RAYCAST}>
            <cylinderGeometry args={[0.0475, 0.0475, 0.012, 14]} />
          </mesh>
          <group position={[0, -0.31, 0]} ref={(g) => void (refs.elbow = g)} rotation={[REST.elbowX, 0, 0]}>
            <mesh material={mats.joint} raycast={NO_RAYCAST}>
              <sphereGeometry args={[0.056, 18, 12]} />
            </mesh>
            <mesh material={mats.limb} position={[0, -0.14, 0]} raycast={NO_RAYCAST}>
              <cylinderGeometry args={[0.04, 0.036, 0.24, 14]} />
            </mesh>
            <group position={[0, -0.29, 0]}>
              <mesh material={mats.limb} scale={[1, 0.85, 1.15]} raycast={NO_RAYCAST}>
                <sphereGeometry args={[0.058, 18, 12]} />
              </mesh>
              {/* Simple claw fingers */}
              <mesh material={mats.joint} position={[-0.024, -0.05, -0.012]} rotation={[0.2, 0, 0.15]} raycast={NO_RAYCAST}>
                <boxGeometry args={[0.018, 0.05, 0.022]} />
              </mesh>
              <mesh material={mats.joint} position={[0.024, -0.05, -0.012]} rotation={[0.2, 0, -0.15]} raycast={NO_RAYCAST}>
                <boxGeometry args={[0.018, 0.05, 0.022]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    );
  };

  return (
    <group position={position}>
      {/* Chair */}
      <group>
        <mesh material={mats.chair} position={[0, 0.47, 0.02]} raycast={NO_RAYCAST}>
          <boxGeometry args={[0.56, 0.08, 0.52]} />
        </mesh>
        {/* High rectangular back as an open frame, so the torso stripe reads through it */}
        <group position={[0, 0.88, 0.33]} rotation={[-0.08, 0, 0]}>
          <mesh geometry={chairFrame} material={mats.chair} raycast={NO_RAYCAST} />
          <mesh material={mats.chairEdge} position={[0, 0.39, 0.0]} raycast={NO_RAYCAST}>
            <boxGeometry args={[0.6, 0.012, 0.075]} />
          </mesh>
          <mesh material={mats.chair} position={[0, -0.22, 0]} raycast={NO_RAYCAST}>
            <boxGeometry args={[0.5, 0.2, 0.05]} />
          </mesh>
        </group>
        <mesh material={mats.chair} position={[0, 0.24, 0.02]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.035, 0.035, 0.42, 10]} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh
              key={i}
              material={mats.chair}
              position={[Math.sin(a) * 0.17, 0.035, 0.02 + Math.cos(a) * 0.17]}
              rotation={[0, a, 0]}
              raycast={NO_RAYCAST}
            >
              <boxGeometry args={[0.04, 0.03, 0.34]} />
            </mesh>
          );
        })}
      </group>

      {/* Legs (seated) */}
      {[-0.11, 0.11].map((x) => (
        <group key={x}>
          <mesh material={mats.dark} position={[x, 0.55, -0.12]} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
            <cylinderGeometry args={[0.06, 0.055, 0.34, 12]} />
          </mesh>
          <mesh material={mats.joint} position={[x, 0.55, -0.3]} raycast={NO_RAYCAST}>
            <sphereGeometry args={[0.06, 14, 10]} />
          </mesh>
          <mesh material={mats.limb} position={[x, 0.3, -0.31]} raycast={NO_RAYCAST}>
            <cylinderGeometry args={[0.045, 0.04, 0.44, 12]} />
          </mesh>
          <mesh material={mats.dark} position={[x, 0.05, -0.35]} raycast={NO_RAYCAST}>
            <boxGeometry args={[0.09, 0.06, 0.16]} />
          </mesh>
        </group>
      ))}

      {/* Upper body pivots at the hips */}
      <group ref={torsoRef} position={[0, 0.54, 0.04]}>
        <mesh material={mats.dark} position={[0, 0.27, 0]} raycast={NO_RAYCAST}>
          <boxGeometry args={[0.44, 0.5, 0.28]} />
        </mesh>
        {/* Mint stripe down the back and front */}
        <mesh material={mats.glow} position={[0, 0.28, 0.142]} raycast={NO_RAYCAST}>
          <boxGeometry args={[0.04, 0.42, 0.006]} />
        </mesh>
        <mesh material={mats.glow} position={[0, 0.28, -0.142]} raycast={NO_RAYCAST}>
          <boxGeometry args={[0.03, 0.36, 0.006]} />
        </mesh>
        {[0.42, 0.36].map((y) => (
          <mesh key={y} material={mats.glowSoft} position={[0, y, -0.142]} raycast={NO_RAYCAST}>
            <boxGeometry args={[0.3, 0.008, 0.006]} />
          </mesh>
        ))}
        <mesh material={mats.joint} position={[0, 0.03, 0]} raycast={NO_RAYCAST}>
          <boxGeometry args={[0.4, 0.08, 0.26]} />
        </mesh>
        {/* Neck */}
        <mesh material={mats.joint} position={[0, 0.56, 0]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.055, 0.07, 0.1, 14]} />
        </mesh>

        {/* Head */}
        <group ref={headRef} position={[0, 0.6, 0]}>
          <mesh material={mats.shell} position={[0, 0.25, 0]} scale={[1, 0.94, 1]} raycast={NO_RAYCAST}>
            <sphereGeometry args={[0.27, 48, 32]} />
          </mesh>
          {/* Visor + eyes (front) */}
          <mesh material={mats.visor} position={[0, 0.26, -0.03]} scale={[1, 0.62, 1]} raycast={NO_RAYCAST}>
            <sphereGeometry args={[0.262, 32, 16, Math.PI * 1.17, Math.PI * 0.66, Math.PI * 0.32, Math.PI * 0.36]} />
          </mesh>
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} material={mats.glow} position={[x, 0.27, -0.29]} raycast={NO_RAYCAST}>
              <sphereGeometry args={[0.022, 12, 8]} />
            </mesh>
          ))}
          {/* Headset ear modules */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.265, 0.24, 0]} rotation={[0, 0, Math.PI / 2]}>
              <mesh material={mats.dark} raycast={NO_RAYCAST}>
                <cylinderGeometry args={[0.1, 0.1, 0.075, 28]} />
              </mesh>
              <mesh material={mats.glow} position={[0, -s * 0.039, 0]} raycast={NO_RAYCAST}>
                <cylinderGeometry args={[0.058, 0.058, 0.004, 28]} />
              </mesh>
              <mesh material={mats.joint} position={[0, -s * 0.041, 0]} raycast={NO_RAYCAST}>
                <cylinderGeometry args={[0.03, 0.03, 0.004, 20]} />
              </mesh>
            </group>
          ))}
          {/* Headset band */}
          <mesh material={mats.dark} position={[0, 0.27, 0]} rotation={[0, Math.PI / 2, 0]} raycast={NO_RAYCAST}>
            <torusGeometry args={[0.275, 0.014, 8, 40, Math.PI]} />
          </mesh>
          {/* Antenna */}
          <mesh material={mats.joint} position={[0, 0.6, 0]} raycast={NO_RAYCAST}>
            <cylinderGeometry args={[0.007, 0.01, 0.2, 8]} />
          </mesh>
          <mesh ref={antennaRef} material={mats.antenna} position={[0, 0.71, 0]} scale={0.034} raycast={NO_RAYCAST}>
            <sphereGeometry args={[1, 16, 12]} />
          </mesh>
        </group>

        {renderArm('left')}
        {renderArm('right')}
      </group>
    </group>
  );
}
