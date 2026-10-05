import { WORKERS } from '../data/workers';
import { useUi } from '../app/uiStore';
import { CityTrees, Ground, VaultFlows, VaultPaths } from '../three/Arena';
import { Sky, SkyDashes, Skyline } from '../three/CityBackground';
import { MarketWall } from '../three/MarketWall';
import { BILLBOARDS, NeonBillboard } from '../three/NeonBillboard';
import { ParticleField } from '../three/ParticleField';
import { TOWER_DESIGNS } from '../three/towerDesign';
import { CityLighting } from '../three/SceneLighting';
import { Track } from '../three/Track';
import { TradingTower } from '../three/TradingTower';
import { Vault } from '../three/Vault';

/** The miniature neon trading city. */
export function TradingCityScene({ active }: { active: boolean }) {
  const transition = useUi((s) => s.transition);
  // Hide DOM labels while flying into a tower.
  const showLabels = active && !(transition && transition.phase === 'out' && transition.from === 'city');
  return (
    <group visible={active}>
      <CityLighting />
      <Sky />
      <Ground />
      <MarketWall showLabels={showLabels} />
      <Skyline />
      <SkyDashes />
      {BILLBOARDS.map((b) => (
        <NeonBillboard key={b.text} {...b} />
      ))}
      {WORKERS.map((w) => (
        <TradingTower key={w.id} design={TOWER_DESIGNS[w.id]} showLabels={showLabels} />
      ))}
      <VaultPaths />
      <Vault showLabel={showLabels} />
      <VaultFlows />
      <CityTrees />
      <Track />
      <ParticleField />
    </group>
  );
}
