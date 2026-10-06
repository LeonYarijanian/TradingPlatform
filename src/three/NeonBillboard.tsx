import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useUi } from '../app/uiStore';
import { FONT_DISPLAY } from './fonts';
import { rectFrameGeometry } from './geometryUtils';
import { SafeText } from './SafeText';
import { NO_RAYCAST } from './WindowsMesh';

interface Props {
  text: string;
  color: string;
  position: [number, number, number];
  rotationY?: number;
  width: number;
  height: number;
  /** Occasional neon flicker. */
  flicker?: boolean;
}

/** Floating strategy sign: dark panel, neon outline, bold light text, thin mount. */
export function NeonBillboard({ text, color, position, rotationY = 0, width, height, flicker = false }: Props) {
  const reduced = useUi((s) => s.reducedMotion);
  const mats = useMemo(
    () => ({
      panel: new THREE.MeshBasicMaterial({ color: '#030209', fog: false }),
      border: new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6), fog: false }),
      inner: new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(0.9),
        transparent: true,
        opacity: 0.5,
        fog: false,
      }),
      text: new THREE.MeshBasicMaterial({ color: new THREE.Color('#f6f4ff').multiplyScalar(1.55), fog: false }),
      pole: new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), fog: false }),
      glow: new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(0.3),
        transparent: true,
        opacity: 0.3,
        fog: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    }),
    [color],
  );
  const geo = useMemo(
    () => ({
      border: rectFrameGeometry(width, height, 0.055, 0.04),
      inner: rectFrameGeometry(width - 0.3, height - 0.3, 0.025, 0.02),
    }),
    [width, height],
  );
  const base = useMemo(() => new THREE.Color(color).multiplyScalar(2.6), [color]);

  useFrame((state) => {
    if (!flicker || reduced) return;
    const t = state.clock.elapsedTime;
    const glitch = Math.sin(t * 0.7) > 0.985 || (Math.sin(t * 13.0) > 0.6 && Math.sin(t * 0.31) > 0.97);
    mats.border.color.copy(base).multiplyScalar(glitch ? 0.25 : 1);
  });

  const poleHeight = position[1] - height / 2;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh material={mats.glow} position={[0, 0, -0.06]} scale={[width * 1.12, height * 1.3, 1]} raycast={NO_RAYCAST}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh material={mats.panel} scale={[width, height, 1]} raycast={NO_RAYCAST}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh geometry={geo.border} material={mats.border} raycast={NO_RAYCAST} />
      <mesh geometry={geo.inner} material={mats.inner} position={[0, 0, 0.01]} raycast={NO_RAYCAST} />
      <SafeText
        font={FONT_DISPLAY}
        fontSize={height * 0.5}
        letterSpacing={0.04}
        anchorX="center"
        anchorY="middle"
        position={[0, -height * 0.02, 0.03]}
        material={mats.text}
        maxWidth={width * 0.95}
        raycast={NO_RAYCAST}
      >
        {text}
      </SafeText>
      {/* Thin vertical mounting pole */}
      <mesh material={mats.pole} position={[0, -height / 2 - poleHeight / 2, -0.05]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.04, poleHeight, 0.04]} />
      </mesh>
    </group>
  );
}

export const BILLBOARDS: Props[] = [
  { text: '0DTE', color: '#FF267A', position: [-16.8, 12.4, -23], rotationY: 0.36, width: 5.4, height: 2.25, flicker: true },
  { text: 'BUY THE DIP', color: '#63FF9A', position: [-7.6, 15.6, -30], rotationY: 0.14, width: 9.2, height: 2.05 },
  { text: 'VWAP', color: '#47F4FF', position: [8.6, 15.2, -30], rotationY: -0.14, width: 5.6, height: 2.05 },
  { text: 'THETA GANG', color: '#FFD247', position: [17.4, 11.8, -23], rotationY: -0.36, width: 9.4, height: 2.2, flicker: true },
];
