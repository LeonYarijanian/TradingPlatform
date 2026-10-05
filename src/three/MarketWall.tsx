import { Html, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SESSION_MINUTES } from '../data/demoRun';
import { WORKER_BY_ID } from '../data/workers';
import { formatPercent, formatPrice } from '../simulation/pnl';
import { getSim, marketBuffer } from '../simulation/simulationStore';
import type { Ticker } from '../types/trading';
import { FONT_MONO } from './fonts';
import { hdr, PALETTE, SIGNAL_COLORS } from './palette';
import { NO_RAYCAST } from './WindowsMesh';

/** Curved wall geometry (cylinder segment around the city). */
export const WALL = { cx: 0, cz: 6, radius: 52, a0: -0.95, a1: 0.95, y0: 0.5, y1: 22, chartY0: 3.2, chartY1: 15 };

function wallPoint(u: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = WALL.a0 + (WALL.a1 - WALL.a0) * u;
  return out.set(WALL.cx + Math.sin(a) * WALL.radius, y, WALL.cz - Math.cos(a) * WALL.radius);
}

const MAX_MARKERS = 48;
const MAX_POINTS = 420;

/**
 * Flat triangle-strip "fat line" lying on the curved wall surface. Updated in
 * place every frame (no allocations), width in world units.
 */
class WallRibbon {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly width: number,
    material: THREE.Material,
  ) {
    this.pos = new Float32Array(MAX_POINTS * 2 * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    this.geo.setIndex(index);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = NO_RAYCAST;
  }

  /** `us`/`ys` are wall coordinates (u along the arc, y height). */
  update(us: number[], ys: number[]): void {
    const n = Math.min(MAX_POINTS, us.length);
    const half = this.width / 2;
    const arcLen = (WALL.a1 - WALL.a0) * WALL.radius;
    const p = this.tmp;
    const o = this.pos;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      // Direction in (arc-length, y) space → in-surface perpendicular.
      const dt = (us[i1] - us[i0]) * arcLen;
      const dy = ys[i1] - ys[i0];
      const len = Math.hypot(dt, dy) || 1;
      const nt = (-dy / len) * half;
      const ny = (dt / len) * half;
      const du = nt / arcLen;
      wallPoint(us[i] + du, ys[i] + ny, p);
      o[i * 6] = p.x;
      o[i * 6 + 1] = p.y;
      o[i * 6 + 2] = p.z;
      wallPoint(us[i] - du, ys[i] - ny, p);
      o[i * 6 + 3] = p.x;
      o[i * 6 + 4] = p.y;
      o[i * 6 + 5] = p.z;
    }
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
const TICKER: Ticker = 'QQQ';
/** Map the session onto the part of the arc that is actually in view. */
const CHART_U0 = 0.21;
const CHART_U1 = 0.79;

function buildGrid() {
  const minor: number[] = [];
  const major: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const columns = 78;
  for (let i = 0; i <= columns; i++) {
    const u = i / columns;
    wallPoint(u, WALL.y0, a);
    wallPoint(u, WALL.y1, b);
    (i % 6 === 0 ? major : minor).push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const rows = 7;
  for (let r = 0; r <= rows; r++) {
    const y = WALL.chartY0 - 1.5 + ((WALL.chartY1 - WALL.chartY0 + 3) * r) / rows;
    for (let i = 0; i < 96; i++) {
      wallPoint(i / 96, y, a);
      wallPoint((i + 1) / 96, y, b);
      (r === 0 || r === rows ? major : minor).push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const g1 = new THREE.BufferGeometry();
  g1.setAttribute('position', new THREE.Float32BufferAttribute(minor, 3));
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(major, 3));
  return { minor: g1, major: g2 };
}

/** Floating price tag (DOM) — text is written directly for 60fps updates. */
function PriceTag({ ticker, refs }: { ticker: Ticker; refs: { price: React.RefObject<HTMLSpanElement | null>; chg: React.RefObject<HTMLSpanElement | null> } }) {
  return (
    <div className="wall-tag">
      <span className="wt-sym">{ticker}</span>
      <span className="wt-row">
        <span ref={refs.price} className="wt-price">
          —
        </span>
        <span ref={refs.chg} className="wt-chg">
          —
        </span>
      </span>
    </div>
  );
}

export function MarketWall({ showLabels }: { showLabels: boolean }) {
  const grid = useMemo(buildGrid, []);
  const gridMats = useMemo(
    () => ({
      minor: new THREE.LineBasicMaterial({ color: hdr('#5b3cff', 0.9), transparent: true, opacity: 0.22, fog: false, depthWrite: false }),
      major: new THREE.LineBasicMaterial({ color: hdr('#8a6bff', 1.1), transparent: true, opacity: 0.38, fog: false, depthWrite: false }),
    }),
    [],
  );

  const lines = useMemo(() => {
    const mk = (width: number, color: THREE.Color, opacity: number, additive = false) =>
      new WallRibbon(
        width,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          fog: false,
          side: THREE.DoubleSide,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        }),
      );
    return {
      main: mk(0.2, hdr('#ffffff', 2.8), 1),
      glow: mk(0.9, hdr('#8f7bff', 0.9), 0.4, true),
      vwap: mk(0.09, hdr(PALETTE.yellow, 1.1), 0.55),
    };
  }, []);

  const markerLines = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_MARKERS * 6), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_MARKERS * 6), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
    return { geo, mat };
  }, []);
  const nodeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), []);
  const nodeGeo = useMemo(() => new THREE.SphereGeometry(0.16, 12, 8), []);
  const nodesRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const headLabelRef = useRef<THREE.Group>(null);

  const range = useRef({ lo: 0, hi: 0, day: -1 });
  const tags = {
    QQQ: { price: useRef<HTMLSpanElement>(null), chg: useRef<HTMLSpanElement>(null) },
    SPY: { price: useRef<HTMLSpanElement>(null), chg: useRef<HTMLSpanElement>(null) },
    IWM: { price: useRef<HTMLSpanElement>(null), chg: useRef<HTMLSpanElement>(null) },
  };
  const lastTag = useRef(0);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const mtx = useMemo(() => new THREE.Matrix4(), []);
  const callColor = useMemo(() => hdr(SIGNAL_COLORS.CALL.shell, 2.2), []);
  const putColor = useMemo(() => hdr(SIGNAL_COLORS.PUT.shell, 2.2), []);

  const timeLabels = useMemo(
    () =>
      ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00'].map((label, i) => {
        const minute = 30 + i * 60;
        const u = CHART_U0 + (CHART_U1 - CHART_U0) * (minute / SESSION_MINUTES);
        const p = wallPoint(u, WALL.chartY0 - 1.3);
        const a = WALL.a0 + (WALL.a1 - WALL.a0) * u;
        return { label, p, rotY: -a };
      }),
    [],
  );

  useFrame((state) => {
    const sim = getSim();
    const day = sim.clock.dayIndex;
    const dayStart = day * SESSION_MINUTES;
    const now = dayStart + sim.clock.minute;
    const pts = marketBuffer.window(TICKER, dayStart, dayStart + SESSION_MINUTES - 1);
    const live = sim.prices[TICKER].price;

    // Smoothed vertical range for the current session.
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.price, p.vwap);
      hi = Math.max(hi, p.price, p.vwap);
    }
    if (live > 0) {
      lo = Math.min(lo, live);
      hi = Math.max(hi, live);
    }
    if (!Number.isFinite(lo)) {
      lo = live - 1;
      hi = live + 1;
    }
    const pad = Math.max(0.6, (hi - lo) * 0.18);
    lo -= pad;
    hi += pad;
    const r = range.current;
    if (r.day !== day || r.hi === 0) {
      r.lo = lo;
      r.hi = hi;
      r.day = day;
    } else {
      r.lo += (lo - r.lo) * 0.08;
      r.hi += (hi - r.hi) * 0.08;
    }
    const yOf = (price: number) => WALL.chartY0 + ((price - r.lo) / Math.max(0.01, r.hi - r.lo)) * (WALL.chartY1 - WALL.chartY0);
    const uOf = (ts: number) => CHART_U0 + (CHART_U1 - CHART_U0) * Math.min(1, Math.max(0, (ts - dayStart) / SESSION_MINUTES));

    const us: number[] = [];
    const ys: number[] = [];
    const vus: number[] = [];
    const vys: number[] = [];
    for (const p of pts) {
      us.push(uOf(p.timestamp));
      ys.push(yOf(p.price));
      vus.push(uOf(p.timestamp));
      vys.push(yOf(p.vwap));
    }
    if (live > 0 && !sim.clock.finished) {
      us.push(uOf(now));
      ys.push(yOf(live));
    }
    lines.main.update(us, ys);
    lines.glow.update(us, ys);
    lines.vwap.update(vus, vys);
    const headU = us.length ? us[us.length - 1] : CHART_U0;
    const headY = ys.length ? ys[ys.length - 1] : WALL.chartY0;
    wallPoint(headU, headY, tmp);
    const hx = tmp.x;
    const hy = tmp.y;
    const hz = tmp.z;

    // Head node + label.
    if (headRef.current) {
      headRef.current.position.set(hx, hy, hz);
      headRef.current.scale.setScalar(0.32 + 0.08 * Math.sin(state.clock.elapsedTime * 5));
    }
    if (headLabelRef.current) headLabelRef.current.position.set(hx, hy + 1.6, hz);

    // Trade entry nodes + vertical marker lines for QQQ workers.
    const markers = sim.markers.filter((m) => m.kind === 'entry' && m.timestamp >= dayStart && WORKER_BY_ID[m.workerId].ticker === TICKER).slice(-MAX_MARKERS);
    const nodes = nodesRef.current;
    const mpos = markerLines.geo.attributes.position as THREE.BufferAttribute;
    const mcol = markerLines.geo.attributes.color as THREE.BufferAttribute;
    markers.forEach((m, i) => {
      const u = uOf(m.timestamp);
      wallPoint(u, yOf(m.price), tmp);
      const c = m.direction === 'CALL' ? callColor : putColor;
      if (nodes) {
        mtx.makeTranslation(tmp.x, tmp.y, tmp.z);
        nodes.setMatrixAt(i, mtx);
        nodes.setColorAt(i, c);
      }
      mpos.setXYZ(i * 2, tmp.x, WALL.chartY0 - 1.5, tmp.z);
      mpos.setXYZ(i * 2 + 1, tmp.x, tmp.y, tmp.z);
      mcol.setXYZ(i * 2, c.r * 0.15, c.g * 0.15, c.b * 0.15);
      mcol.setXYZ(i * 2 + 1, c.r * 0.6, c.g * 0.6, c.b * 0.6);
    });
    if (nodes) {
      nodes.count = markers.length;
      nodes.instanceMatrix.needsUpdate = true;
      if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
    }
    markerLines.geo.setDrawRange(0, markers.length * 2);
    mpos.needsUpdate = true;
    mcol.needsUpdate = true;

    // Price tags (~12 Hz).
    if (state.clock.elapsedTime - lastTag.current > 0.08) {
      lastTag.current = state.clock.elapsedTime;
      for (const t of ['QQQ', 'SPY', 'IWM'] as Ticker[]) {
        const ps = sim.prices[t];
        const refs = tags[t];
        if (refs.price.current) refs.price.current.textContent = ps.price > 0 ? formatPrice(ps.price) : '—';
        if (refs.chg.current) {
          refs.chg.current.textContent = ps.price > 0 ? formatPercent(ps.changePct) : '';
          refs.chg.current.className = `wt-chg ${ps.changePct < 0 ? 'neg' : 'pos'}`;
        }
      }
    }
  });

  return (
    <group>
      <lineSegments geometry={grid.minor} material={gridMats.minor} raycast={NO_RAYCAST} />
      <lineSegments geometry={grid.major} material={gridMats.major} raycast={NO_RAYCAST} />
      <primitive object={lines.glow.mesh} />
      <primitive object={lines.vwap.mesh} />
      <primitive object={lines.main.mesh} />
      <lineSegments geometry={markerLines.geo} material={markerLines.mat} raycast={NO_RAYCAST} />
      <instancedMesh
        ref={(m) => {
          nodesRef.current = m;
          if (m) {
            m.count = 0;
            m.setColorAt(0, callColor);
          }
        }}
        args={[nodeGeo, nodeMat, MAX_MARKERS]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
      />
      <mesh ref={headRef} raycast={NO_RAYCAST}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={hdr('#ffffff', 4)} fog={false} />
      </mesh>
      {timeLabels.map((t) => (
        <Text
          key={t.label}
          font={FONT_MONO}
          fontSize={0.8}
          position={t.p}
          rotation={[0, t.rotY, 0]}
          anchorX="center"
          anchorY="middle"
          color="#8f84d8"
          fillOpacity={0.75}
          raycast={NO_RAYCAST}
        >
          {t.label}
        </Text>
      ))}
      {showLabels && (
        <>
          <group ref={headLabelRef}>
            <Html center zIndexRange={[6, 2]} pointerEvents="none">
              <PriceTag ticker="QQQ" refs={tags.QQQ} />
            </Html>
          </group>
          <Html position={wallPoint(0.8, WALL.chartY0 + 3.2).toArray()} center zIndexRange={[6, 2]} pointerEvents="none">
            <PriceTag ticker="SPY" refs={tags.SPY} />
          </Html>
          <Html position={wallPoint(0.2, WALL.chartY0 + 3.2).toArray()} center zIndexRange={[6, 2]} pointerEvents="none">
            <PriceTag ticker="IWM" refs={tags.IWM} />
          </Html>
        </>
      )}
    </group>
  );
}
