import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useUi } from '../app/uiStore';
import { createBeamMaterial, createShockwaveMaterial, createSparkMaterial } from './shaders';
import { SIGNAL_COLORS } from './palette';
import type { TowerDesign } from './towerDesign';
import { towerFx } from './towerFx';
import { NO_RAYCAST } from './WindowsMesh';

export const BEAM_HEIGHT = 58;
const SPARK_COUNT = 42;

const CORE = new THREE.Color(SIGNAL_COLORS.CALL.core);
const tmp = new THREE.Color();

/**
 * The FIRE effect: a pulsing, noise-scrolled light column with a white-hot
 * core, a direction-colored shell, horizontal shockwaves and rising sparks.
 */
export function SignalBeam({ design }: { design: TowerDesign }) {
  const [x, , z] = design.worker.position;
  const base = design.spireTop;
  const reduced = useUi((s) => s.reducedMotion);
  const lowPower = useUi((s) => s.lowPower);
  const dpr = useThree((s) => s.viewport.dpr);

  const mats = useMemo(
    () => ({
      core: createBeamMaterial('core'),
      shell: createBeamMaterial('shell'),
      glow: createBeamMaterial('glow'),
      shock: createShockwaveMaterial(),
      shock2: createShockwaveMaterial(),
      sparks: createSparkMaterial(),
    }),
    [],
  );

  const geos = useMemo(() => {
    const cyl = (r: number) => new THREE.CylinderGeometry(r, r, BEAM_HEIGHT, 20, 1, true).translate(0, BEAM_HEIGHT / 2, 0);
    const sparks = new THREE.BufferGeometry();
    const count = lowPower ? SPARK_COUNT / 2 : SPARK_COUNT;
    sparks.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    sparks.setAttribute('aSeed', new THREE.Float32BufferAttribute(Float32Array.from({ length: count }, () => Math.random()), 1));
    return { core: cyl(0.05), shell: cyl(0.26), glow: cyl(0.9), plane: new THREE.PlaneGeometry(1, 1), sparks };
  }, [lowPower]);

  const groupRef = useRef<THREE.Group>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const shock2Ref = useRef<THREE.Mesh>(null);
  const sparksRef = useRef<THREE.Points>(null);

  useFrame((state) => {
    const fx = towerFx[design.id];
    const t = state.clock.elapsedTime;
    const on = fx.beam > 0.004;
    if (groupRef.current) groupRef.current.visible = on || fx.fireAge < 2.5;
    if (!groupRef.current?.visible) return;

    const shellColor = fx.direction === 'PUT' ? SIGNAL_COLORS.PUT.shell : SIGNAL_COLORS.CALL.shell;
    tmp.set(shellColor);
    const flicker = reduced ? 0 : 1;
    // Core: white-hot, tinted slightly toward the trade direction.
    mats.core.uniforms.uColor.value.copy(CORE).lerp(tmp, 0.15).multiplyScalar(7);
    mats.core.uniforms.uIntensity.value = fx.beam;
    mats.shell.uniforms.uColor.value.copy(tmp).multiplyScalar(3.2);
    mats.shell.uniforms.uIntensity.value = fx.beam;
    mats.glow.uniforms.uColor.value.copy(tmp).multiplyScalar(1.4);
    mats.glow.uniforms.uIntensity.value = fx.beam;
    for (const m of [mats.core, mats.shell, mats.glow]) {
      m.uniforms.uGrow.value = fx.beamGrow;
      m.uniforms.uTime.value = t;
      m.uniforms.uFlicker.value = flicker;
    }

    // Shockwaves expand horizontally from the ring level.
    const a = fx.fireAge;
    const wave = (age: number, mesh: THREE.Mesh | null, mat: THREE.ShaderMaterial, maxR: number) => {
      if (!mesh) return;
      const k = (age - 0.2) / 0.9;
      mesh.visible = k > 0 && k < 1;
      if (!mesh.visible) return;
      const r = 0.3 + maxR * (1 - Math.pow(1 - k, 3));
      mesh.scale.set(r * 2, r * 2, 1);
      mat.uniforms.uColor.value.copy(tmp).lerp(CORE, 0.3).multiplyScalar(3);
      mat.uniforms.uOpacity.value = (1 - k) * 1.2;
    };
    wave(a, shockRef.current, mats.shock, 3.2);
    wave(a - 0.18, shock2Ref.current, mats.shock2, 2.0);

    if (sparksRef.current) {
      mats.sparks.uniforms.uAge.value = Math.max(0, a - 0.45);
      mats.sparks.uniforms.uColor.value.copy(tmp).lerp(CORE, 0.4);
      mats.sparks.uniforms.uPixelRatio.value = dpr;
      sparksRef.current.visible = a < 2.6;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <group position={[x, base, z]}>
        <mesh geometry={geos.glow} material={mats.glow} renderOrder={6} raycast={NO_RAYCAST} />
        <mesh geometry={geos.shell} material={mats.shell} renderOrder={7} raycast={NO_RAYCAST} />
        <mesh geometry={geos.core} material={mats.core} renderOrder={8} raycast={NO_RAYCAST} />
        <points ref={sparksRef} geometry={geos.sparks} material={mats.sparks} raycast={NO_RAYCAST} />
      </group>
      <mesh
        ref={shockRef}
        geometry={geos.plane}
        material={mats.shock}
        position={[x, design.rings[0].y, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={9}
        raycast={NO_RAYCAST}
      />
      <mesh
        ref={shock2Ref}
        geometry={geos.plane}
        material={mats.shock2}
        position={[x, design.roofY, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={9}
        raycast={NO_RAYCAST}
      />
    </group>
  );
}
