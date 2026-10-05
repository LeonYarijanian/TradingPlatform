import { TRANSITION_IN_MS, TRANSITION_OUT_MS } from '../app/transitions';
import { useUi } from '../app/uiStore';

/** Bloom-style warp flash that hides the scene swap. */
export function TransitionFlash() {
  const t = useUi((s) => s.transition);
  const phase = t?.phase ?? 'idle';
  const style = {
    ['--out' as string]: `${TRANSITION_OUT_MS}ms`,
    ['--in' as string]: `${TRANSITION_IN_MS}ms`,
  };
  return <div className={`transition-flash phase-${phase} to-${t?.to ?? 'none'}`} style={style} aria-hidden />;
}
