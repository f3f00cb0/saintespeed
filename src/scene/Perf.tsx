import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

// Sonde de mesure. N'affiche rien, ne coute rien : elle expose seulement le
// renderer, la scene et la camera sur window.
//
// Pourquoi elle existe : dans un onglet qui n'est pas au premier plan, le
// navigateur gele requestAnimationFrame. Le canvas reste noir et le compteur de
// fps affiche zero, ce qui imite parfaitement un bug de rendu alors que tout va
// bien. Impossible, dans cet etat, de mesurer quoi que ce soit par la boucle de
// rendu normale.
//
// Avec cette sonde on peut piloter le rendu a la main depuis la console ou
// depuis l'automatisation : placer la camera, appeler render(), lire
// gl.info.render. On obtient des draw calls et des temps de frame reels sans
// dependre de rAF. C'est la seule facon mesuree, et non supposee, de savoir ou
// est le goulot.

declare global {
  interface Window {
    __saintespeed?: {
      gl: unknown;
      scene: unknown;
      camera: unknown;
    };
  }
}

export function Perf() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    window.__saintespeed = { gl, scene, camera };
    return () => {
      delete window.__saintespeed;
    };
  }, [gl, scene, camera]);

  return null;
}
