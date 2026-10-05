import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { goToScene, selectWorker, takeManualControl } from '../app/transitions';
import { getUi, useUi } from '../app/uiStore';
import { hashSeed } from '../simulation/rng';
import { TowerPlaque, WorkerStatusCard } from '../ui/WorkerStatusCard';
import { ChargeAura } from './ChargeAura';
import { boxEdgesGeometry, buildWindowInstances, mergedBoxesGeometry } from './geometryUtils';
import { MATERIALS } from './materials';
import { SignalBeam } from './SignalBeam';
import type { TowerDesign } from './towerDesign';
import { towerFx } from './towerFx';
import { TowerPlatform } from './TowerPlatform';
import { TowerSpire } from './TowerSpire';
import { NO_RAYCAST, WindowsMesh } from './WindowsMesh';

const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

/** One trading worker rendered as a miniature skyscraper district. */
export function TradingTower({ design, showLabels }: { design: TowerDesign; showLabels: boolean }) {
  const { id } = design;
  const [x, , z] = design.worker.position;
  const mainBoxes = useMemo(() => [design.podium, ...design.sections], [design]);

  const built = useMemo(() => {
    const windows = buildWindowInstances([...mainBoxes, ...design.minis], hashSeed(`win:${id}`), {
      brightness: id === 'qqq' ? 1.1 : 1,
    });
    return {
      windows,
      body: mergedBoxesGeometry(mainBoxes),
      minis: mergedBoxesGeometry(design.minis),
      edges: boxEdgesGeometry(mainBoxes),
      miniEdges: boxEdgesGeometry(design.minis, true),
    };
  }, [design, id, mainBoxes]);

  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color('#3b2fb8'), transparent: true, opacity: 0.7 }),
    [],
  );
  const baseEdge = useMemo(() => new THREE.Color('#3b2fb8').multiplyScalar(1.2), []);
  const hiEdge = useMemo(() => new THREE.Color(design.worker.accent).multiplyScalar(1.8), [design.worker.accent]);

  useFrame(() => {
    const fx = towerFx[id];
    edgeMat.color.copy(baseEdge).lerp(hiEdge, fx.highlight * 0.85);
  });

  const top = design.sections[design.sections.length - 1];
  const hitHeight = top.y + top.h;

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (getUi().scene !== 'city') return;
    useUi.setState({ hoveredWorkerId: id });
    document.body.style.cursor = 'pointer';
  };
  const onOut = () => {
    if (getUi().hoveredWorkerId === id) useUi.setState({ hoveredWorkerId: null });
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const ui = getUi();
    if (ui.scene !== 'city' || ui.transition) return;
    takeManualControl();
    if (ui.selectedWorkerId === id) goToScene('station', id);
    else selectWorker(id);
  };

  return (
    <group>
      <TowerPlatform design={design} />
      <mesh geometry={built.body} material={MATERIALS.building} raycast={NO_RAYCAST} />
      <mesh geometry={built.minis} material={MATERIALS.buildingDark} raycast={NO_RAYCAST} />
      <lineSegments geometry={built.edges} material={edgeMat} raycast={NO_RAYCAST} />
      <lineSegments geometry={built.miniEdges} material={MATERIALS.edge} raycast={NO_RAYCAST} />
      <WindowsMesh
        data={built.windows}
        boost={() => {
          const fx = towerFx[id];
          const flash = fx.fireAge < 0.8 ? (1 - fx.fireAge / 0.8) * 0.8 : 0;
          return 1 + fx.highlight * 0.5 + flash;
        }}
      />
      <TowerSpire design={design} />
      <ChargeAura design={design} />
      <SignalBeam design={design} />

      {/* Invisible hit volume for hover / click */}
      <mesh
        position={[x, hitHeight / 2, z]}
        scale={[design.podium.w, hitHeight, design.podium.d]}
        material={hitMaterial}
        onPointerOver={onOver}
        onPointerOut={onOut}
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          takeManualControl();
          goToScene('station', id);
        }}
      >
        <boxGeometry />
      </mesh>

      {showLabels && (
        <>
          <Html position={[x, design.plaqueY, design.plaqueZ]} center zIndexRange={[12, 4]} pointerEvents="none">
            <TowerPlaque workerId={id} />
          </Html>
          <Html position={[x + design.statusX, design.statusY, z]} center zIndexRange={[14, 6]} pointerEvents="none">
            <WorkerStatusCard workerId={id} />
          </Html>
        </>
      )}
    </group>
  );
}
