import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { createAuraMaterial } from './shaders';
import type { TowerDesign } from './towerDesign';
import { towerFx } from './towerFx';
import { GEOMETRIES } from './materials';
import { NO_RAYCAST } from './WindowsMesh';

/**
 * Giant translucent energy sphere that grows around the upper tower as a
 * setup charges (mint for CALL, magenta for PUT), bursts at 100% and
 * collapses into the fire.
 */
export function ChargeAura({ design }: { design: TowerDesign }) {
  const [x, , z] = design.worker.position;
  const outer = useMemo(createAuraMaterial, []);
  const inner = useMemo(createAuraMaterial, []);
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const fx = towerFx[design.id];
    const level = Math.max(fx.charge, fx.burst * 0.9);
    const visible = level > 0.004;
    if (outerRef.current) outerRef.current.visible = visible;
    if (innerRef.current) innerRef.current.visible = visible;
    if (!visible) return;
    const radius = design.auraBaseRadius + (design.auraMaxRadius - design.auraBaseRadius) * fx.charge;
    const burstScale = 1 + fx.burst * 0.35;
    const breathe = 1 + 0.02 * Math.sin(state.clock.elapsedTime * (2 + fx.charge * 6));
    const r = radius * burstScale * breathe;
    outerRef.current!.scale.setScalar(r);
    innerRef.current!.scale.setScalar(r * 0.72);
    const opacity = Math.min(1.6, 0.25 + fx.charge * 1.05 + fx.burst * 1.4) * Math.min(1, level * 6);
    for (const [m, k] of [
      [outer, 1],
      [inner, 0.45],
    ] as const) {
      m.uniforms.uColor.value.copy(fx.color);
      m.uniforms.uOpacity.value = opacity * k;
      m.uniforms.uTime.value = state.clock.elapsedTime;
      m.uniforms.uCharge.value = fx.charge;
    }
  });

  return (
    <group position={[x, design.auraCenterY, z]}>
      <mesh ref={outerRef} geometry={GEOMETRIES.sphere} material={outer} renderOrder={5} raycast={NO_RAYCAST} />
      <mesh ref={innerRef} geometry={GEOMETRIES.sphere} material={inner} renderOrder={5} raycast={NO_RAYCAST} />
    </group>
  );
}
