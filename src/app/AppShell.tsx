import { useUi } from './uiStore';
import { SceneRoot } from '../scenes/SceneRoot';
import { mountLabelLayer } from '../three/labelLayer';
import { DebugPanel } from '../ui/DebugPanel';
import { EventTicker } from '../ui/EventTicker';
import { LoadingScreen } from '../ui/LoadingScreen';
import { PerformanceSummary } from '../ui/PerformanceSummary';
import { SceneControls } from '../ui/SceneControls';
import { StationOverlay } from '../ui/StationOverlay';
import { TopHUD } from '../ui/TopHUD';
import { TradingTimeline } from '../ui/TradingTimeline';
import { TransitionFlash } from '../ui/TransitionFlash';
import { WorkerDetailCard } from '../ui/WorkerDetailCard';

/** Layered layout: 3D scene, in-world labels, HUD chrome, overlays. */
export function AppShell() {
  const summaryOpen = useUi((s) => s.summaryOpen);
  const scene = useUi((s) => s.scene);
  return (
    <div className={`app scene-${scene} ${summaryOpen ? 'summary-open' : ''}`}>
      <main className="scene-layer" aria-label="Neon trading city">
        <SceneRoot />
        <div className="label-layer-host" ref={mountLabelLayer} />
      </main>
      <TransitionFlash />
      <div className="hud-layer">
        <TopHUD />
        <SceneControls />
        <WorkerDetailCard />
        <StationOverlay />
        <footer className="bottom-dock">
          <TradingTimeline />
          <EventTicker />
        </footer>
      </div>
      <DebugPanel />
      <PerformanceSummary />
      <LoadingScreen />
    </div>
  );
}
