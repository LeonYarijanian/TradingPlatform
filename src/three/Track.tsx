import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { hdr, PALETTE } from './palette';
import { TRACK } from './layout';
import { TrackParticles } from './TrackParticles';
import { NO_RAYCAST } from './WindowsMesh';

/** Closed elliptical curve for the foreground monorail / data highway. */
export function trackCurve(inset = 0): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(TRACK.cx + Math.cos(a) * (TRACK.rx - inset), TRACK.y, TRACK.cz + Math.sin(a) * (TRACK.rz - inset)));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

const outerRail = new THREE.MeshBasicMaterial({ color: hdr(PALETTE.white, 2.8) });
const innerRail = new THREE.MeshBasicMaterial({ color: hdr('#8fdcff', 1.25) });
const deckMat = new THREE.MeshStandardMaterial({ color: '#0b0a26', roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });

/**
 * Large illuminated rail looping around the foreground. Its front arc passes
 * between the camera and the vault; luminous packets run clockwise on it.
 */
export function Track() {
  const geo = useMemo(() => {
    const outer = trackCurve(0);
    const inner = trackCurve(0.42);
    const deckCurve = trackCurve(0.21);
    const supports: THREE.Matrix4[] = [];
    const ties: THREE.Matrix4[] = [];
    const count = 72;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const u = i / count;
      const p = deckCurve.getPointAt(u);
      const tan = deckCurve.getTangentAt(u);
      const yaw = Math.atan2(tan.x, tan.z);
      if (i % 2 === 0) {
        supports.push(
          new THREE.Matrix4().compose(new THREE.Vector3(p.x, TRACK.y / 2 - 0.04, p.z), new THREE.Quaternion(), new THREE.Vector3(0.05, TRACK.y - 0.08, 0.05)),
        );
      }
      ties.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, TRACK.y - 0.035, p.z),
          new THREE.Quaternion().setFromAxisAngle(up, yaw),
          new THREE.Vector3(0.5, 0.025, 0.06),
        ),
      );
    }
    // Deck: flat ribbon between the rails.
    const deckPts = 256;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= deckPts; i++) {
      const u = (i % deckPts) / deckPts;
      const a = outer.getPointAt(u);
      const b = inner.getPointAt(u);
      positions.push(a.x, TRACK.y - 0.05, a.z, b.x, TRACK.y - 0.05, b.z);
      if (i < deckPts) {
        const k = i * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const deck = new THREE.BufferGeometry();
    deck.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    deck.setIndex(indices);
    deck.computeVertexNormals();

    return {
      outer: new THREE.TubeGeometry(outer, 512, 0.032, 6, true),
      inner: new THREE.TubeGeometry(inner, 512, 0.02, 5, true),
      deck,
      supports,
      ties,
      deckCurve,
      post: new THREE.CylinderGeometry(1, 1, 1, 6),
      tie: new THREE.BoxGeometry(1, 1, 1),
    };
  }, []);

  return (
    <group>
      <mesh geometry={geo.outer} material={outerRail} raycast={NO_RAYCAST} />
      <mesh geometry={geo.inner} material={innerRail} raycast={NO_RAYCAST} />
      <mesh geometry={geo.deck} material={deckMat} raycast={NO_RAYCAST} />
      <instancedMesh
        args={[geo.post, MATERIALS.support, geo.supports.length]}
        raycast={NO_RAYCAST}
        ref={(m) => {
          if (!m) return;
          geo.supports.forEach((mat, i) => m.setMatrixAt(i, mat));
          m.instanceMatrix.needsUpdate = true;
        }}
      />
      <instancedMesh
        args={[geo.tie, MATERIALS.support, geo.ties.length]}
        raycast={NO_RAYCAST}
        ref={(m) => {
          if (!m) return;
          geo.ties.forEach((mat, i) => m.setMatrixAt(i, mat));
          m.instanceMatrix.needsUpdate = true;
        }}
      />
      <TrackParticles curve={geo.deckCurve} />
    </group>
  );
}
