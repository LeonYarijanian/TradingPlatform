import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { WORKERS } from '../data/workers';
import { TOWER_DESIGNS } from './towerDesign';
import { towerFx, updateTowerFx } from './towerFx';

/** Runs the shared tower-effects update before anything else renders. */
export function FxDriver() {
  useFrame((_, dt) => updateTowerFx(Math.min(dt, 0.1)), -2);
  return null;
}

/** Dark, uneven city lighting: emissives do most of the work. */
export function CityLighting() {
  return (
    <>
      <ambientLight color="#2a1d7a" intensity={0.55} />
      <hemisphereLight color="#4b3bff" groundColor="#05030f" intensity={0.65} />
      <directionalLight color="#7a5cff" intensity={0.9} position={[-12, 18, -20]} />
      <directionalLight color="#2f7dff" intensity={0.35} position={[14, 10, 12]} />
      <FlashLights />
    </>
  );
}

const LIGHTS = 2;

/** Two pooled point lights that jump to whichever towers just fired. */
function FlashLights() {
  const refs = useRef<Array<THREE.PointLight | null>>([]);
  useFrame(() => {
    const recent = WORKERS.map((w) => ({ w, fx: towerFx[w.id] }))
      .filter((r) => r.fx.fireAge < 2.2)
      .sort((a, b) => a.fx.fireAge - b.fx.fireAge)
      .slice(0, LIGHTS);
    for (let i = 0; i < LIGHTS; i++) {
      const light = refs.current[i];
      if (!light) continue;
      const r = recent[i];
      if (!r) {
        light.intensity = 0;
        continue;
      }
      const d = TOWER_DESIGNS[r.w.id];
      light.position.set(r.w.position[0], d.spireTop - 0.6, r.w.position[2] + 0.8);
      light.color.copy(r.fx.color);
      const a = r.fx.fireAge;
      light.intensity = (a < 0.35 ? a / 0.35 : Math.max(0, 1 - (a - 0.35) / 1.8)) * 140;
    }
  });
  return (
    <>
      {Array.from({ length: LIGHTS }, (_, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            refs.current[i] = l;
          }}
          intensity={0}
          distance={16}
          decay={1.6}
        />
      ))}
    </>
  );
}
