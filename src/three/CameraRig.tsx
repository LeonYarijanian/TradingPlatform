import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { TRANSITION_IN_MS, TRANSITION_OUT_MS, takeManualControl } from '../app/transitions';
import { getUi, useUi } from '../app/uiStore';
import type { WorkerId } from '../types/trading';
import { CITY_CAMERA, STATION_CAMERA } from './layout';
import { TOWER_DESIGNS } from './towerDesign';

interface View {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Pull the camera back on narrow/portrait screens so the five towers fit. */
function aspectFactor(aspect: number): number {
  return Math.min(2.3, Math.max(1, Math.pow(1.7 / aspect, 0.85)));
}

function cityDefault(aspect: number): View {
  const k = aspectFactor(aspect);
  const target = new THREE.Vector3(...CITY_CAMERA.target);
  const pos = new THREE.Vector3(...CITY_CAMERA.position);
  const offset = pos.sub(target).multiplyScalar(k);
  if (k > 1) target.y += (k - 1) * 1.2;
  return { target, position: target.clone().add(offset) };
}

function towerFocus(id: WorkerId, aspect: number): View {
  const d = TOWER_DESIGNS[id];
  const [x, , z] = d.worker.position;
  const k = aspectFactor(aspect);
  const target = new THREE.Vector3(x * 0.92, d.spireTop * 0.5 + 0.4, z);
  const position = new THREE.Vector3(x * 0.7, d.spireTop * 0.58 + 2.6, z + (8.5 + d.spireTop * 0.35) * k);
  return { target, position };
}

function towerFlyIn(id: WorkerId): View {
  const d = TOWER_DESIGNS[id];
  const [x, , z] = d.worker.position;
  const target = new THREE.Vector3(x, d.auraCenterY + 0.6, z);
  return { target, position: new THREE.Vector3(x, d.auraCenterY + 1.0, z + 2.6) };
}

function stationView(aspect: number): View {
  const k = Math.min(1.9, Math.max(1, Math.pow(1.6 / aspect, 0.8)));
  const target = new THREE.Vector3(...STATION_CAMERA.target);
  const position = new THREE.Vector3(...STATION_CAMERA.position).sub(target).multiplyScalar(k).add(target);
  return { target, position };
}

function stationPushIn(): View {
  return { target: new THREE.Vector3(0.05, 1.32, -0.9), position: new THREE.Vector3(0.12, 1.45, 0.25) };
}

/** Orbit clamps per scene: no flipping under the city, no losing the desk. */
function applyLimits(c: OrbitControlsImpl, scene: 'city' | 'station'): void {
  if (scene === 'city') {
    c.minDistance = 5;
    c.maxDistance = 46;
    c.minPolarAngle = 0.5;
    c.maxPolarAngle = 1.42;
    c.minAzimuthAngle = -0.85;
    c.maxAzimuthAngle = 0.85;
  } else {
    c.minDistance = 1.2;
    c.maxDistance = 7;
    c.minPolarAngle = 0.55;
    c.maxPolarAngle = 1.5;
    c.minAzimuthAngle = -0.7;
    c.maxAzimuthAngle = 1.2;
  }
}

interface Tween {
  from: View;
  to: View;
  start: number;
  duration: number;
  ease: (t: number) => number;
  /** Keep orbit controls disabled during the tween. */
  locked: boolean;
}

/**
 * Owns the camera: orbit controls (clamped so the city can't be flipped),
 * smooth focus tweens, scene-transition fly-ins and a subtle idle drift.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const tween = useRef<Tween | null>(null);
  const lastInteraction = useRef(-10);
  const drift = useRef({ angle: 0, bob: 0 });
  const scene = useUi((s) => s.scene);
  const selected = useUi((s) => s.selectedWorkerId);
  const resetSeq = useUi((s) => s.cameraResetSeq);
  const transition = useUi((s) => s.transition);
  const aspect = size.width / Math.max(1, size.height);

  const current = (): View => ({
    position: camera.position.clone(),
    target: controls.current ? controls.current.target.clone() : new THREE.Vector3(...CITY_CAMERA.target),
  });

  const startTween = (to: View, duration: number, ease = easeInOut, locked = false, from?: View) => {
    tween.current = { from: from ?? current(), to, start: performance.now(), duration, ease, locked };
  };

  // Initial placement.
  useEffect(() => {
    const sc = getUi().scene;
    const v = sc === 'station' ? stationView(aspect) : cityDefault(aspect);
    camera.position.copy(v.position);
    if (controls.current) {
      applyLimits(controls.current, sc);
      controls.current.target.copy(v.target);
      controls.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    camera.fov = CITY_CAMERA.fov + (aspect < 1 ? 6 : 0);
    camera.updateProjectionMatrix();
  }, [aspect, camera]);

  // Transitions: fly toward the tower / monitor, then reveal the next scene.
  useEffect(() => {
    if (!transition) return;
    if (transition.phase === 'out') {
      if (transition.to === 'station' && transition.from === 'city' && transition.workerId) {
        startTween(towerFlyIn(transition.workerId), TRANSITION_OUT_MS, easeIn, true);
      } else if (transition.from === 'station') {
        startTween(stationPushIn(), TRANSITION_OUT_MS, easeIn, true);
      }
    } else {
      if (transition.to === 'station') {
        const final = stationView(aspect);
        const from: View = {
          position: final.position.clone().add(new THREE.Vector3(0.9, 0.6, 1.8)),
          target: final.target.clone().add(new THREE.Vector3(0, 0.2, 0)),
        };
        camera.position.copy(from.position);
        startTween(final, TRANSITION_IN_MS + 250, easeOut, true, from);
      } else {
        const id = transition.workerId ?? 'qqq';
        const final = selected ? towerFocus(selected, aspect) : cityDefault(aspect);
        const from = towerFlyIn(id);
        camera.position.copy(from.position);
        startTween(final, TRANSITION_IN_MS + 450, easeOut, true, from);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition?.phase, transition?.to]);

  // Instant scene switches (no transition) snap straight to that scene's framing.
  const lastScene = useRef(scene);
  useEffect(() => {
    if (lastScene.current === scene) return;
    lastScene.current = scene;
    if (getUi().transition) return;
    const v = scene === 'station' ? stationView(aspect) : selected ? towerFocus(selected, aspect) : cityDefault(aspect);
    tween.current = null;
    camera.position.copy(v.position);
    if (controls.current) {
      applyLimits(controls.current, scene);
      controls.current.target.copy(v.target);
      controls.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // Focus / unfocus a tower in the city.
  useEffect(() => {
    if (scene !== 'city' || getUi().transition) return;
    startTween(selected ? towerFocus(selected, aspect) : cityDefault(aspect), 1100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, resetSeq]);

  // Re-frame on resize.
  useEffect(() => {
    if (getUi().transition) return;
    if (scene === 'city') startTween(selected ? towerFocus(selected, aspect) : cityDefault(aspect), 500);
    else startTween(stationView(aspect), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      lastInteraction.current = performance.now() / 1000;
      tween.current = null;
      takeManualControl();
    };
    const onEnd = () => {
      lastInteraction.current = performance.now() / 1000;
    };
    c.addEventListener('start', onStart);
    c.addEventListener('end', onEnd);
    return () => {
      c.removeEventListener('start', onStart);
      c.removeEventListener('end', onEnd);
    };
  }, []);

  // Orbit limits per scene.
  useEffect(() => {
    if (controls.current) applyLimits(controls.current, scene);
  }, [scene]);

  useFrame((state) => {
    const c = controls.current;
    if (!c) return;
    const tw = tween.current;
    if (tw) {
      const k = Math.min(1, (performance.now() - tw.start) / tw.duration);
      const e = tw.ease(k);
      camera.position.lerpVectors(tw.from.position, tw.to.position, e);
      c.target.lerpVectors(tw.from.target, tw.to.target, e);
      c.enabled = !tw.locked;
      camera.lookAt(c.target);
      if (k >= 1) {
        tween.current = null;
        c.enabled = true;
        applyLimits(c, getUi().scene);
        c.update();
      }
      return;
    }
    c.enabled = true;

    // Idle drift: slow azimuth sway + tiny bob, only when the user isn't steering.
    const ui = getUi();
    const idle = state.clock.elapsedTime - lastInteraction.current > 3.5 || ui.autoDemo;
    if (!ui.reducedMotion && idle) {
      const t = state.clock.elapsedTime;
      const amp = ui.scene === 'city' ? (ui.autoDemo ? 0.11 : 0.06) : 0.035;
      const angle = Math.sin(t * 0.11) * amp;
      const delta = angle - drift.current.angle;
      drift.current.angle = angle;
      const offset = camera.position.clone().sub(c.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), delta);
      const bob = Math.sin(t * 0.23) * (ui.scene === 'city' ? 0.12 : 0.03);
      offset.y += bob - drift.current.bob;
      drift.current.bob = bob;
      camera.position.copy(c.target).add(offset);
    }
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
    />
  );
}
