import type { WorkerRuntime, WorkerStatus } from '../types/trading';

export const ARROW = { CALL: '▲', PUT: '▼' } as const;

export const STATUS_LABEL: Record<WorkerStatus, string> = {
  watching: 'watching',
  scanning: 'scanning',
  charging: 'charging',
  ready: 'ready',
  firing: 'FIRE',
  managing: 'managing',
  trailing: 'trailing',
  cooldown: 'cooldown',
  'off-duty': 'off duty',
};

/** "charging ▲ CALL 38%", "FIRE ▼ PUT x7", "watching" … */
export function statusLine(w: WorkerRuntime): string {
  const dir = w.direction ?? w.position?.direction ?? null;
  const tag = dir ? `${ARROW[dir]} ${dir}` : '';
  switch (w.status) {
    case 'charging':
      return `charging ${tag} ${Math.round(w.charge)}%`;
    case 'ready':
      return `ready ${tag} ${Math.round(w.charge)}%`;
    case 'firing':
      return `FIRE ${tag}${w.position ? ` x${w.position.contracts}` : ''}`;
    case 'managing':
      return `managing ${tag}${w.position ? ` x${w.position.contracts}` : ''}`;
    case 'trailing':
      return `trailing stop ${tag}`;
    case 'scanning':
      return w.charge > 1 ? `scanning · setup fading` : 'scanning';
    default:
      return STATUS_LABEL[w.status];
  }
}

/** Visual tone for a worker's current state. */
export function statusTone(w: WorkerRuntime): 'call' | 'put' | 'fire' | 'idle' | 'off' {
  if (w.status === 'off-duty') return 'off';
  const dir = w.direction ?? w.position?.direction;
  if (w.status === 'firing') return 'fire';
  if (dir && ['charging', 'ready', 'managing', 'trailing'].includes(w.status)) return dir === 'CALL' ? 'call' : 'put';
  return 'idle';
}

export function statusDot(status: WorkerStatus): string {
  if (status === 'charging' || status === 'ready') return '◌';
  if (status === 'off-duty') return '○';
  return '●';
}
