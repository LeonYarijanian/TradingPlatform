import { useAudioReactions } from './audio';
import { AppShell } from './AppShell';
import { useKeyboard } from './useKeyboard';
import { useSimulationLoop } from './useSimulationLoop';

export function App() {
  useSimulationLoop();
  useKeyboard();
  useAudioReactions();
  return <AppShell />;
}
