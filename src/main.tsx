import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './styles/variables.css';
import './styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useUi } from './app/uiStore';
import { liveFeeds, startLiveCity } from './live';
import { useLive } from './live/liveStore';
import { engine, resetRun } from './simulation/controller';
import { connectSource, SSEEventSource, WebSocketEventSource } from './simulation/liveSources';
import { usePlayback, useSim } from './simulation/simulationStore';

// Live city (inside claude.ai, or #live): real accounts drive the towers.
// ?ws=wss://… or ?sse=https://…: an external backend streams BotEvents.
// Otherwise prime the store with the deterministic demo run.
const live = useUi.getState().live;
if (live?.kind === 'claude') {
  startLiveCity();
} else if (live) {
  connectSource(live.kind === 'ws' ? new WebSocketEventSource(live.url) : new SSEEventSource(live.url));
} else {
  resetRun();
}

// Dev-only handle for scripted visual checks (never shipped in production builds).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ntc = { engine, useUi, useSim, usePlayback, useLive, liveFeeds };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
