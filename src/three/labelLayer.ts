/**
 * One stable DOM container for every in-world (drei `Html`) label.
 *
 * Without it, drei picks its mount target at render time and switches it once
 * R3F connects its event layer, tearing down and recreating each label's React
 * root on the same element — which React reports as a removeChild error.
 */
function createLayer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.className = 'label-layer';
  return el;
}

export const labelPortal = { current: createLayer() } as { current: HTMLDivElement };

/** Ref callback that parks the label layer inside the scene layer. */
export function mountLabelLayer(host: HTMLDivElement | null): void {
  if (host && labelPortal.current && labelPortal.current.parentNode !== host) host.appendChild(labelPortal.current);
}
