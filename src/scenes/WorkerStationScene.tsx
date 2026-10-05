import { useMemo } from 'react';
import * as THREE from 'three';
import { createRng, hashSeed, range } from '../simulation/rng';
import { buildWindowInstances, mergedBoxesGeometry, rectFrameGeometry } from '../three/geometryUtils';
import { MATERIALS } from '../three/materials';
import { Monitor } from '../three/Monitor';
import { hdr } from '../three/palette';
import { ParticleField } from '../three/ParticleField';
import { RobotWorker } from '../three/RobotWorker';
import { drawChartScreen, drawPositionScreen, drawScannerScreen } from '../three/screens';
import { createGridMaterial, createSkyMaterial } from '../three/shaders';
import type { BoxSpec } from '../three/towerDesign';
import { DESK, TradingDesk } from '../three/TradingDesk';
import { NO_RAYCAST, WindowsMesh } from '../three/WindowsMesh';
import { StationLighting } from '../three/StationLighting';

const WALL_Z = -3.2;
const WINDOW = { x0: -4.2, x1: 4.2, y0: 0.55, y1: 3.9 };

const STATION_DUST = { x: [-3.5, 3.5] as [number, number], y: [0.2, 3.4] as [number, number], z: [-3, 2] as [number, number] };

/** Night skyline seen through the office window. */
function WindowCity() {
  const data = useMemo(() => {
    const rng = createRng(hashSeed('station-city'));
    const boxes: BoxSpec[] = [];
    for (let row = 0; row < 4; row++) {
      const z = -24 - row * 12;
      const spread = 30 + row * 12;
      for (let x = -spread; x < spread; x += range(rng, 2.5, 5.5)) {
        const w = range(rng, 2, 4.6);
        const h = range(rng, 3, 9) + row * range(rng, 2.5, 6) + (rng() < 0.08 ? 10 : 0);
        boxes.push({ x, y: -6, z: z + range(rng, -3, 3), w, h, d: range(rng, 2, 4), lit: range(rng, 0.1, 0.24) });
      }
    }
    return {
      body: mergedBoxesGeometry(boxes),
      windows: buildWindowInstances(boxes, hashSeed('station-city-win'), {
        pitchX: 0.42,
        pitchY: 0.55,
        fillX: 0.45,
        fillY: 0.45,
        brightness: 0.7,
        warm: 0.15,
        skipBack: true,
      }),
    };
  }, []);
  const sky = useMemo(() => createSkyMaterial('#04020f', '#2a0f6e', '#7a2cff'), []);
  return (
    <group>
      <mesh material={sky} raycast={NO_RAYCAST} renderOrder={-10}>
        <sphereGeometry args={[80, 24, 12]} />
      </mesh>
      <mesh geometry={data.body} material={MATERIALS.buildingDark} raycast={NO_RAYCAST} />
      <WindowsMesh data={data.windows} />
    </group>
  );
}

/** Office shell: grid floor, back wall with a big window, neon strips. */
function Room() {
  const floor = useMemo(() => createGridMaterial({ color: '#5a33ff', base: '#05041a', scale: 0.5, fade: 9, lineWidth: 1 }), []);
  const wall = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0a0822', roughness: 0.8, metalness: 0.2 }), []);
  const neon = useMemo(() => new THREE.MeshBasicMaterial({ color: hdr('#7d28ff', 2.6) }), []);
  const neonCyan = useMemo(() => new THREE.MeshBasicMaterial({ color: hdr('#47f4ff', 1.8) }), []);
  const mullion = useMemo(() => new THREE.MeshStandardMaterial({ color: '#06051a', roughness: 0.5, metalness: 0.6 }), []);
  const frame = useMemo(() => rectFrameGeometry(WINDOW.x1 - WINDOW.x0, WINDOW.y1 - WINDOW.y0, 0.025, 0.02), []);
  const wW = WINDOW.x1 - WINDOW.x0;
  const wH = WINDOW.y1 - WINDOW.y0;
  const cx = (WINDOW.x0 + WINDOW.x1) / 2;
  const cy = (WINDOW.y0 + WINDOW.y1) / 2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={floor} raycast={NO_RAYCAST}>
        <planeGeometry args={[30, 30]} />
      </mesh>
      {/* Wall around the window opening */}
      <mesh material={wall} position={[0, WINDOW.y0 / 2, WALL_Z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[14, WINDOW.y0, 0.2]} />
      </mesh>
      <mesh material={wall} position={[0, WINDOW.y1 + 1.5, WALL_Z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[14, 3, 0.2]} />
      </mesh>
      <mesh material={wall} position={[WINDOW.x0 - 2.4, cy, WALL_Z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[4.8, wH, 0.2]} />
      </mesh>
      <mesh material={wall} position={[WINDOW.x1 + 2.4, cy, WALL_Z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[4.8, wH, 0.2]} />
      </mesh>
      {/* Glass tint */}
      <mesh position={[cx, cy, WALL_Z + 0.02]} raycast={NO_RAYCAST}>
        <planeGeometry args={[wW, wH]} />
        <meshBasicMaterial color="#120a3a" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      {/* Window frame + mullions */}
      <mesh geometry={frame} material={neon} position={[cx, cy, WALL_Z + 0.11]} raycast={NO_RAYCAST} />
      {[-2.1, 0, 2.1].map((x) => (
        <mesh key={x} material={mullion} position={[x, cy, WALL_Z + 0.06]} raycast={NO_RAYCAST}>
          <boxGeometry args={[0.06, wH, 0.08]} />
        </mesh>
      ))}
      <mesh material={mullion} position={[cx, WINDOW.y0 + wH * 0.62, WALL_Z + 0.06]} raycast={NO_RAYCAST}>
        <boxGeometry args={[wW, 0.05, 0.08]} />
      </mesh>
      {/* Side walls with vertical neon strips */}
      {[-5.2, 5.2].map((x) => (
        <group key={x}>
          <mesh material={wall} position={[x, 2.5, 0]} raycast={NO_RAYCAST}>
            <boxGeometry args={[0.2, 5, 7]} />
          </mesh>
          {[-1.8, 0.2, 2.2].map((z) => (
            <mesh key={z} material={neon} position={[x + (x < 0 ? 0.11 : -0.11), 1.9, z]} raycast={NO_RAYCAST}>
              <boxGeometry args={[0.02, 3.2, 0.03]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Floor skirting light */}
      <mesh material={neonCyan} position={[0, 0.02, WALL_Z + 0.12]} raycast={NO_RAYCAST}>
        <boxGeometry args={[10, 0.012, 0.012]} />
      </mesh>
    </group>
  );
}

/** The worker's workstation: robot at a multi-monitor desk in a purple night office. */
export function WorkerStationScene({ active }: { active: boolean }) {
  const deckTop = DESK.y + DESK.thickness / 2;
  return (
    <group visible={active}>
      <WindowCity />
      <Room />
      <TradingDesk />
      <Monitor
        width={1.12}
        height={0.63}
        position={[0.06, deckTop + 0.62, -0.92]}
        rotation={[-0.04, 0, 0]}
        resolution={[1280, 720]}
        draw={drawChartScreen}
        fps={30}
        glow="#4d36ff"
        standHeight={0.29}
      />
      <Monitor
        width={0.62}
        height={0.78}
        position={[-0.96, deckTop + 0.68, -0.68]}
        rotation={[-0.03, 0.55, 0]}
        resolution={[760, 960]}
        draw={drawScannerScreen}
        fps={24}
        glow="#2bd4ff"
        standHeight={0.27}
      />
      <Monitor
        width={0.6}
        height={0.42}
        position={[1.0, deckTop + 0.5, -0.7]}
        rotation={[-0.04, -0.55, 0]}
        resolution={[760, 532]}
        draw={drawPositionScreen}
        fps={15}
        glow="#8a4dff"
        standHeight={0.27}
      />
      <RobotWorker />
      <StationLighting />
      <ParticleField count={120} bounds={STATION_DUST} size={7} color="#c6b5ff" />
    </group>
  );
}
