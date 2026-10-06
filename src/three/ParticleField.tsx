import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useUi } from '../app/uiStore';
import { createRng, hashSeed, range } from '../simulation/rng';
import { NO_RAYCAST } from './WindowsMesh';

const DEFAULT_BOUNDS = { x: [-22, 22], y: [0.3, 16], z: [-16, 14] } as Props['bounds'] & object;

interface Props {
  count?: number;
  bounds?: { x: [number, number]; y: [number, number]; z: [number, number] };
  color?: string;
  size?: number;
}

/** Glowing dust motes drifting through the scene (GPU-animated). */
export function ParticleField({ count = 320, bounds = DEFAULT_BOUNDS, color = '#b9a6ff', size = 34 }: Props) {
  const lowPower = useUi((s) => s.lowPower);
  const reduced = useUi((s) => s.reducedMotion);
  const dpr = useThree((s) => s.viewport.dpr);
  const n = lowPower ? Math.round(count * 0.45) : count;
  const geometry = useMemo(() => {
    const rng = createRng(hashSeed(`dust:${n}`));
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = range(rng, bounds.x[0], bounds.x[1]);
      pos[i * 3 + 1] = range(rng, bounds.y[0], bounds.y[1]);
      pos[i * 3 + 2] = range(rng, bounds.z[0], bounds.z[1]);
      seed[i] = rng();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [n, bounds]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(color).multiplyScalar(1.6) },
          uSize: { value: size },
          uPixelRatio: { value: 1 },
          uHeight: { value: bounds.y[1] - bounds.y[0] },
        },
        vertexShader: /* glsl */ `
          attribute float aSeed;
          uniform float uTime;
          uniform float uSize;
          uniform float uPixelRatio;
          uniform float uHeight;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            float t = uTime * (0.08 + aSeed * 0.12);
            p.y = position.y + mod(t * 3.0 + aSeed * uHeight, uHeight) - uHeight * 0.5;
            p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.6;
            p.z += cos(uTime * 0.25 + aSeed * 23.0) * 0.6;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uSize * uPixelRatio * (0.35 + aSeed * 0.8) / max(-mv.z, 0.1);
            vAlpha = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 30.0));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
            gl_FragColor = vec4(uColor * a, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [color, size, bounds],
  );

  useFrame((state) => {
    material.uniforms.uTime.value = reduced ? 0 : state.clock.elapsedTime;
    material.uniforms.uPixelRatio.value = dpr;
  });

  return <points geometry={geometry} material={material} raycast={NO_RAYCAST} frustumCulled={false} />;
}
