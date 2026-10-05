import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getUi } from '../app/uiStore';
import { hdr, PALETTE } from './palette';
import { towerFx } from './towerFx';
import { NO_RAYCAST } from './WindowsMesh';

export const DESK = { y: 0.76, z: -0.58, width: 2.7, depth: 1.0, thickness: 0.06 } as const;

function noteTexture(lines: string[], rotate = 0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5ff1ff';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, 0, 256, 34);
  ctx.translate(128, 140);
  ctx.rotate(rotate);
  ctx.fillStyle = '#062a3a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 40px "Space Grotesk", sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * 48));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function keyboardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#031018';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#47f4ff';
  ctx.lineWidth = 2;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const cols = 13 - (r === 3 ? 4 : 0);
    const kw = 512 / 13.5;
    const offset = r === 3 ? kw * 2.5 : (r * kw) / 3;
    for (let k = 0; k < cols; k++) {
      const w = r === 3 && k === 3 ? kw * 4 : kw - 6;
      ctx.strokeRect(10 + offset + k * kw, 12 + r * 36, w, 28);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dark desk with neon underlighting, keyboard, sticky notes and the big red button. */
export function TradingDesk() {
  const mats = useMemo(
    () => ({
      top: new THREE.MeshStandardMaterial({ color: '#0a0a18', roughness: 0.85, metalness: 0.25 }),
      body: new THREE.MeshStandardMaterial({ color: '#07071a', roughness: 0.7, metalness: 0.35 }),
      under: new THREE.MeshBasicMaterial({ color: hdr('#6b3cff', 3.4) }),
      underBlue: new THREE.MeshBasicMaterial({ color: hdr('#2f6bff', 2.6) }),
      keyboard: new THREE.MeshBasicMaterial({ map: keyboardTexture(), color: new THREE.Color(1.6, 1.6, 1.6) }),
      note1: new THREE.MeshBasicMaterial({ map: noteTexture(['BUY THE', 'DIP'], -0.05), color: new THREE.Color(0.95, 0.95, 0.95) }),
      note2: new THREE.MeshBasicMaterial({ map: noteTexture(['NO', 'FOMO ✓'], 0.06), color: new THREE.Color(0.95, 0.95, 0.95) }),
      buttonBase: new THREE.MeshStandardMaterial({ color: '#0d0b14', roughness: 0.4, metalness: 0.7 }),
      buttonCap: new THREE.MeshStandardMaterial({
        color: '#ff2a5c',
        emissive: new THREE.Color('#ff1f5a'),
        emissiveIntensity: 1.2,
        roughness: 0.25,
        metalness: 0.1,
      }),
      buttonRing: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.magenta, 2.2) }),
      mug: new THREE.MeshStandardMaterial({ color: '#141032', roughness: 0.5, metalness: 0.2 }),
    }),
    [],
  );
  const capRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const fx = towerFx[getUi().stationWorkerId];
    const a = fx.fireAge;
    const hit = a < 0.9 ? Math.sin(Math.min(1, a / 0.9) * Math.PI) : 0;
    const armed = fx.status === 'ready' ? 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 12) : 0;
    mats.buttonCap.emissiveIntensity = 1.1 + hit * 5 + armed * 1.6 + fx.charge * 0.8;
    if (capRef.current) capRef.current.position.y = 0.045 - hit * 0.018;
  });

  const { y, z, width, depth, thickness } = DESK;
  const top = y + thickness / 2;

  return (
    <group>
      {/* Top + body */}
      <mesh material={mats.top} position={[0, y, z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[width, thickness, depth]} />
      </mesh>
      <mesh material={mats.body} position={[0, y / 2, z - depth / 2 + 0.05]} raycast={NO_RAYCAST}>
        <boxGeometry args={[width - 0.1, y - 0.03, 0.05]} />
      </mesh>
      <mesh material={mats.body} position={[-width / 2 + 0.06, y / 2, z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.06, y - 0.03, depth - 0.08]} />
      </mesh>
      <mesh material={mats.body} position={[width / 2 - 0.06, y / 2, z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.06, y - 0.03, depth - 0.08]} />
      </mesh>
      {/* Neon underlighting */}
      <mesh material={mats.under} position={[0, y - thickness / 2 - 0.008, z + depth / 2 - 0.02]} raycast={NO_RAYCAST}>
        <boxGeometry args={[width - 0.04, 0.012, 0.014]} />
      </mesh>
      <mesh material={mats.underBlue} position={[0, 0.012, z + depth / 2 - 0.25]} raycast={NO_RAYCAST}>
        <boxGeometry args={[width - 0.3, 0.01, 0.02]} />
      </mesh>
      <mesh material={mats.under} position={[0, y + thickness / 2 + 0.002, z - depth / 2 + 0.01]} raycast={NO_RAYCAST}>
        <boxGeometry args={[width - 0.02, 0.006, 0.01]} />
      </mesh>

      {/* Keyboard / input surface */}
      <mesh material={mats.keyboard} position={[0.08, top + 0.008, -0.34]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <planeGeometry args={[0.52, 0.16]} />
      </mesh>
      <mesh material={mats.body} position={[0.08, top + 0.003, -0.34]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.55, 0.008, 0.18]} />
      </mesh>

      {/* Sticky notes */}
      <mesh material={mats.note1} position={[-1.2, top + 0.002, -0.55]} rotation={[-Math.PI / 2, 0, 0.18]} raycast={NO_RAYCAST}>
        <planeGeometry args={[0.13, 0.13]} />
      </mesh>
      <mesh material={mats.note2} position={[0.55, top + 0.003, -0.22]} rotation={[-Math.PI / 2, 0, -0.12]} raycast={NO_RAYCAST}>
        <planeGeometry args={[0.12, 0.12]} />
      </mesh>

      {/* The big red/pink button */}
      <group position={[-1.02, top, -0.3]}>
        <mesh material={mats.buttonBase} position={[0, 0.02, 0]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.11, 0.12, 0.04, 40]} />
        </mesh>
        <mesh material={mats.buttonRing} position={[0, 0.041, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
          <torusGeometry args={[0.1, 0.006, 6, 48]} />
        </mesh>
        <mesh ref={capRef} material={mats.buttonCap} position={[0, 0.045, 0]} raycast={NO_RAYCAST}>
          <sphereGeometry args={[0.085, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      </group>

      {/* Mug */}
      <mesh material={mats.mug} position={[0.88, top + 0.05, -0.3]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.04, 0.036, 0.1, 20]} />
      </mesh>
    </group>
  );
}
