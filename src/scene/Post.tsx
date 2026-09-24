import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom, ToneMapping, Vignette, Noise } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { QualityLevel } from "../lib/quality";
import type { Look } from "../lib/look";
import { GraphicEffect } from "./GraphicEffect";
import { SpeedBlurEffect, SpeedLinesEffect, speedAmount } from "./SpeedEffects";
import { car } from "../lib/car";

// Chaine de post-traitement, isolee du reste de la scene parce qu'elle change
// avec le niveau de qualite (src/lib/quality.ts) et avec la direction
// artistique (src/lib/look.ts) : le MSAA de la cible HDR, la presence du grain
// et la passe de dessin en dependent.
//
// Deux details qui ne sont pas negociables dans l'ordre des passes :
//   - le tone mapping est fait ICI et non dans le renderer, sinon le bloom
//     travaille sur une image deja ecrasee et ne bave plus ;
//   - vignette, grain et dessin viennent APRES le tone mapping, donc en LDR, ou
//     ils ont le rendu attendu. Le grain est sans premultiply, sinon il
//     s'annule dans les noirs et la scene est majoritairement noire ; il trame
//     aussi le degrade du ciel, qui bandait legerement.
//
// Le look graphique coupe le grain, qui salirait les aplats, et adoucit la
// vignette : la passe de dessin prend sa place dans le budget, une passe pour
// une passe.
//
// La sensation de vitesse change aussi avec le look : flou radial en cine (une
// convolution, donc une passe a elle, coupee des la premiere descente de
// qualite), lignes de vitesse en graphique (fondues dans la passe de dessin).
//
// Le `key` sur le composer est volontaire : changer `multisampling` doit
// reconstruire les cibles de rendu, un simple changement de prop ne le fait pas.

export function Post({ level, look }: { level: QualityLevel; look: Look }) {
  const graphic = useMemo(() => new GraphicEffect(), []);
  const blur = useMemo(() => new SpeedBlurEffect(), []);
  const lines = useMemo(() => new SpeedLinesEffect(), []);
  const drawn = look === "graphique";
  const grain = level.grain && !drawn;
  const speedBlur = level.speedBlur && !drawn;
  const key = `${level.multisampling}-${grain}-${speedBlur}-${look}`;

  // la sensation de vitesse suit la voiture, lissee pour ne pas pomper
  useFrame((_, dt) => {
    const want = speedAmount(car.speed);
    for (const e of [blur, lines]) {
      const u = e.uniforms.get("amount")!;
      u.value += (want - u.value) * Math.min(1, dt * 4);
    }
  });
  // les enfants du composer sont types en elements stricts : pas de `&&`
  const passes = [
    <Bloom
      key="bloom"
      intensity={drawn ? 0.55 : 0.8}
      luminanceThreshold={drawn ? 0.5 : 0.38}
      luminanceSmoothing={0.9}
      mipmapBlur
    />,
    <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
  ];
  if (drawn) {
    passes.push(<primitive key="drawn" object={graphic} />);
    passes.push(<primitive key="lines" object={lines} />);
  }
  if (speedBlur) passes.push(<primitive key="blur" object={blur} />);
  passes.push(<Vignette key="vignette" opacity={drawn ? 0 : 1} offset={0.3} darkness={drawn ? 0.35 : 0.62} />);
  if (grain) passes.push(<Noise key="grain" opacity={0.045} />);
  return (
    <EffectComposer key={key} multisampling={level.multisampling}>
      {passes}
    </EffectComposer>
  );
}
