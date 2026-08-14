import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import {
  LEVELS, QUALITY_NAMES, WARMUP, WINDOW, medianFrame, nextQuality, type Quality,
} from "../lib/quality";

// Cablage de la descente de qualite. La politique est dans src/lib/quality.ts ;
// ici on ne fait que mesurer les frames et appliquer le cran suivant.
//
// Le composant ne rend rien. Il vit dans le Canvas parce que la mesure doit
// venir de la boucle de rendu elle-meme, pas d'un timer : c'est la duree de
// frame qui compte, y compris le temps GPU que le navigateur nous fait attendre
// a la presentation.

export function AutoQuality({
  quality,
  onDrop,
}: {
  quality: Quality;
  onDrop: (q: Quality) => void;
}) {
  const setDpr = useThree((s) => s.setDpr);
  const times = useRef<number[]>([]);
  const warm = useRef(0);

  useFrame((_, dt) => {
    // Les frames de chauffe ne comptent pas : chargement, compilation des
    // shaders, reconstruction du composer apres un changement de niveau.
    if (warm.current < WARMUP) {
      warm.current++;
      return;
    }

    times.current.push(dt * 1000);
    if (times.current.length < WINDOW) return;

    const med = medianFrame(times.current);
    const next = nextQuality(quality, times.current);
    times.current.length = 0;
    if (next === quality) return;

    console.log(
      `qualite: ${QUALITY_NAMES[quality]} -> ${QUALITY_NAMES[next]} ` +
        `(frame mediane ${med.toFixed(1)} ms, budget depasse) ` +
        `msaa ${LEVELS[next].multisampling}, dpr max ${LEVELS[next].dprMax}, ` +
        `grain ${LEVELS[next].grain ? "oui" : "non"}`,
    );
    warm.current = 0; // la bascule elle-meme coute quelques frames
    setDpr(Math.min(window.devicePixelRatio, LEVELS[next].dprMax));
    onDrop(next);
  });

  return null;
}
