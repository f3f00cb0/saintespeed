import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { QualityLevel } from "../lib/quality";
import { GraphicEffect } from "./GraphicEffect";
import { SpeedLinesEffect, speedAmount } from "./SpeedEffects";
import { car } from "../lib/car";

// Chaine de post-traitement de la nuit dessinee, isolee du reste de la scene
// parce qu'elle change avec le niveau de qualite (src/lib/quality.ts) : le MSAA
// de la cible HDR en depend.
//
// L'ordre des passes n'est pas negociable :
//   - le tone mapping est fait ICI et non dans le renderer, sinon le bloom
//     travaille sur une image deja ecrasee et ne bave plus ;
//   - le dessin (contours et aplats), les lignes de vitesse et la vignette
//     viennent APRES le tone mapping, donc en LDR, ou les aplats ont un sens.
//
// Le `key` sur le composer est volontaire : changer `multisampling` doit
// reconstruire les cibles de rendu, un simple changement de prop ne le fait pas.

export function Post({ level }: { level: QualityLevel }) {
  const graphic = useMemo(() => new GraphicEffect(), []);
  const lines = useMemo(() => new SpeedLinesEffect(), []);

  // les lignes de vitesse suivent la voiture, lissees pour ne pas pomper
  useFrame((_, dt) => {
    const u = lines.uniforms.get("amount")!;
    u.value += (speedAmount(car.speed) - u.value) * Math.min(1, dt * 4);
  });

  return (
    <EffectComposer key={level.multisampling} multisampling={level.multisampling}>
      <Bloom intensity={0.55} luminanceThreshold={0.5} luminanceSmoothing={0.9} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={graphic} />
      <primitive object={lines} />
      <Vignette offset={0.3} darkness={0.35} />
    </EffectComposer>
  );
}
