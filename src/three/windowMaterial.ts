import * as THREE from 'three';

const vertex = /* glsl */ `
attribute vec3 aColor;
attribute float aSeed;
uniform float uTime;
uniform float uBoost;
uniform float uTwinkle;
varying vec3 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float r = fract(aSeed * 13.17);
  float tw = 1.0;
  // ~3% of windows twinkle on/off slowly.
  if (r > 0.97 && uTwinkle > 0.5) {
    float slot = floor(uTime * (0.25 + r * 0.6) + aSeed * 7.0);
    tw = mix(0.18, 1.0, step(0.45, fract(sin(slot * 12.9898 + aSeed * 78.233) * 43758.5453)));
  }
  vColor = aColor * tw * uBoost;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragment = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec2 d = abs(vUv - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.7, 1.0, max(d.x, d.y));
  gl_FragColor = vec4(vColor * (0.55 + 0.45 * edge), 1.0);
  #include <fog_fragment>
}
`;

export function createWindowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uBoost: { value: 1 }, uTwinkle: { value: 1 } },
    ]),
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: true,
    side: THREE.FrontSide,
  });
}
