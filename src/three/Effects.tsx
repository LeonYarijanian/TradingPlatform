import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useUi } from '../app/uiStore';

/** Bloom on HDR emissives, filmic tone mapping, soft vignette. */
export function Effects() {
  const lowPower = useUi((s) => s.lowPower);
  const scene = useUi((s) => s.scene);
  return (
    <EffectComposer multisampling={lowPower ? 0 : 4} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        intensity={lowPower ? 1.15 : scene === 'city' ? 1.55 : 1.3}
        luminanceThreshold={0.6}
        luminanceSmoothing={0.28}
        radius={0.74}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette eskil={false} offset={0.24} darkness={0.72} />
    </EffectComposer>
  );
}
