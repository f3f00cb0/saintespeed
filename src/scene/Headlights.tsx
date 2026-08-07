import { useMemo } from "react";
import * as THREE from "three";

// Faisceau projete au sol devant la voiture. La chaussee est en
// MeshBasicMaterial et n'est donc eclairee par aucune lumiere : on triche avec
// un quad additif texture, c'est le truc arcade classique et ca coute un
// triangle. Le quad vit dans le repere de la voiture, il suit donc le cap tout
// seul.

const LENGTH = 46; // portee du faisceau, en metres
const WIDTH = 24;
const PX = 256;

function makeBeamTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = PX;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(PX, PX);
  const d = img.data;

  for (let j = 0; j < PX; j++) {
    // v : position laterale, -1 a gauche, +1 a droite
    const lateral = (j / (PX - 1)) * 2 - 1;
    for (let i = 0; i < PX; i++) {
      // u : distance vers l'avant, 0 au pare-chocs, 1 au bout de la portee
      const u = i / (PX - 1);

      // les deux faisceaux s'ecartent avec la distance
      const spread = 0.1 + 0.62 * u;
      const halfW = 0.14 + 0.5 * u;
      let v = 0;
      for (const side of [-1, 1]) {
        const dx = (lateral - side * spread) / halfW;
        v += Math.exp(-dx * dx * 2.2);
      }

      // montee courte devant le capot, puis extinction progressive
      const near = Math.min(1, u / 0.07);
      const far = Math.pow(Math.max(0, 1 - u), 1.7);
      const a = Math.min(1, v * 0.62) * near * far;

      const o = (j * PX + i) * 4;
      d[o] = 255;
      d[o + 1] = 244;
      d[o + 2] = 214;
      d[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Headlights() {
  const beam = useMemo(makeBeamTexture, []);

  return (
    <mesh
      // a plat sur la chaussee, decale vers l'avant de la voiture.
      // Le plan est cree en X = longueur et Y = largeur, puis bascule a plat :
      // Y devient Z, donc l'axe U de la texture suit bien l'avant du vehicule.
      position={[LENGTH / 2 + 1.6, -0.31, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[LENGTH, WIDTH]} />
      <meshBasicMaterial
        map={beam}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}
