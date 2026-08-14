// Emballage three.js des canvas de facade. Separe de Buildings.tsx pour que
// les reperes (Landmarks.tsx) partagent EXACTEMENT les memes textures que les
// batiments courants : un Hotel de Ville en pierre doit lire avec la meme trame
// de fenetres que le reste du centre. Les canvas viennent de lib/facades.ts.

import * as THREE from "three";
import { ARCHETYPE_COUNT, Archetype, STYLES } from "./archetypes";
import { paintFacade, paintShopFront, type FacadeCanvas } from "./facades";

export type Painted = FacadeCanvas & {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
};

function wrap(albedo: HTMLCanvasElement, glow: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(albedo);
  const emissiveMap = new THREE.CanvasTexture(glow);
  for (const t of [map, emissiveMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { map, emissiveMap };
}

let paintedCache: Painted[] | null = null;
let shopCache: { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } | null = null;

/** Textures des 5 archetypes, une seule fois pour toute la scene. */
export function getFacadeTextures(): Painted[] {
  if (paintedCache) return paintedCache;
  const p: Painted[] = [];
  for (let i = 0; i < ARCHETYPE_COUNT; i++) {
    const f = paintFacade(STYLES[i as Archetype]);
    p.push({ ...f, ...wrap(f.albedo, f.glow) });
  }
  paintedCache = p;
  return p;
}

/** Texture du socle commercant, partagee. */
export function getShopTexture() {
  if (shopCache) return shopCache;
  const f = paintShopFront();
  shopCache = wrap(f.albedo, f.glow);
  return shopCache;
}
