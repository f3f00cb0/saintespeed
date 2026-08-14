import { EffectComposer, Bloom, ToneMapping, Vignette, Noise } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { QualityLevel } from "../lib/quality";

// Chaine de post-traitement, isolee du reste de la scene parce qu'elle change
// avec le niveau de qualite (src/lib/quality.ts) : le MSAA de la cible HDR et la
// presence du grain dependent de la frame mediane mesuree.
//
// Deux details qui ne sont pas negociables dans l'ordre des passes :
//   - le tone mapping est fait ICI et non dans le renderer, sinon le bloom
//     travaille sur une image deja ecrasee et ne bave plus ;
//   - vignette et grain viennent APRES le tone mapping, donc en LDR, ou ils ont
//     le rendu photographique attendu. Le grain est sans premultiply, sinon il
//     s'annule dans les noirs et la scene est majoritairement noire ; il trame
//     aussi le degrade du ciel, qui bandait legerement.
//
// Le `key` sur le composer est volontaire : changer `multisampling` doit
// reconstruire les cibles de rendu, un simple changement de prop ne le fait pas.

const bloom = (
  <Bloom intensity={0.8} luminanceThreshold={0.38} luminanceSmoothing={0.9} mipmapBlur />
);
const tone = <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />;
const vignette = <Vignette offset={0.3} darkness={0.62} />;

export function Post({ level }: { level: QualityLevel }) {
  const key = `${level.multisampling}-${level.grain}`;
  if (!level.grain) {
    return (
      <EffectComposer key={key} multisampling={level.multisampling}>
        {bloom}
        {tone}
        {vignette}
      </EffectComposer>
    );
  }
  return (
    <EffectComposer key={key} multisampling={level.multisampling}>
      {bloom}
      {tone}
      {vignette}
      <Noise opacity={0.045} />
    </EffectComposer>
  );
}
