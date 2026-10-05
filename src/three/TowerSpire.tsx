import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { frameGeometry } from './geometryUtils';
import { GEOMETRIES, MATERIALS } from './materials';
import type { TowerDesign } from './towerDesign';
import { towerFx } from './towerFx';
import { NO_RAYCAST } from './WindowsMesh';

const WHITE = new THREE.Color('#f4f7ff');
const tmp = new THREE.Color();

/** Roof structure, antenna spire, diamond ornament, emitter and orbital rings. */
export function TowerSpire({ design }: { design: TowerDesign }) {
  const [x, , z] = design.worker.position;
  const top = design.sections[design.sections.length - 1];
  const topY = top.y + top.h;
  const spireLen = design.spireTop - design.roofY;

  const mats = useMemo(
    () => ({
      spire: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      emitter: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      ornament: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      ring: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1 }),
      ring2: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1 }),
      crown: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      sparkle: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 }),
    }),
    [],
  );

  const geo = useMemo(() => {
    const [r1, r2] = design.rings;
    const arcs = [0, 1, 2].map((i) => new THREE.TorusGeometry(r2.radius, 0.014, 6, 48, Math.PI * 0.5).rotateZ((i * Math.PI * 2) / 3));
    return {
      ring: new THREE.TorusGeometry(r1.radius, 0.022, 6, 128),
      ringOuter: new THREE.TorusGeometry(r1.radius * 1.12, 0.008, 4, 128),
      arcs,
      spire: new THREE.CylinderGeometry(0.012, 0.045, spireLen, 6, 1),
      crownRim: frameGeometry(top.w, 0.03, 0.03),
      roofRim: frameGeometry(design.crown.w, 0.02, 0.02),
    };
  }, [design, spireLen, top.w]);

  const accent = useMemo(() => new THREE.Color(design.worker.accent), [design.worker.accent]);
  const ringRef = useRef<THREE.Group>(null);
  const arcRef = useRef<THREE.Group>(null);
  const ornamentRef = useRef<THREE.Mesh>(null);
  const emitterRef = useRef<THREE.Mesh>(null);
  const sparkleRefs = useRef<Array<THREE.Mesh | null>>([]);

  useFrame((state, dt) => {
    const fx = towerFx[design.id];
    const t = state.clock.elapsedTime;
    const glow = fx.intensity * (0.75 + 0.25 * fx.pulse) * (1 + fx.highlight * 0.35);
    const active = fx.charge > 0.02 || fx.beam > 0.02 || fx.status === 'ready' || fx.status === 'firing';
    const mixAmt = active ? 0.55 : 0.18;

    tmp
      .copy(WHITE)
      .lerp(fx.color, mixAmt)
      .multiplyScalar(1.1 * glow);
    mats.spire.color.copy(tmp);
    tmp
      .copy(WHITE)
      .lerp(fx.color, mixAmt * 0.7)
      .multiplyScalar(2.4 * glow);
    mats.emitter.color.copy(tmp);
    tmp
      .copy(WHITE)
      .lerp(fx.color, 0.35)
      .multiplyScalar(1.6 * glow);
    mats.ornament.color.copy(tmp);
    const ringGlow =
      0.9 + fx.charge * 2.2 + fx.beam * 2 + fx.highlight * 0.6 + (fx.status === 'managing' || fx.status === 'trailing' ? 0.9 : 0);
    tmp
      .copy(WHITE)
      .lerp(fx.color, active ? 0.45 : 0.1)
      .multiplyScalar(ringGlow);
    mats.ring.color.copy(tmp);
    mats.ring2.color.copy(tmp).multiplyScalar(0.8);
    tmp
      .copy(WHITE)
      .lerp(accent, 0.5)
      .multiplyScalar(1.1 + fx.highlight * 0.8 + fx.charge * 0.8);
    mats.crown.color.copy(tmp);

    if (ringRef.current) {
      ringRef.current.rotation.y += dt * 0.15;
      const s = 1 + fx.burst * 0.18 + (fx.status === 'ready' ? 0.04 * fx.pulse : 0);
      ringRef.current.scale.setScalar(s);
    }
    if (arcRef.current) arcRef.current.rotation.y -= dt * (0.4 + fx.charge * 2.5 + fx.beam * 3);
    if (ornamentRef.current) {
      ornamentRef.current.rotation.y += dt * (0.8 + fx.charge * 3);
      ornamentRef.current.scale.set(0.1, 0.18, 0.1).multiplyScalar(1 + fx.burst * 0.6 + 0.15 * fx.pulse * fx.charge);
    }
    if (emitterRef.current) emitterRef.current.scale.setScalar(0.06 * (1 + fx.beam * 1.4 + fx.burst));

    const sparkleLevel = Math.min(1, fx.charge * 1.3 + fx.beam);
    mats.sparkle.opacity = sparkleLevel;
    tmp.copy(WHITE).lerp(fx.color, 0.5).multiplyScalar(2.2);
    mats.sparkle.color.copy(tmp);
    sparkleRefs.current.forEach((m, i) => {
      if (!m) return;
      const a = t * (0.9 + i * 0.25) + (i * Math.PI * 2) / 3;
      const r = 0.38 + 0.12 * Math.sin(t * 1.7 + i);
      m.position.set(x + Math.cos(a) * r, design.roofY + spireLen * (0.25 + 0.22 * i) + Math.sin(t * 2 + i) * 0.08, z + Math.sin(a) * r);
      m.rotation.y = t * 2 + i;
      m.visible = sparkleLevel > 0.02;
      m.scale.set(0.035, 0.07, 0.035).multiplyScalar(0.6 + sparkleLevel * 0.6);
    });
  });

  return (
    <group>
      {/* Glowing crown rims */}
      <mesh geometry={geo.crownRim} material={mats.crown} position={[x, topY + 0.01, z]} raycast={NO_RAYCAST} />
      {/* Rooftop structure */}
      <mesh
        geometry={GEOMETRIES.box}
        material={MATERIALS.building}
        position={[x, design.crown.y + design.crown.h / 2, z]}
        scale={[design.crown.w, design.crown.h, design.crown.d]}
        raycast={NO_RAYCAST}
      />
      <mesh geometry={geo.roofRim} material={mats.crown} position={[x, design.roofY + 0.005, z]} raycast={NO_RAYCAST} />
      {/* Antenna spire */}
      <mesh geometry={geo.spire} material={mats.spire} position={[x, design.roofY + spireLen / 2, z]} raycast={NO_RAYCAST} />
      <mesh
        ref={ornamentRef}
        geometry={GEOMETRIES.octa}
        material={mats.ornament}
        position={[x, design.roofY + spireLen * 0.42, z]}
        raycast={NO_RAYCAST}
      />
      <mesh ref={emitterRef} geometry={GEOMETRIES.sphere} material={mats.emitter} position={[x, design.spireTop, z]} raycast={NO_RAYCAST} />
      {/* Orbital rings */}
      <group ref={ringRef} position={[x, design.rings[0].y, z]}>
        <mesh geometry={geo.ring} material={mats.ring} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST} />
        <mesh geometry={geo.ringOuter} material={mats.ring2} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST} />
      </group>
      <group ref={arcRef} position={[x, design.rings[1].y, z]}>
        {geo.arcs.map((g, i) => (
          <mesh key={i} geometry={g} material={mats.ring2} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST} />
        ))}
      </group>
      {/* Floating diamonds around an active spire */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            sparkleRefs.current[i] = m;
          }}
          geometry={GEOMETRIES.octa}
          material={mats.sparkle}
          raycast={NO_RAYCAST}
        />
      ))}
    </group>
  );
}
