import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { getUi } from '../app/uiStore';
import { towerFx } from './towerFx';

/**
 * Same light *types and counts* as the city (1 ambient, 1 hemisphere,
 * 2 directional, 3 point) so switching scenes never recompiles shaders.
 */
export function StationLighting() {
  const flash = useRef<THREE.PointLight>(null);
  const screen = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const ui = getUi();
    if (ui.scene !== 'station') return;
    const fx = towerFx[ui.stationWorkerId];
    if (flash.current) {
      const a = fx.fireAge;
      flash.current.intensity = a < 1.4 ? (1 - a / 1.4) * 9 : fx.status === 'ready' ? 1.5 + Math.sin(state.clock.elapsedTime * 12) : 0;
      flash.current.color.copy(fx.color);
    }
    if (screen.current) screen.current.intensity = 2.6 + 0.25 * Math.sin(state.clock.elapsedTime * 1.7);
  });
  return (
    <>
      <ambientLight color="#2b1f80" intensity={0.6} />
      <hemisphereLight color="#5a46ff" groundColor="#08041a" intensity={0.55} />
      <directionalLight color="#8a5cff" intensity={1.4} position={[-2, 4, -6]} />
      {/* Cool key from behind the camera so the robot's shell reads mint */}
      <directionalLight color="#d6fff4" intensity={1.5} position={[2.5, 3.5, 4]} />
      <pointLight color="#7a3cff" intensity={3.2} distance={4} decay={2} position={[0, 0.42, -0.25]} />
      <pointLight ref={screen} color="#b9c9ff" intensity={2.6} distance={3.5} decay={2} position={[0, 1.35, -0.45]} />
      <pointLight ref={flash} color="#ffffff" intensity={0} distance={4} decay={2} position={[-0.5, 1.0, -0.2]} />
    </>
  );
}
