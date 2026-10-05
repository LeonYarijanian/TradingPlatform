import { useEffect, useRef, useState } from 'react';
import { useSim, type SimulationStore } from '../simulation/simulationStore';

/**
 * Subscribe to a slice of the simulation store, but re-render at most every
 * `ms` milliseconds — keeps fast-forward replays from flooding React.
 */
export function useThrottledSim<T>(selector: (s: SimulationStore) => T, ms = 120): T {
  const [value, setValue] = useState(() => selector(useSim.getState()));
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  useEffect(() => {
    let last = 0;
    let timer = 0;
    let pending = false;
    const flush = () => {
      pending = false;
      last = performance.now();
      setValue(selectorRef.current(useSim.getState()));
    };
    const unsub = useSim.subscribe((state, prev) => {
      if (selectorRef.current(state) === selectorRef.current(prev)) return;
      const now = performance.now();
      if (now - last >= ms) flush();
      else if (!pending) {
        pending = true;
        timer = window.setTimeout(flush, ms - (now - last));
      }
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [ms]);
  return value;
}
