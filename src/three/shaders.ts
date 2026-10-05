import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Charge aura — translucent fresnel energy shield                     */
/* ------------------------------------------------------------------ */

export function createAuraMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#36FFB8') },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uCharge: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uCharge;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        float f = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
        float rim = pow(f, 2.4);
        // Horizontal energy bands sliding upward.
        float bands = 0.5 + 0.5 * sin(vLocal.y * 14.0 - uTime * (2.0 + uCharge * 5.0));
        // Latitude/longitude shimmer.
        float lon = atan(vLocal.z, vLocal.x);
        float shimmer = 0.5 + 0.5 * sin(lon * 9.0 + uTime * 1.3 + vLocal.y * 4.0);
        float fill = 0.05 + 0.05 * bands;
        float a = (rim * (0.9 + 0.35 * shimmer) + fill + rim * bands * 0.25) * uOpacity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/* ------------------------------------------------------------------ */
/* Beam — scrolling volumetric light column                            */
/* ------------------------------------------------------------------ */

export function createBeamMaterial(kind: 'core' | 'shell' | 'glow'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#ffffff') },
      uIntensity: { value: 0 },
      uGrow: { value: 0 },
      uTime: { value: 0 },
      uFlicker: { value: 1 },
      uKind: { value: kind === 'core' ? 0 : kind === 'shell' ? 1 : 2 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uGrow;
      uniform float uTime;
      uniform float uFlicker;
      uniform float uKind;
      varying vec2 vUv;
      varying float vFacing;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float v = vUv.y;
        if (v > uGrow) discard;
        float tip = smoothstep(uGrow, uGrow - 0.04, v);
        float fadeTop = 1.0 - smoothstep(0.35, 1.0, v);
        float fadeBottom = smoothstep(0.0, 0.015, v);
        float n = noise(vec2(vUv.x * 7.0, v * 38.0 - uTime * 7.0));
        float n2 = noise(vec2(vUv.x * 3.0 + 5.0, v * 12.0 - uTime * 3.0));
        float scroll = mix(1.0, 0.55 + 0.75 * n * n2 * 1.6, uFlicker);
        float pulse = mix(1.0, 0.85 + 0.15 * sin(uTime * 22.0 + v * 30.0), uFlicker);
        float profile;
        if (uKind < 0.5) profile = pow(vFacing, 0.6);
        else if (uKind < 1.5) profile = pow(vFacing, 2.2) * 0.85;
        else profile = pow(vFacing, 3.0) * 0.35;
        float a = profile * fadeTop * fadeBottom * tip * uIntensity * scroll * pulse;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/* ------------------------------------------------------------------ */
/* Shockwave ring                                                      */
/* ------------------------------------------------------------------ */

export function createShockwaveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.78, 0.94, r) * (1.0 - smoothstep(0.94, 1.0, r));
        float inner = smoothstep(0.2, 0.9, r) * 0.18 * (1.0 - smoothstep(0.9, 1.0, r));
        gl_FragColor = vec4(uColor * (ring + inner) * uOpacity, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/* ------------------------------------------------------------------ */
/* GPU sparks — rising particles driven by a single "age" uniform      */
/* ------------------------------------------------------------------ */

export function createSparkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAge: { value: 99 },
      uColor: { value: new THREE.Color('#ffffff') },
      uPixelRatio: { value: 1 },
      uSize: { value: 26 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uAge;
      uniform float uPixelRatio;
      uniform float uSize;
      varying float vAlpha;
      void main() {
        float delay = fract(aSeed * 7.31) * 0.5;
        float t = max(0.0, uAge - delay);
        float life = 0.9 + fract(aSeed * 3.7) * 0.9;
        float k = clamp(t / life, 0.0, 1.0);
        float ang = aSeed * 6.2831;
        float spread = 0.15 + fract(aSeed * 5.1) * 0.55;
        vec3 p = position;
        p.x += cos(ang) * spread * (0.3 + k);
        p.z += sin(ang) * spread * (0.3 + k);
        p.y += k * (1.5 + fract(aSeed * 11.3) * 3.5);
        vAlpha = (t > 0.0 ? 1.0 : 0.0) * (1.0 - k) * smoothstep(0.0, 0.08, t);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uPixelRatio * (0.4 + fract(aSeed * 2.3)) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(uColor * a * 2.5, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/* ------------------------------------------------------------------ */
/* Ground grid with distance fade                                      */
/* ------------------------------------------------------------------ */

export function createGridMaterial(opts: { color: string; base: string; scale: number; fade: number; lineWidth?: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(opts.color) },
        uBase: { value: new THREE.Color(opts.base) },
        uScale: { value: opts.scale },
        uFade: { value: opts.fade },
        uWidth: { value: opts.lineWidth ?? 1.0 },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uBase;
      uniform float uScale;
      uniform float uFade;
      uniform float uWidth;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 g = vWorld.xz / uScale;
        vec2 grid = abs(fract(g - 0.5) - 0.5) / fwidth(g);
        float line = 1.0 - min(min(grid.x, grid.y) / uWidth, 1.0);
        vec2 g2 = vWorld.xz / (uScale * 5.0);
        vec2 grid2 = abs(fract(g2 - 0.5) - 0.5) / fwidth(g2);
        float major = 1.0 - min(min(grid2.x, grid2.y) / (uWidth * 1.4), 1.0);
        float dist = length(vWorld.xz - vec2(0.0, 2.0));
        float fade = 1.0 - smoothstep(uFade * 0.25, uFade, dist);
        vec3 col = uBase + uColor * (line * 0.35 + major * 0.6) * fade;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
    fog: true,
  });
}

/* ------------------------------------------------------------------ */
/* Sky gradient dome                                                   */
/* ------------------------------------------------------------------ */

export function createSkyMaterial(top: string, horizon: string, glow: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
      uGlow: { value: new THREE.Color(glow) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));
        float band = exp(-pow((h - 0.04) * 9.0, 2.0));
        col += uGlow * band * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/** Animated dashes flowing along a ribbon (vault feeder paths). */
export function createFlowMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uBoost;
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float dash = step(0.55, fract(vUv.x * 9.0 - uTime * 0.9));
        float base = 0.18 + 0.6 * dash;
        float a = across * base * (1.0 + uBoost * 2.5);
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
