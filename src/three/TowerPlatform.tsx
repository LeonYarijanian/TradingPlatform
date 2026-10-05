import { useMemo } from 'react';
import * as THREE from 'three';
import { frameGeometry } from './geometryUtils';
import { GEOMETRIES, MATERIALS } from './materials';
import { hdr } from './palette';
import type { TowerDesign } from './towerDesign';
import { NO_RAYCAST } from './WindowsMesh';

const rimMaterial = new THREE.MeshBasicMaterial({ color: hdr('#e8ecff', 2.4) });
const lowRimMaterial = new THREE.MeshBasicMaterial({ color: hdr('#6a4dff', 1.3) });

/** Square dark city block with a thin glowing outline. */
export function TowerPlatform({ design }: { design: TowerDesign }) {
  const [x, , z] = design.worker.position;
  const size = design.platformSize;
  const h = design.platformHeight;
  const rim = useMemo(() => frameGeometry(size, 0.03, 0.025), [size]);
  const lowRim = useMemo(() => frameGeometry(size + 0.3, 0.025, 0.02), [size]);
  const accentRim = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(design.worker.accent).multiplyScalar(1.6) }),
    [design.worker.accent],
  );
  const inner = useMemo(() => frameGeometry(design.podium.w + 0.18, 0.02, 0.02), [design.podium.w]);

  return (
    <group>
      <mesh geometry={GEOMETRIES.box} material={MATERIALS.platform} position={[x, h / 2, z]} scale={[size, h, size]} raycast={NO_RAYCAST} />
      <mesh geometry={rim} material={rimMaterial} position={[x, h + 0.005, z]} raycast={NO_RAYCAST} />
      <mesh geometry={lowRim} material={lowRimMaterial} position={[x, 0.012, z]} raycast={NO_RAYCAST} />
      <mesh geometry={inner} material={accentRim} position={[x, h + 0.012, z]} raycast={NO_RAYCAST} />
    </group>
  );
}
