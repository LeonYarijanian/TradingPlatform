import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useUi } from '../app/uiStore';
import type { WindowInstances } from './geometryUtils';
import { createWindowMaterial } from './windowMaterial';

export const NO_RAYCAST = () => null;

interface Props {
  data: WindowInstances;
  /** Optional per-frame brightness provider (hover/selection boost). */
  boost?: () => number;
}

/** Thousands of tiny lit windows in a single instanced draw call. */
export function WindowsMesh({ data, boost }: Props) {
  const material = useMemo(createWindowMaterial, []);
  const reduced = useUi((s) => s.reducedMotion);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(data.colors, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(data.seeds, 1));
    return g;
  }, [data]);
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(data.matrices, 16);
    mesh.count = data.count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [data]);

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uTwinkle.value = reduced ? 0 : 1;
    if (boost) material.uniforms.uBoost.value = boost();
  });

  return <instancedMesh ref={ref} args={[geometry, material, data.count]} frustumCulled={false} raycast={NO_RAYCAST} />;
}
