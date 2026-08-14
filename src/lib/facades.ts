// Facades procedurales : aucune texture n'est embarquee, tout est peint dans un
// canvas. Une texture par archetype, la couleur du mur venant du vertex color,
// la trame de fenetres de la texture.
//
// Ce module est volontairement sans three.js : il ne produit que des canvas,
// ce qui permet a la planche de comparaison (reference/board.ts) de peindre
// exactement les memes facades que le jeu, a cote des photos du vrai
// Saint-Etienne. Le jeu emballe ces canvas en CanvasTexture, rien de plus.
//
// Les UV sont en metres et pas normalisees, ce qui aligne les rangees de
// fenetres sur les etages quelle que soit la taille du batiment. La tuile
// horizontale vaut "bays" travees, elle change donc d'un archetype a l'autre :
// c'est ce qui donne au grand ensemble sa trame serree et a l'atelier ses
// grandes ouvertures, gratuitement, sans texture plus lourde.
//
// Le rez-de-chaussee n'est pas une rangee de la tuile. Il l'a ete, et le
// RepeatWrapping vertical faisait donc reapparaitre la vitrine au sixieme etage
// sur les 189 emprises de plus de 18,6 m. La tuile ne contient plus que des
// etages courants, tous interchangeables, et le socle commercant est une
// geometrie separee posee sur les seuls batiments que la donnee OSM designe
// comme commercants.

import { type ArchetypeStyle } from "./archetypes";
import { FLOOR } from "./buildings";

export { FLOOR }; // hauteur d'etage, utile aussi a la planche de comparaison

export const FLOORS_PER_TILE = 6;
export const CELL_PX = 96; // un etage et une travee font 3,1 m, la texture reste carree

// Coin de mur nu reserve en haut a gauche de chaque texture. L'acrotere et les
// bandeaux de toit y pointent pour ne pas heriter de fenetres.
export const PATCH_PX = 12;

export const TILE_V = FLOOR * FLOORS_PER_TILE; // 18,6 m de haut par tuile de texture

function seeded(seed: number): number {
  let x = (seed | 0) ^ 0x85ebca6b;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

export type FacadeCanvas = {
  albedo: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  /** Largeur d'une tuile de texture en metres, propre a l'archetype. */
  tileU: number;
  /** Point UV du carre de mur nu. */
  patch: [number, number];
};

/** Facade d'un archetype, en canvas purs. */
export function paintFacade(style: ArchetypeStyle): FacadeCanvas {
  const w = style.bays * CELL_PX;
  const h = FLOORS_PER_TILE * CELL_PX;

  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = w;
  albedo.height = glow.height = h;
  const a = albedo.getContext("2d")!;
  const g = glow.getContext("2d")!;

  a.fillStyle = "#ffffff"; // blanc : la couleur vient du vertex color
  a.fillRect(0, 0, w, h);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, w, h);

  const [winW, winH] = style.win;

  for (let iy = 0; iy < FLOORS_PER_TILE; iy++) {
    for (let ix = 0; ix < style.bays; ix++) {
      const ox = ix * CELL_PX;
      const oy = iy * CELL_PX;
      const seed = ix * 73 + iy * 149 + style.bays * 1013;

      a.fillStyle = `rgba(0,0,0,${(0.02 + seeded(seed * 3) * 0.05).toFixed(3)})`;
      a.fillRect(ox, oy, CELL_PX, CELL_PX);

      // nez de dalle en bas de chaque etage, donne la lecture horizontale
      a.fillStyle = "rgba(0,0,0,0.20)";
      a.fillRect(ox, oy + CELL_PX * 0.94, CELL_PX, CELL_PX * 0.06);

      const lit = seeded(seed) < style.litRatio;
      const ww = CELL_PX * winW;
      const wh = CELL_PX * winH;
      const wx = ox + (CELL_PX - ww) / 2;
      const wy = oy + CELL_PX * 0.22;

      a.fillStyle = style.frame;
      a.globalAlpha = 0.55;
      a.fillRect(wx - CELL_PX * 0.03, wy - CELL_PX * 0.04, ww + CELL_PX * 0.06, wh + CELL_PX * 0.08);
      a.globalAlpha = 1;

      const [glass, halo] =
        style.warm[Math.floor(seeded(seed * 5) * style.warm.length) % style.warm.length];
      a.fillStyle = lit ? glass : style.dark;
      a.fillRect(wx, wy, ww, wh);

      a.fillStyle = lit ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.45)";
      a.fillRect(wx + ww / 2 - CELL_PX * 0.012, wy, CELL_PX * 0.024, wh);
      a.fillStyle = "rgba(255,255,255,0.10)";
      a.fillRect(wx - CELL_PX * 0.02, wy + wh, ww + CELL_PX * 0.04, CELL_PX * 0.025);

      if (lit) {
        g.fillStyle = halo;
        g.globalAlpha = 0.4 + seeded(seed * 17) * 0.45;
        g.fillRect(wx, wy, ww, wh);
        g.globalAlpha = 1;
      }
    }
  }

  a.fillStyle = "rgba(0,0,0,0.10)";
  a.fillRect(0, 0, PATCH_PX, PATCH_PX);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, PATCH_PX, PATCH_PX);

  return {
    albedo,
    glow,
    tileU: style.bays * FLOOR,
    patch: [PATCH_PX / 2 / w, 1 - PATCH_PX / 2 / h],
  };
}

// --- socle commercant -------------------------------------------------------
export const SHOP_BAYS = 3;
export const SHOP_TILE_U = SHOP_BAYS * FLOOR;

export function paintShopFront(): { albedo: HTMLCanvasElement; glow: HTMLCanvasElement } {
  const w = SHOP_BAYS * CELL_PX;
  const h = CELL_PX;
  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = w;
  albedo.height = glow.height = h;
  const a = albedo.getContext("2d")!;
  const g = glow.getContext("2d")!;

  a.fillStyle = "#2a2620";
  a.fillRect(0, 0, w, h);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, w, h);

  for (let ix = 0; ix < SHOP_BAYS; ix++) {
    const ox = ix * CELL_PX;
    const seed = ix * 977 + 31;
    const lit = seeded(seed) < 0.72;
    const wx = ox + CELL_PX * 0.1;
    const wy = h * 0.28;
    const ww = CELL_PX * 0.8;
    const wh = h * 0.5;

    a.fillStyle = lit ? "#ffca7a" : "#1b1913";
    a.fillRect(wx, wy, ww, wh);
    a.fillStyle = "rgba(0,0,0,0.35)";
    a.fillRect(wx + ww / 2 - CELL_PX * 0.015, wy, CELL_PX * 0.03, wh);
    a.fillStyle = "#211d18";
    a.fillRect(ox, h * 0.06, CELL_PX, h * 0.16);

    if (lit) {
      g.fillStyle = "#ffca7a";
      g.globalAlpha = 0.7 + seeded(seed * 7) * 0.3;
      g.fillRect(wx, wy, ww, wh);
      g.globalAlpha = 1;
    }
  }

  return { albedo, glow };
}
