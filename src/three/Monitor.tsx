import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getUi } from '../app/uiStore';
import type { SimData } from '../simulation/reducer';
import { getSim } from '../simulation/simulationStore';
import type { WorkerId } from '../types/trading';
import { rectFrameGeometry } from './geometryUtils';
import { hdr } from './palette';
import { NO_RAYCAST } from './WindowsMesh';

export type ScreenDraw = (ctx: CanvasRenderingContext2D, w: number, h: number, sim: SimData, workerId: WorkerId, time: number) => void;

interface Props {
  width: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  resolution: [number, number];
  draw: ScreenDraw;
  fps?: number;
  glow?: string;
  standHeight?: number;
}

/** A desk monitor whose screen is a live-drawn canvas texture (blooms + depth-correct). */
export function Monitor({
  width,
  height,
  position,
  rotation = [0, 0, 0],
  resolution,
  draw,
  fps = 30,
  glow = '#5a3cff',
  standHeight = 0.3,
}: Props) {
  const [resW, resH] = resolution;
  const { canvas, ctx, texture } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = resW;
    canvas.height = resH;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, [resW, resH]);
  useEffect(() => () => texture.dispose(), [texture]);

  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1.25, 1.25, 1.25) }), [texture]);
  useEffect(() => () => screenMat.dispose(), [screenMat]);
  const bezelMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#05050c', roughness: 0.35, metalness: 0.6 }), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: hdr(glow, 2.4) }), [glow]);
  const frame = useMemo(() => rectFrameGeometry(width + 0.06, height + 0.06, 0.008, 0.01), [width, height]);
  const acc = useRef(1);

  useFrame((state, dt) => {
    if (getUi().scene !== 'station') return;
    acc.current += dt;
    if (acc.current < 1 / fps) return;
    acc.current = 0;
    draw(ctx, canvas.width, canvas.height, getSim(), getUi().stationWorkerId, state.clock.elapsedTime);
    texture.needsUpdate = true;
  });

  return (
    <group position={position} rotation={rotation}>
      <mesh material={bezelMat} position={[0, 0, -0.02]} raycast={NO_RAYCAST}>
        <boxGeometry args={[width + 0.05, height + 0.05, 0.035]} />
      </mesh>
      <mesh material={screenMat} position={[0, 0, 0.0]} raycast={NO_RAYCAST}>
        <planeGeometry args={[width, height]} />
      </mesh>
      <mesh geometry={frame} material={glowMat} position={[0, 0, -0.012]} raycast={NO_RAYCAST} />
      {/* Stand */}
      <mesh material={bezelMat} position={[0, -height / 2 - standHeight / 2, -0.06]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.05, standHeight, 0.03]} />
      </mesh>
      <mesh material={bezelMat} position={[0, -height / 2 - standHeight, -0.06]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.26, 0.015, 0.16]} />
      </mesh>
    </group>
  );
}
