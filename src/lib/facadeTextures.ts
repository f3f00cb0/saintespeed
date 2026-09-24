// Emballage three.js des canvas de facade. Separe de Buildings.tsx pour que
// les reperes (Landmarks.tsx) partagent EXACTEMENT les memes textures que les
// batiments courants : un Hotel de Ville en pierre doit lire avec la meme trame
// de fenetres que le reste du centre. Les canvas viennent de lib/facades.ts.

import * as THREE from "three";
import { ARCHETYPE_COUNT, Archetype, STYLES } from "./archetypes";
import { paintFacade, paintShopFront, type FacadeCanvas } from "./facades";
import { LAYER_H, LAYER_W, VARIANTS, paintVariant } from "./facadeVariants";

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

// --- variantes : un tableau de textures, un calque par variante --------------
//
// Vingt-quatre textures separees couteraient jusqu'a vingt-quatre draw calls
// par tuile. Empilees en calques d'un seul tableau, elles tiennent dans UN
// materiau : chaque sommet porte son numero de calque, et le shader des murs
// (makeFacadeMaterial) va lire le bon. La lueur des fenetres passe dans l'alpha
// du calque, ce qui divise la memoire par deux : l'emissif reprend la couleur
// du verre allume, a peine plus pale que le halo d'avant.

export type FacadeArray = {
  texture: THREE.DataArrayTexture;
  layers: number;
};

let arrayCache: FacadeArray | null = null;

export function getFacadeArray(): FacadeArray {
  if (arrayCache) return arrayCache;
  const n = VARIANTS.length;
  const stride = LAYER_W * LAYER_H * 4;
  const data = new Uint8Array(stride * n);
  for (let i = 0; i < n; i++) {
    const { albedo, glow } = paintVariant(i);
    const A = albedo.getContext("2d")!.getImageData(0, 0, LAYER_W, LAYER_H).data;
    const G = glow.getContext("2d")!.getImageData(0, 0, LAYER_W, LAYER_H).data;
    // Un tableau de textures ne se retourne pas a l'envoi (flipY) : on range
    // les lignes du bas vers le haut a la main, pour que v = 1 reste le haut
    // du canvas, comme pour les CanvasTexture du reste de la scene.
    for (let y = 0; y < LAYER_H; y++) {
      const src = (LAYER_H - 1 - y) * LAYER_W * 4;
      const dst = i * stride + y * LAYER_W * 4;
      for (let x = 0; x < LAYER_W * 4; x += 4) {
        data[dst + x] = A[src + x];
        data[dst + x + 1] = A[src + x + 1];
        data[dst + x + 2] = A[src + x + 2];
        data[dst + x + 3] = Math.max(G[src + x], G[src + x + 1], G[src + x + 2]);
      }
    }
  }
  const texture = new THREE.DataArrayTexture(data, LAYER_W, LAYER_H, n);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  arrayCache = { texture, layers: n };
  return arrayCache;
}

/**
 * Materiau des murs a variantes : un Lambert dont la texture et l'emissif
 * viennent du tableau. Attributs attendus : `uv` en tuiles, `aFacade` =
 * (calque, gain emissif). Un seul materiau pour toute la ville : le programme
 * n'est compile qu'une fois.
 */
export function makeFacadeMaterial(arr: FacadeArray): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.facadeArr = { value: arr.texture };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aFacade;\nvarying vec2 vFacadeUv;\nflat varying float vFacadeLayer;\nflat varying float vFacadeGlow;",
      )
      .replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvFacadeUv = uv;\nvFacadeLayer = aFacade.x;\nvFacadeGlow = aFacade.y;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform highp sampler2DArray facadeArr;\nvarying vec2 vFacadeUv;\nflat varying float vFacadeLayer;\nflat varying float vFacadeGlow;",
      )
      .replace(
        "#include <map_fragment>",
        "vec4 facadeTexel = texture(facadeArr, vec3(vFacadeUv, vFacadeLayer));\ndiffuseColor.rgb *= facadeTexel.rgb;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        // la couleur du verre est plus pale que l'ancien halo : l'elever a la
        // puissance 1,7 la resature (le rouge reste a 1, le bleu s'effondre),
        // sinon le tone mapping blanchit toutes les fenetres
        "totalEmissiveRadiance = pow(facadeTexel.rgb, vec3(1.7)) * facadeTexel.a * vFacadeGlow;",
      );
  };
  m.customProgramCacheKey = () => "facade-variants";
  return m;
}
