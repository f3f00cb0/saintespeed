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
  // rabattus, et plus encore depuis le dessin : les aplats du rendu remontent
  // la saturation, et le violet ressortait comme un neon
  ["#f3d6c8", "#c99a84"],
  ["#dfe8d6", "#a9b89a"],
  ["#e6dde8", "#a99cad"],
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
// Une seule texture, donc un seul materiau et un seul draw call par tuile, mais
// quatre rangees de huit devantures empilees : chaque batiment tire sa rangee
// et son decalage de travee (Buildings.tsx), donc deux commerces voisins ne se
// ressemblent pas. Les devantures sont composees a la main, pas tirees au
// hasard : sur si peu de travees un tirage sortait trop souvent la meme chose,
// et la croix de pharmacie, repere fort, devenait banale. Elle n'apparait plus
// que sur une devanture sur trente-deux.
export const SHOP_BAYS = 8;
export const SHOP_VARIANTS = 4;
export const SHOP_TILE_U = SHOP_BAYS * FLOOR;

type Vitrine =
  | "epicerie"
  | "boutique"
  | "bar"
  | "boulangerie"
  | "laverie"
  | "agence"
  | "rideau"
  | "sombre";
type Sign = "neon" | "caisson" | "lettres" | "tabac" | "pharmacie" | null;

const SHOPS: [Vitrine, Sign][][] = [
  [
    ["epicerie", "neon"], ["boutique", null], ["rideau", null], ["bar", "lettres"],
    ["agence", "caisson"], ["sombre", null], ["boulangerie", "lettres"], ["boutique", "neon"],
  ],
  [
    ["bar", "neon"], ["rideau", null], ["laverie", "caisson"], ["boutique", "lettres"],
    ["bar", "tabac"], ["sombre", null], ["epicerie", "caisson"], ["rideau", null],
  ],
  [
    ["boutique", "caisson"], ["agence", "neon"], ["rideau", null], ["agence", "pharmacie"],
    ["sombre", null], ["bar", "lettres"], ["boulangerie", null], ["epicerie", "neon"],
  ],
  [
    ["rideau", null], ["boulangerie", "lettres"], ["boutique", "neon"], ["sombre", null],
    ["bar", "neon"], ["agence", "caisson"], ["rideau", null], ["laverie", null],
  ],
];

const NEON = ["#ff3d6e", "#3de0ff", "#ffd23d", "#ff7a2e", "#b86bff", "#f2efe6", "#5dff9a"];
const BOX = ["#e8433a", "#2f7de0", "#f2c230", "#f2efe6", "#1fa37a", "#9a4be0"];

/** Lumiere de la vitrine : [verre, lueur], null quand elle est eteinte. */
const LIGHT: Record<Vitrine, [string, string] | null> = {
  epicerie: ["#f4efe2", "#e9e2cc"],
  boutique: ["#ffd9a0", "#ffc27a"],
  bar: ["#e0903a", "#d27a28"],
  boulangerie: ["#ffd070", "#ffbe4a"],
  laverie: ["#dcebf7", "#b5d2ea"],
  agence: ["#e8eef4", "#cbd8e4"],
  rideau: null,
  sombre: null,
};

function both(a: CanvasRenderingContext2D, g: CanvasRenderingContext2D, color: string, glow = color) {
  a.fillStyle = color;
  g.fillStyle = glow;
}

/** Contenu de la vitrine [x, y, w, h] : ce qui fait lire le commerce de loin. */
function paintVitrine(
  a: CanvasRenderingContext2D,
  g: CanvasRenderingContext2D,
  kind: Vitrine,
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (kind === "rideau") {
    // rideau metallique baisse : la nuit, c'est la devanture la plus courante
    a.fillStyle = "#4a4b4c";
    a.fillRect(x, y, w, h);
    a.fillStyle = "rgba(0,0,0,0.35)";
    for (let k = 2; k < h; k += 4) a.fillRect(x, y + k, w, 1.5);
    a.fillStyle = "rgba(255,255,255,0.08)";
    for (let k = 0; k < h; k += 4) a.fillRect(x, y + k, w, 1);
    return;
  }
  const light = LIGHT[kind];
  if (!light) {
    a.fillStyle = "#1b1913";
    a.fillRect(x, y, w, h);
    return;
  }
  const [glass, halo] = light;
  a.fillStyle = glass;
  a.fillRect(x, y, w, h);
  g.fillStyle = halo;
  g.globalAlpha = kind === "bar" ? 0.55 : 0.8;
  g.fillRect(x, y, w, h);
  g.globalAlpha = 1;

  // les objets de la vitrine : sombres dans l'albedo, eteints dans la lueur
  const dark = (dx: number, dy: number, dw: number, dh: number, alpha = 0.55) => {
    a.fillStyle = `rgba(30,24,18,${alpha})`;
    a.fillRect(x + dx * w, y + dy * h, dw * w, dh * h);
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.fillRect(x + dx * w, y + dy * h, dw * w, dh * h);
  };
  switch (kind) {
    case "epicerie": {
      // rayonnages de produits colores
      const cols = ["#d94a3a", "#e8b43a", "#4aa35a", "#3a78c8", "#f0e6d0"];
      for (let r = 0; r < 3; r++) {
        dark(0, 0.28 + r * 0.26, 1, 0.03, 0.5);
        for (let k = 0; k < 9; k++) {
          const c = cols[Math.floor(seeded(seed * 7 + r * 13 + k) * cols.length) % cols.length];
          both(a, g, c, c);
          g.globalAlpha = 0.5;
          a.fillRect(x + (0.04 + k * 0.105) * w, y + (0.12 + r * 0.26) * h, 0.07 * w, 0.15 * h);
          g.fillRect(x + (0.04 + k * 0.105) * w, y + (0.12 + r * 0.26) * h, 0.07 * w, 0.15 * h);
          g.globalAlpha = 1;
        }
      }
      break;
    }
    case "boutique":
      // deux silhouettes de mannequins
      for (const cx of [0.28, 0.7]) {
        dark(cx - 0.05, 0.14, 0.1, 0.14, 0.6);
        dark(cx - 0.09, 0.3, 0.18, 0.62, 0.6);
      }
      break;
    case "bar":
      // tables et tabourets a contre-jour, comptoir au fond
      dark(0, 0.42, 1, 0.06, 0.45);
      for (const cx of [0.18, 0.5, 0.82]) {
        dark(cx - 0.1, 0.62, 0.2, 0.05, 0.75);
        dark(cx - 0.015, 0.66, 0.03, 0.34, 0.75);
      }
      break;
    case "boulangerie":
      // comptoir vitre et etageres de pains
      dark(0, 0.62, 1, 0.38, 0.35);
      for (let k = 0; k < 6; k++) {
        both(a, g, "#b8732e", "#6a3a10");
        a.fillRect(x + (0.06 + k * 0.155) * w, y + 0.3 * h, 0.11 * w, 0.08 * h);
      }
      break;
    case "laverie": {
      // rangee de hublots
      for (let k = 0; k < 4; k++) {
        const cx = x + (0.14 + k * 0.24) * w;
        const cy = y + 0.66 * h;
        const r = 0.09 * w;
        a.fillStyle = "#c9d2da";
        a.fillRect(cx - r * 1.2, cy - r * 1.4, r * 2.4, r * 2.8);
        a.beginPath();
        a.arc(cx, cy, r, 0, Math.PI * 2);
        a.fillStyle = "#3a4a5a";
        a.fill();
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fillStyle = "#000000";
        g.fill();
      }
      break;
    }
    case "agence":
      // panneaux d'annonces en vitrine
      for (let k = 0; k < 3; k++) {
        for (let r = 0; r < 2; r++) {
          dark(0.08 + k * 0.3, 0.14 + r * 0.4, 0.24, 0.32, 0.3);
          a.fillStyle = "#ffffff";
          a.fillRect(x + (0.1 + k * 0.3) * w, y + (0.16 + r * 0.4) * h, 0.2 * w, 0.14 * h);
        }
      }
      break;
  }
  // meneau central
  a.fillStyle = "rgba(0,0,0,0.35)";
  a.fillRect(x + w / 2 - 1.5, y, 3, h);
}

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
    // croix verte : elle deborde du bandeau, comme les vraies
    const c = h * 2;
    const t = c / 3;
    const cx = x + w / 2;
    const cy = y + h / 2;
    both(a, g, "#35ff7a");
    for (const ctx of [a, g]) {
      ctx.fillRect(cx - c / 2, cy - t / 2, c, t);
      ctx.fillRect(cx - t / 2, cy - c / 2, t, c);
    }
    return;
  }
  if (kind === "tabac") {
    // la carotte : losange rouge au bord de la devanture
    const cx = x + w * 0.88;
    const cy = y + h / 2;
    const rw = h * 0.7;
    const rh = h * 1.5;
    both(a, g, "#ff3b2e", "#ff2a1a");
    for (const ctx of [a, g]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - rh);
      ctx.lineTo(cx + rw, cy);
      ctx.lineTo(cx, cy + rh);
      ctx.lineTo(cx - rw, cy);
      ctx.closePath();
      ctx.fill();
    }
    kind = "lettres";
    w *= 0.75;
  }
  if (kind === "neon" || kind === "lettres") {
    // une suite de lettres : traits fins et colores au neon, pleins et chauds
    // pour les lettres dorees
    const color =
      kind === "lettres" ? "#ffd89a" : NEON[Math.floor(seeded(seed * 31) * NEON.length) % NEON.length];
    let cx = x + w * (0.08 + seeded(seed * 37) * 0.12);
    const end = x + w * 0.92;
    let k = 0;
    while (cx < end) {
      const lw = h * (0.35 + seeded(seed * 41 + k) * 0.45);
      if (cx + lw > end) break;
      both(a, g, color);
      a.fillRect(cx, y + h * 0.18, lw, h * 0.64);
      g.fillRect(cx, y + h * 0.18, lw, h * 0.64);
      if (kind === "neon") {
        // l'evidement de la lettre : le neon est un tube, pas un aplat
        a.fillStyle = "#211d18";
        g.fillStyle = "#000000";
        a.fillRect(cx + lw * 0.3, y + h * 0.36, lw * 0.4, h * 0.28);
        g.fillRect(cx + lw * 0.3, y + h * 0.36, lw * 0.4, h * 0.28);
      }
      cx += lw + h * (0.15 + (seeded(seed * 43 + k) < 0.2 ? 0.5 : 0));
      k++;
    }
    return;
  }
  // caisson lumineux : fond colore, texte sombre
  const color = BOX[Math.floor(seeded(seed * 29) * BOX.length) % BOX.length];
  both(a, g, color);
  a.fillRect(x + w * 0.1, y, w * 0.8, h);
  g.fillRect(x + w * 0.1, y, w * 0.8, h);
  a.fillStyle = "rgba(20,18,14,0.75)";
  g.fillStyle = "rgba(0,0,0,0.75)";
  for (let k = 0; k < 5; k++) {
    const bx = x + w * (0.2 + k * 0.12);
    a.fillRect(bx, y + h * 0.3, w * 0.08, h * 0.4);
    g.fillRect(bx, y + h * 0.3, w * 0.08, h * 0.4);
  }
}

/**
 * Devantures, en canvas purs. La rangee k (0 en bas) occupe v dans
 * [k / SHOP_VARIANTS, (k + 1) / SHOP_VARIANTS] : la texture est retournee
 * (flipY), donc la rangee 0 est peinte en bas du canvas.
 */
export function paintShopFront(): { albedo: HTMLCanvasElement; glow: HTMLCanvasElement } {
  const w = SHOP_BAYS * CELL_PX;
  const rowH = CELL_PX;
  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = w;
  albedo.height = glow.height = rowH * SHOP_VARIANTS;
  const a = albedo.getContext("2d")!;
  const g = glow.getContext("2d")!;

  a.fillStyle = "#2a2620";
  a.fillRect(0, 0, w, albedo.height);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, w, albedo.height);

  for (let row = 0; row < SHOP_VARIANTS; row++) {
    const oy = (SHOP_VARIANTS - 1 - row) * rowH;
    for (let ix = 0; ix < SHOP_BAYS; ix++) {
      const [vitrine, sign] = SHOPS[row][ix];
      const ox = ix * CELL_PX;
      const seed = row * 7919 + ix * 977 + 31;

      // bandeau au dessus de la vitrine
      a.fillStyle = "#211d18";
      a.fillRect(ox, oy + rowH * 0.06, CELL_PX, rowH * 0.16);

      paintVitrine(a, g, vitrine, seed, ox + CELL_PX * 0.1, oy + rowH * 0.28, CELL_PX * 0.8, rowH * 0.5);
      if (sign) {
        paintSign(a, g, sign, seed, ox + CELL_PX * 0.04, oy + rowH * 0.075, CELL_PX * 0.92, rowH * 0.13);
      }
    }
  }

  return { albedo, glow };
}
