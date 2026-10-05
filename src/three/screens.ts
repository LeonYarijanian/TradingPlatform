import { SESSION_MINUTES } from '../data/demoRun';
import { WORKER_BY_ID } from '../data/workers';
import { formatClock24, formatSessionTime } from '../simulation/calendar';
import { formatMoney, formatPrice } from '../simulation/pnl';
import type { SimData } from '../simulation/reducer';
import { marketBuffer } from '../simulation/simulationStore';
import type { WorkerId } from '../types/trading';
import { ARROW, statusLine } from '../ui/format';

const MONO = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace';
const DISPLAY = '"Space Grotesk", "Inter", system-ui, sans-serif';

const C = {
  bg: '#05060f',
  grid: 'rgba(120, 110, 255, 0.10)',
  gridStrong: 'rgba(140, 130, 255, 0.22)',
  text: '#e9ecff',
  dim: 'rgba(200, 205, 255, 0.55)',
  price: '#ffffff',
  vwap: '#ffbe3d',
  ema: '#b79cff',
  green: '#63ff9a',
  mint: '#5dffda',
  red: '#ff365f',
  magenta: '#ff267a',
  yellow: '#ffd247',
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function scanlines(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

/* ------------------------------------------------------------------ */
/* Main chart: QQQ · 1-MIN with VWAP / EMA50 / markers                 */
/* ------------------------------------------------------------------ */

export function drawChartScreen(ctx: CanvasRenderingContext2D, w: number, h: number, sim: SimData, workerId: WorkerId, time: number): void {
  const cfg = WORKER_BY_ID[workerId];
  const ticker = cfg.ticker;
  const dayStart = sim.clock.dayIndex * SESSION_MINUTES;
  const now = dayStart + sim.clock.minute;
  const span = 75;
  const pts = marketBuffer.window(ticker, now - span, now);
  const live = sim.prices[ticker].price;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.4, 10, w * 0.5, h * 0.4, w * 0.7);
  glow.addColorStop(0, 'rgba(60, 40, 180, 0.18)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Header.
  ctx.font = `700 34px ${DISPLAY}`;
  ctx.fillStyle = C.text;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${ticker} · 1-MIN · ${formatClock24(sim.clock.minute)}`, 34, 42);
  ctx.font = `600 22px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = C.ema;
  ctx.fillText('EMA50', w - 34, 42);
  const emaW = ctx.measureText('EMA50').width;
  ctx.fillStyle = C.vwap;
  ctx.fillText('VWAP', w - 34 - emaW - 26, 42);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(140,130,255,0.35)';
  ctx.fillRect(34, 74, w - 68, 1.5);

  const plot = { x: 34, y: 96, w: w - 160, h: h - 160 };
  if (pts.length < 2) {
    ctx.font = `500 24px ${MONO}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('waiting for market data…', plot.x, plot.y + 40);
    scanlines(ctx, w, h);
    return;
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.price, p.vwap, p.ema50);
    hi = Math.max(hi, p.price, p.vwap, p.ema50);
  }
  if (live > 0) {
    lo = Math.min(lo, live);
    hi = Math.max(hi, live);
  }
  const pad = Math.max(0.15, (hi - lo) * 0.12);
  lo -= pad;
  hi += pad;
  const x0 = now - span;
  const X = (ts: number) => plot.x + ((ts - x0) / span) * plot.w;
  const Y = (v: number) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;

  // Grid + y labels.
  ctx.lineWidth = 1;
  ctx.font = `500 18px ${MONO}`;
  for (let i = 0; i <= 5; i++) {
    const y = plot.y + (plot.h * i) / 5;
    ctx.strokeStyle = i === 0 || i === 5 ? C.gridStrong : C.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    const v = hi - ((hi - lo) * i) / 5;
    ctx.fillStyle = C.dim;
    ctx.fillText(formatPrice(v), plot.x + plot.w + 14, y);
  }
  for (let m = Math.ceil(x0 / 15) * 15; m <= now; m += 15) {
    const x = X(m);
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    const minute = ((m % SESSION_MINUTES) + SESSION_MINUTES) % SESSION_MINUTES;
    ctx.fillStyle = C.dim;
    ctx.fillText(formatSessionTime(minute), x - 26, plot.y + plot.h + 26);
  }

  const series = (key: 'price' | 'vwap' | 'ema50', color: string, width: number, withLive: boolean) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = X(p.timestamp);
      const y = Y(p[key]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (withLive && live > 0) ctx.lineTo(X(now), Y(live));
    ctx.stroke();
  };
  series('vwap', C.vwap, 3, false);
  series('ema50', C.ema, 3, false);
  ctx.shadowColor = 'rgba(255,255,255,0.7)';
  ctx.shadowBlur = 8;
  series('price', C.price, 3.2, true);
  ctx.shadowBlur = 0;

  // Trade markers.
  const markers = sim.markers.filter((m) => WORKER_BY_ID[m.workerId].ticker === ticker && m.timestamp >= x0 && m.timestamp <= now);
  for (const m of markers) {
    const x = X(m.timestamp);
    const y = Y(m.price);
    const mine = m.workerId === workerId;
    const age = now - m.timestamp;
    const fresh = mine && m.kind === 'entry' && age < 3 ? 1 + 0.6 * Math.abs(Math.sin(time * 10)) : 1;
    if (m.kind === 'entry') {
      const up = m.direction === 'CALL';
      const color = up ? C.green : C.red;
      const s = (mine ? 13 : 9) * fresh;
      const ty = up ? y + 22 : y - 22;
      ctx.fillStyle = color;
      ctx.globalAlpha = mine ? 1 : 0.55;
      ctx.beginPath();
      if (up) {
        ctx.moveTo(x, ty - s);
        ctx.lineTo(x - s, ty + s * 0.8);
        ctx.lineTo(x + s, ty + s * 0.8);
      } else {
        ctx.moveTo(x, ty + s);
        ctx.lineTo(x - s, ty - s * 0.8);
        ctx.lineTo(x + s, ty - s * 0.8);
      }
      ctx.closePath();
      ctx.fill();
      if (fresh > 1) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, ty, s * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (mine) {
      ctx.fillStyle = (m.pnl ?? 0) >= 0 ? C.green : C.red;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Live point + price bubble.
  const lp = live > 0 ? live : pts[pts.length - 1].price;
  const lx = X(now);
  const ly = Y(lp);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(lx, ly, 6 + 2 * Math.sin(time * 6), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(plot.x + plot.w, ly);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `700 22px ${MONO}`;
  const label = formatPrice(lp);
  const bw = ctx.measureText(label).width + 22;
  roundRect(ctx, plot.x + plot.w + 6, ly - 17, bw, 34, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#05060f';
  ctx.fillText(label, plot.x + plot.w + 17, ly + 1);

  scanlines(ctx, w, h);
}

/* ------------------------------------------------------------------ */
/* Signal scanner + THOUGHTS                                           */
/* ------------------------------------------------------------------ */

export function drawScannerScreen(ctx: CanvasRenderingContext2D, w: number, h: number, sim: SimData, workerId: WorkerId, time: number): void {
  const cfg = WORKER_BY_ID[workerId];
  const rt = sim.workers[workerId];
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillStyle = C.green;
  ctx.shadowColor = 'rgba(99,255,154,0.8)';
  ctx.shadowBlur = 14;
  ctx.fillText('SIGNAL SCANNER', 30, 46);
  ctx.shadowBlur = 0;
  ctx.font = `600 20px ${MONO}`;
  ctx.fillStyle = C.dim;
  ctx.fillText(`${cfg.displayName} · ${cfg.strategy}`, 30, 84);

  const charging = rt.status === 'charging' || rt.status === 'ready';
  const inTrade = rt.status === 'firing' || rt.status === 'managing' || rt.status === 'trailing';
  const dir = rt.direction ?? rt.position?.direction ?? null;
  ctx.font = `600 25px ${MONO}`;
  let setup: string;
  if (charging && dir) setup = `${cfg.setupName} ${ARROW[dir]} ${dir} · ${rt.atrAway.toFixed(2)} ATR away`;
  else if (inTrade && dir) setup = `IN TRADE ${ARROW[dir]} ${dir} x${rt.position?.contracts ?? ''} @ ${rt.position?.entryPrice.toFixed(2) ?? ''}`;
  else if (rt.status === 'off-duty') setup = 'off duty · market closed';
  else setup = `${cfg.setupName} · scanning · ${rt.atrAway.toFixed(2)} ATR away`;
  ctx.fillStyle = charging ? (dir === 'PUT' ? C.magenta : C.mint) : inTrade ? C.yellow : C.text;
  ctx.fillText(setup, 30, 132, w - 60);

  // Charge bar.
  const pct = charging ? rt.charge : inTrade ? 100 : rt.status === 'scanning' ? rt.charge : 0;
  const barY = 166;
  const barW = w - 60;
  roundRect(ctx, 30, barY, barW, 30, 8);
  ctx.fillStyle = 'rgba(120,110,255,0.12)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,150,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (pct > 0) {
    const fillColor = dir === 'PUT' ? C.magenta : C.green;
    const grad = ctx.createLinearGradient(30, 0, 30 + barW, 0);
    grad.addColorStop(0, 'rgba(93,255,218,0.5)');
    grad.addColorStop(1, fillColor);
    roundRect(ctx, 32, barY + 2, Math.max(8, (barW - 4) * (pct / 100)), 26, 7);
    ctx.fillStyle = dir === 'PUT' ? fillColor : grad;
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = rt.status === 'ready' ? 18 + 10 * Math.sin(time * 14) : 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Segment ticks.
    ctx.fillStyle = 'rgba(5,6,15,0.55)';
    for (let i = 1; i < 20; i++) ctx.fillRect(30 + (barW * i) / 20, barY + 2, 2, 26);
  }
  ctx.font = `700 24px ${MONO}`;
  ctx.fillStyle = pct >= 100 ? C.yellow : C.text;
  const chargedLabel = inTrade ? 'FIRED · position live' : `${Math.round(pct)}% CHARGED`;
  ctx.fillText(chargedLabel, 30, barY + 58);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.dim;
  ctx.font = `500 20px ${MONO}`;
  ctx.fillText(statusLine(rt).toUpperCase(), w - 30, barY + 58);
  ctx.textAlign = 'left';

  // THOUGHTS log.
  const logTop = barY + 104;
  ctx.font = `700 26px ${DISPLAY}`;
  ctx.fillStyle = C.text;
  ctx.fillText('THOUGHTS', 30, logTop);
  ctx.fillStyle = 'rgba(140,130,255,0.3)';
  ctx.fillRect(30, logTop + 22, w - 60, 1.5);

  const thoughts = sim.thoughts[workerId];
  const lineH = 37;
  const maxLines = Math.floor((h - logTop - 48) / lineH);
  ctx.font = `500 22px ${MONO}`;
  thoughts.slice(0, maxLines).forEach((entry, i) => {
    const y = logTop + 56 + i * lineH;
    if (i === 0) {
      ctx.fillStyle = 'rgba(99,255,154,0.08)';
      ctx.fillRect(22, y - lineH / 2 + 2, w - 44, lineH - 4);
    }
    ctx.globalAlpha = Math.max(0.35, 1 - i * 0.06);
    ctx.fillStyle = C.dim;
    ctx.fillText(formatSessionTime(entry.minute).padStart(5, ' '), 30, y);
    ctx.fillStyle =
      entry.tone === 'profit' ? C.green : entry.tone === 'loss' ? C.red : entry.tone === 'warn' ? '#ff8fb0' : entry.tone === 'action' ? '#ffffff' : 'rgba(225,228,255,0.8)';
    ctx.fillText(entry.text, 120, y, w - 150);
    ctx.globalAlpha = 1;
  });
  if (thoughts.length === 0) {
    ctx.fillStyle = C.dim;
    ctx.fillText('…watching the tape', 30, logTop + 56);
  }
  scanlines(ctx, w, h);
}

/* ------------------------------------------------------------------ */
/* Side panel: position / P&L                                          */
/* ------------------------------------------------------------------ */

export function drawPositionScreen(ctx: CanvasRenderingContext2D, w: number, h: number, sim: SimData, workerId: WorkerId, time: number): void {
  const cfg = WORKER_BY_ID[workerId];
  const rt = sim.workers[workerId];
  const day = sim.days[sim.clock.dayIndex];
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.fillStyle = cfg.accent;
  ctx.fillText(cfg.displayName, 28, 40);
  ctx.font = `500 19px ${MONO}`;
  ctx.fillStyle = C.dim;
  ctx.fillText(day ? `${day.label} · ${formatSessionTime(sim.clock.minute)} ET` : '', 28, 74);

  const rows: Array<[string, string, string]> = [
    ['EARNED', formatMoney(rt.earned), rt.earned >= 0 ? C.green : C.red],
    ['TODAY', formatMoney(rt.todayPnl), rt.todayPnl >= 0 ? C.green : C.red],
    ['TRADES', `${rt.tradesToday} today · ${rt.wins}W ${rt.losses}L`, C.text],
    [
      'POSITION',
      rt.position ? `${ARROW[rt.position.direction]} ${rt.position.direction} x${rt.position.contracts} @ ${rt.position.entryPrice.toFixed(2)}` : 'flat',
      rt.position ? (rt.position.direction === 'CALL' ? C.mint : C.magenta) : C.dim,
    ],
  ];
  rows.forEach(([k, v, color], i) => {
    const y = 124 + i * 52;
    ctx.font = `600 18px ${MONO}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(k, 28, y);
    ctx.font = `700 25px ${MONO}`;
    ctx.fillStyle = color;
    ctx.fillText(v, 160, y, w - 180);
  });

  // Mini equity sparkline from day results.
  const days = sim.days.filter((d) => d.status !== 'pending');
  const base = h - 62;
  const sw = w - 56;
  ctx.strokeStyle = 'rgba(140,130,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(28, base);
  ctx.lineTo(28 + sw, base);
  ctx.stroke();
  const max = Math.max(1, ...days.map((d) => d.pnl));
  const bw = sw / 23;
  days.forEach((d, i) => {
    const bh = Math.max(2, (d.pnl / max) * 70);
    ctx.fillStyle = d.pnl >= 0 ? (d.status === 'active' ? `rgba(99,255,154,${0.6 + 0.4 * Math.sin(time * 5)})` : C.green) : C.red;
    ctx.fillRect(28 + i * bw + 2, base - bh, bw - 4, bh);
  });
  scanlines(ctx, w, h);
}
