import { useEffect, useLayoutEffect, useRef } from 'react';
import { useUi } from '../app/uiStore';
import { easeOutCubic, formatMoney } from '../simulation/pnl';

interface Props {
  value: number;
  format?: (v: number) => string;
  /** Tween duration in ms (odometer feel). */
  duration?: number;
  className?: string;
  /** Start counting from this value on first mount. */
  from?: number;
}

/**
 * Odometer-style number. Writes straight to the DOM node so rapid P&L updates
 * never trigger React re-renders mid-tween.
 */
export function CountUp({ value, format = formatMoney, duration = 550, className, from }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef(from ?? value);
  const reduced = useUi((s) => s.reducedMotion);
  const formatRef = useRef(format);
  formatRef.current = format;

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = formatRef.current(current.current);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = current.current;
    const target = value;
    if (start === target || reduced || duration <= 0) {
      current.current = target;
      el.textContent = formatRef.current(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const v = start + (target - start) * easeOutCubic(k);
      current.current = k >= 1 ? target : v;
      el.textContent = formatRef.current(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  return <span ref={ref} className={className} />;
}
