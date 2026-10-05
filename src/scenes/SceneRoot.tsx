import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useUi } from '../app/uiStore';
import { CameraRig } from '../three/CameraRig';
import { Effects } from '../three/Effects';
import { CITY_CAMERA } from '../three/layout';
import { FxDriver } from '../three/SceneLighting';
import { TradingCityScene } from './TradingCityScene';
import { WorkerStationScene } from './WorkerStationScene';

/** Per-scene fog + clear color (same fog type in both → no shader recompiles). */
function SceneAtmosphere() {
  const scene = useUi((s) => s.scene);
  const three = useThree((s) => s.scene);
  useEffect(() => {
    if (scene === 'city') {
      three.fog = new THREE.FogExp2('#0d0726', 0.019);
      three.background = new THREE.Color('#04030B');
    } else {
      three.fog = new THREE.FogExp2('#120a33', 0.03);
      three.background = new THREE.Color('#050414');
    }
  }, [scene, three]);
  return null;
}

/** Flags the app as ready once a few frames have actually rendered. */
function ReadySignal() {
  const frames = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    frames.current += 1;
    if (frames.current > 4) {
      done.current = true;
      useUi.setState({ ready: true });
    }
  });
  return null;
}

export function SceneRoot() {
  const scene = useUi((s) => s.scene);
  const lowPower = useUi((s) => s.lowPower);
  return (
    <Canvas
      className="scene-canvas"
      flat
      dpr={[1, lowPower ? 1.3 : 1.75]}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: CITY_CAMERA.fov, near: 0.1, far: 600, position: CITY_CAMERA.position }}
      onCreated={(state) => {
        state.gl.setClearColor('#04030B');
        if (import.meta.env.DEV) {
          const w = window as unknown as { __ntc?: Record<string, unknown> };
          if (w.__ntc) w.__ntc.three = state;
        }
      }}
    >
      <SceneAtmosphere />
      <FxDriver />
      <Suspense fallback={null}>
        <TradingCityScene active={scene === 'city'} />
        <WorkerStationScene active={scene === 'station'} />
        <ReadySignal />
      </Suspense>
      <CameraRig />
      <Effects />
    </Canvas>
  );
}
