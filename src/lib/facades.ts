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

// --- la lumiere des interieurs ----------------------------------------------
//
// Les teintes chaudes de l'archetype restent la majorite : c'est ce qui fait
// la lecture nocturne, et le froid de la Moderne ne vient que de lui. Mais une
// ville de nuit n'est pas un seul tungstene : on y voit des LED blanches, le
// bleu d'une tele, quelques rideaux colores. Tire par fenetre, seede, donc la
// meme a chaque chargement.
const LED: [string, string] = ["#eef3f8", "#c4d6ea"];
const TV: [string, string] = ["#c9d3f5", "#7188e8"];
const CURTAINS: [string, string][] = [
  // rabattus : un rideau filtre, il ne brille pas comme un neon
  ["#f6cdbd", "#d98466"],
  ["#dcebcf", "#9cc281"],
  ["#e7d6f0", "#ae8fcc"],
];

function interior(style: ArchetypeStyle, seed: number): [string, string] {
  const r = seeded(seed * 11);
  if (r < 0.18) return LED;
  if (r < 0.22) return TV;
  if (r < 0.26) return CURTAINS[Math.floor(seeded(seed * 19) * CURTAINS.length) % CURTAINS.length];
  return style.warm[Math.floor(seeded(seed * 5) * style.warm.length) % style.warm.length];
}

/** Fraction de la baie masquee par un store, 0 si la baie est degagee. */
function blindOf(seed: number): number {
  if (seeded(seed * 13) >= 0.22) return 0;
  return 0.3 + seeded(seed * 23) * 0.4;
}

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

      const [glass, halo] = interior(style, seed);
      a.fillStyle = lit ? glass : style.dark;
      a.fillRect(wx, wy, ww, wh);

      // store a demi baisse : le haut de la baie reste sombre, rayé de lames
      const blind = lit ? blindOf(seed) : 0;
      if (blind > 0) {
        const bh = wh * blind;
        a.fillStyle = "rgba(20,16,12,0.55)";
        a.fillRect(wx, wy, ww, bh);
        a.fillStyle = "rgba(255,255,255,0.08)";
        for (let k = 0; k < bh - 2; k += 4) a.fillRect(wx, wy + k, ww, 1);
      }

      a.fillStyle = lit ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.45)";
      a.fillRect(wx + ww / 2 - CELL_PX * 0.012, wy, CELL_PX * 0.024, wh);
      a.fillStyle = "rgba(255,255,255,0.10)";
      a.fillRect(wx - CELL_PX * 0.02, wy + wh, ww + CELL_PX * 0.04, CELL_PX * 0.025);

      if (lit) {
        g.fillStyle = halo;
        g.globalAlpha = 0.4 + seeded(seed * 17) * 0.45;
        g.fillRect(wx, wy + wh * blind, ww, wh * (1 - blind));
        if (blind > 0) {
          // la lumiere filtre encore un peu a travers les lames
          g.globalAlpha *= 0.18;
          g.fillRect(wx, wy, ww, wh * blind);
        }
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
//
// Huit travees, et chaque batiment tire son decalage de tuile : deux commerces
// voisins ne montrent plus la meme devanture. Le bandeau au dessus de la vitrine
// porte une enseigne une fois sur deux, lumineuse, donc dans les deux canvas :
// neon a lettres, caisson colore, ou la croix verte de pharmacie, le repere de
// nuit le plus francais qui soit.
export const SHOP_BAYS = 8;
export const SHOP_TILE_U = SHOP_BAYS * FLOOR;

const NEON = ["#ff3d6e", "#3de0ff", "#ffd23d", "#ff7a2e", "#b86bff", "#f2efe6"];

type Sign = "neon" | "caisson" | "pharmacie" | null;
// Sur huit travees seulement, un tirage au hasard ne sortait aucune pharmacie :
// la sequence est donc fixee, une enseigne sur deux environ, et c'est le
// decalage par batiment qui la fait tourner.
const SIGNS: Sign[] = ["neon", null, "caisson", "pharmacie", null, "neon", null, "caisson"];

/** Enseigne dans le bandeau [x, y, w, h], peinte dans l'albedo et la lueur. */
function paintSign(
  a: CanvasRenderingContext2D,
  g: CanvasRenderingContext2D,
  kind: Exclude<Sign, null>,
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (kind === "pharmacie") {
    // croix de pharmacie : elle deborde du bandeau, comme les vraies
    const c = h * 2;
    const t = c / 3;
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (const ctx of [a, g]) {
      ctx.fillStyle = "#35ff7a";
      ctx.fillRect(cx - c / 2, cy - t / 2, c, t);
      ctx.fillRect(cx - t / 2, cy - c / 2, t, c);
    }
    return;
  }
  const color = NEON[Math.floor(seeded(seed * 31) * NEON.length) % NEON.length];
  if (kind === "neon") {
    // lettres au neon : une suite de traits de largeurs variees
    let cx = x + w * (0.08 + seeded(seed * 37) * 0.12);
    const end = x + w * 0.92;
    let k = 0;
    while (cx < end) {
      const lw = h * (0.35 + seeded(seed * 41 + k) * 0.45);
      if (cx + lw > end) break;
      for (const ctx of [a, g]) {
        ctx.fillStyle = color;
        ctx.fillRect(cx, y + h * 0.18, lw, h * 0.64);
      }
      // l'evidement de la lettre
      a.fillStyle = "#211d18";
      g.fillStyle = "#000000";
      a.fillRect(cx + lw * 0.3, y + h * 0.36, lw * 0.4, h * 0.28);
      g.fillRect(cx + lw * 0.3, y + h * 0.36, lw * 0.4, h * 0.28);
      cx += lw + h * (0.15 + (seeded(seed * 43 + k) < 0.2 ? 0.5 : 0));
      k++;
    }
    return;
  }
  // caisson lumineux : fond colore, texte sombre
  for (const ctx of [a, g]) {
    ctx.fillStyle = color;
    ctx.fillRect(x + w * 0.1, y, w * 0.8, h);
  }
  a.fillStyle = "rgba(20,18,14,0.75)";
  g.fillStyle = "rgba(0,0,0,0.75)";
  for (let k = 0; k < 5; k++) {
    const bx = x + w * (0.2 + k * 0.12);
    a.fillRect(bx, y + h * 0.3, w * 0.08, h * 0.4);
    g.fillRect(bx, y + h * 0.3, w * 0.08, h * 0.4);
  }
}

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
    // vitrines : la plupart tungstene, quelques unes en LED froide
    const glass = seeded(seed * 3) < 0.3 ? "#e6eef6" : "#ffca7a";

    a.fillStyle = lit ? glass : "#1b1913";
    a.fillRect(wx, wy, ww, wh);
    a.fillStyle = "rgba(0,0,0,0.35)";
    a.fillRect(wx + ww / 2 - CELL_PX * 0.015, wy, CELL_PX * 0.03, wh);
    a.fillStyle = "#211d18";
    a.fillRect(ox, h * 0.06, CELL_PX, h * 0.16);

    if (lit) {
      g.fillStyle = glass;
      g.globalAlpha = 0.7 + seeded(seed * 7) * 0.3;
      g.fillRect(wx, wy, ww, wh);
      g.globalAlpha = 1;
    }
    const sign = SIGNS[ix];
    if (sign) {
      paintSign(a, g, sign, seed, ox + CELL_PX * 0.04, h * 0.075, CELL_PX * 0.92, h * 0.13);
    }
  }

  return { albedo, glow };
}
