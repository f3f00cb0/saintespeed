// Variantes de facade : vingt-quatre manieres d'habiller un mur, au lieu d'une
// par archetype.
//
// Avec une seule texture par archetype, toute la ville portait cinq facades.
// Deux immeubles de pierre voisins avaient la meme fenetre, le meme
// encadrement, le meme rythme, et c'est la premiere chose que l'oeil repere :
// une rue ou tout se repete ne ressemble a aucune rue. Le Manhattan de
// somethingbig.ai tire son realisme de onze styles aux dimensions reelles
// (hauteur d'etage, largeur de travee, corniche, soubassement) ; on fait la meme
// chose, a la stephanoise, et toujours dessine.
//
// Ce qui fait une facade de Saint-Etienne vue de la rue, et que les variantes
// reprennent :
//   - les VOLETS, surtout : battants bois peints, persiennes metalliques
//     repliees en tableau, volets roulants a demi baisses. De nuit, la moitie
//     sont fermes, et c'est la lumiere qui filtre entre les lames qu'on voit ;
//   - les fenetres a la francaise, a deux vantaux et trois carreaux, hautes et
//     etroites dans les immeubles de rapport du XIXe ;
//   - les garde-corps en fer forge, en balcon filant ou fenetre par fenetre ;
//   - les linteaux cintres a clef, les bandeaux d'etage, la pierre a refends ;
//   - la brique des ateliers, en arcs surbaisses a petits carreaux ;
//   - les loggias et les panneaux de couleur des grands ensembles.
//
// Chaque variante a ses dimensions : hauteur d'etage et largeur de travee. Un
// immeuble de rapport a 3,4 m sous plafond et des travees de 2,4 m, une barre
// 2,8 m et 2,7 m. Ce n'est pas un detail : la jointure IGN montre que les vrais
// etages font en mediane 1,22 fois nos 3,1 m d'etage type.
//
// Comme facades.ts, ce module est sans three.js : il ne produit que des canvas.
// facadeTextures.ts les empile dans un tableau de textures, un calque par
// variante, que le shader des murs lit par batiment (Buildings.tsx).

import { Archetype, STYLES, hash01, type ArchetypeStyle } from "./archetypes";
import { blindOf, interior, seeded } from "./facades";

/** Taille d'un calque, identique pour toutes les variantes (tableau de textures). */
export const LAYER_W = 512;
export const LAYER_H = 512;
/** Etages par tuile verticale : la trame se repete au dela. */
export const VARIANT_FLOORS = 6;
/** Carre de mur nu reserve en haut a gauche, pour les bandeaux de toit. */
export const LAYER_PATCH = 12;

/** Ce que le choix de variante sait d'un batiment. */
export type VariantInput = {
  id: number;
  archetype: Archetype;
  /** Niveaux rendus. */
  levels: number;
  /** Annee de construction, BD TOPO. */
  year?: number;
  /** Surface au sol, m2. */
  area: number;
};

type Painter = {
  a: CanvasRenderingContext2D;
  g: CanvasRenderingContext2D;
  style: ArchetypeStyle;
  v: Variant;
  /** largeur et hauteur d'une cellule (travee x etage), en pixels */
  cw: number;
  ch: number;
  /** pixels par metre, horizontalement et verticalement */
  pxU: number;
  pxV: number;
  salt: number;
};

type Cell = { ix: number; iy: number; x: number; y: number; w: number; h: number; seed: number };

export type Variant = {
  key: string;
  archetype: Archetype;
  /** Travees par tuile horizontale. */
  bays: number;
  /** Largeur de travee, metres. */
  bayW: number;
  /** Hauteur d'etage, metres. */
  floorH: number;
  /** Poids de tirage pour un batiment donne, 0 pour l'exclure. */
  weight: (b: VariantInput) => number;
  paint: (p: Painter) => void;
  /** Gain emissif des fenetres allumees, sinon celui de l'archetype. */
  glow?: number;
};

// --- primitives -------------------------------------------------------------

function cells(p: Painter, fn: (c: Cell) => void) {
  for (let iy = 0; iy < VARIANT_FLOORS; iy++) {
    for (let ix = 0; ix < p.v.bays; ix++) {
      fn({
        ix,
        iy,
        x: ix * p.cw,
        y: iy * p.ch,
        w: p.cw,
        h: p.ch,
        seed: ix * 73 + iy * 149 + p.salt * 1013,
      });
    }
  }
}

const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

function rect(ctx: CanvasRenderingContext2D, fill: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

type Shape = "rect" | "segment" | "arch";

/** Contour d'une baie : rectangle, linteau cintre surbaisse, ou plein cintre. */
function baie(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shape: Shape) {
  ctx.beginPath();
  if (shape === "rect") {
    ctx.rect(x, y, w, h);
    return;
  }
  const rise = shape === "arch" ? w / 2 : w * 0.16;
  // arc passant par les deux coins hauts et le sommet, de fleche `rise`
  const r = (w * w) / (8 * rise) + rise / 2;
  const cx = x + w / 2;
  const cy = y + r;
  const half = Math.asin(Math.min(1, w / 2 / r));
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rise);
  ctx.arc(cx, cy, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

type Shutter = {
  kind: "battant" | "persienne" | "roulant";
  colour: string;
  /** part des fenetres aux volets fermes */
  closed: number;
};

type WinSpec = {
  /** largeur et hauteur de la baie, en fraction de la cellule */
  w: number;
  h: number;
  /** haut de la baie, en fraction de la cellule depuis le haut */
  top: number;
  shape?: Shape;
  /** carreaux : colonnes x rangees (croisillons) */
  panes?: [number, number];
  /** encadrement peint ou en pierre autour de la baie */
  surround?: { colour: string; alpha: number; pad: number };
  /** appui saillant sous la baie */
  sill?: boolean;
  /** clef de voute au sommet du linteau */
  keystone?: boolean;
  shutter?: Shutter;
  /** garde-corps en fer forge devant le bas de la baie */
  railing?: boolean;
  /** coulure sous l'appui : la salissure qui fait vrai */
  streak?: boolean;
  /** part des fenetres allumees, sinon celle de l'archetype */
  lit?: number;
  /** decalage horizontal de la baie dans la cellule, en fraction */
  dx?: number;
};

/** Une fenetre complete, dans l'albedo et la lueur. Renvoie si elle est allumee. */
function fenetre(p: Painter, c: Cell, s: WinSpec): boolean {
  const { a, g, style } = p;
  const ww = c.w * s.w;
  const wh = c.h * s.h;
  const wx = c.x + (c.w - ww) / 2 + c.w * (s.dx ?? 0);
  const wy = c.y + c.h * s.top;
  const shape = s.shape ?? "rect";
  const ratio = s.lit ?? style.litRatio;
  const lit = seeded(c.seed) < ratio;
  const closed = !!s.shutter && seeded(c.seed * 29 + 5) < s.shutter.closed;

  if (s.surround) {
    const pad = c.w * s.surround.pad;
    a.fillStyle = rgba(s.surround.colour, s.surround.alpha);
    baie(a, wx - pad, wy - pad, ww + pad * 2, wh + pad * 1.6, shape);
    a.fill();
  }
  if (s.streak) {
    // coulure : un voile sombre qui s'efface sous l'appui
    const grad = a.createLinearGradient(0, wy + wh, 0, wy + wh + c.h * 0.4);
    grad.addColorStop(0, "rgba(0,0,0,0.10)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    a.fillStyle = grad;
    a.fillRect(wx + ww * 0.1, wy + wh, ww * 0.8, c.h * 0.4);
  }

  // le verre
  const [glass, halo] = interior(style, c.seed);
  a.fillStyle = lit ? glass : style.dark;
  baie(a, wx, wy, ww, wh, shape);
  a.fill();
  if (!lit) {
    // reflet froid en biais : une vitre eteinte n'est pas un trou noir
    a.save();
    baie(a, wx, wy, ww, wh, shape);
    a.clip();
    a.fillStyle = "rgba(150,170,200,0.10)";
    a.beginPath();
    a.moveTo(wx + ww * 0.15, wy + wh);
    a.lineTo(wx + ww * 0.55, wy);
    a.lineTo(wx + ww * 0.8, wy);
    a.lineTo(wx + ww * 0.4, wy + wh);
    a.fill();
    a.restore();
  }
  const blind = lit && !closed ? blindOf(c.seed) : 0;
  if (lit && !closed) {
    g.fillStyle = halo;
    g.globalAlpha = 0.45 + seeded(c.seed * 17) * 0.45;
    baie(g, wx, wy, ww, wh, shape);
    g.fill();
    g.globalAlpha = 1;
    if (blind > 0) {
      rect(a, "rgba(20,16,12,0.5)", wx, wy, ww, wh * blind);
      rect(g, "rgba(0,0,0,0.8)", wx, wy, ww, wh * blind);
    }
  }

  // croisillons : deux vantaux a trois carreaux, la fenetre a la francaise. Sur
  // une vitre allumee ils se decoupent en sombre ; sur une vitre eteinte ce
  // sont les menuiseries peintes qui se voient, en clair, et c'est ce qui fait
  // lire une fenetre plutot qu'un trou.
  const [cols, rows] = s.panes ?? [2, 1];
  const bar = Math.max(1.2, c.w * 0.014);
  for (const ctx of [a, g]) {
    ctx.fillStyle = ctx === a ? (lit ? "rgba(40,30,20,0.55)" : "rgba(225,222,215,0.42)") : "#000000";
    for (let k = 1; k < cols; k++) ctx.fillRect(wx + (ww * k) / cols - bar / 2, wy, bar, wh);
    for (let k = 1; k < rows; k++) ctx.fillRect(wx, wy + (wh * k) / rows - bar / 2, ww, bar * 0.8);
  }
  // le dormant, un filet clair autour de la baie
  a.strokeStyle = "rgba(230,228,222,0.5)";
  a.lineWidth = Math.max(1.2, c.w * 0.012);
  baie(a, wx, wy, ww, wh, shape);
  a.stroke();

  if (s.shutter) volets(p, c, s.shutter, closed, lit, wx, wy, ww, wh);

  if (s.keystone) {
    const kw = ww * 0.16;
    rect(a, "rgba(255,255,255,0.22)", wx + ww / 2 - kw / 2, wy - c.h * 0.05, kw, c.h * 0.08);
    rect(a, "rgba(0,0,0,0.12)", wx + ww / 2 + kw / 2 - 1, wy - c.h * 0.05, 1.5, c.h * 0.08);
  }
  if (s.sill) {
    rect(a, "rgba(255,255,255,0.28)", wx - c.w * 0.04, wy + wh, ww + c.w * 0.08, c.h * 0.035);
    rect(a, "rgba(0,0,0,0.22)", wx - c.w * 0.04, wy + wh + c.h * 0.035, ww + c.w * 0.08, c.h * 0.02);
  }
  if (s.railing) garde(p, wx - c.w * 0.03, wy + wh * 0.68, ww + c.w * 0.06, wh * 0.32);
  return lit && !closed;
}

/** Volets, ouverts de chaque cote ou fermes sur la baie. */
function volets(
  p: Painter,
  c: Cell,
  sh: Shutter,
  closed: boolean,
  lit: boolean,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
) {
  const { a, g } = p;
  const lame = Math.max(2, p.pxV * 0.08);
  if (sh.kind === "roulant") {
    // coffre au dessus, tablier descendu d'une fraction propre a la fenetre
    rect(a, rgba(sh.colour, 0.9), wx - 1, wy - c.h * 0.07, ww + 2, c.h * 0.07);
    const f = closed ? 1 : seeded(c.seed * 31) < 0.45 ? 0.15 + seeded(c.seed * 37) * 0.55 : 0;
    if (f > 0) {
      rect(a, sh.colour, wx, wy, ww, wh * f);
      a.fillStyle = "rgba(0,0,0,0.16)";
      for (let k = lame; k < wh * f; k += lame) a.fillRect(wx, wy + k, ww, 1);
      rect(g, "#000000", wx, wy, ww, wh * f);
      if (closed && lit) {
        // la lumiere filtre par les ajours du tablier
        g.fillStyle = "rgba(255,190,110,0.10)";
        for (let k = lame / 2; k < wh; k += lame * 2) g.fillRect(wx, wy + k, ww, 1);
      }
    }
    return;
  }
  const panel = (x: number, w: number) => {
    rect(a, sh.colour, x, wy, w, wh);
    a.fillStyle = "rgba(0,0,0,0.18)";
    if (sh.kind === "persienne") {
      for (let k = lame; k < wh; k += lame) a.fillRect(x, wy + k, w, 1);
    } else {
      // battant bois : persiennes en haut, panneau plein en bas, et le cadre
      for (let k = lame; k < wh * 0.62; k += lame) a.fillRect(x, wy + k, w, 1);
      a.fillRect(x + w * 0.12, wy + wh * 0.68, w * 0.76, 1.2);
      a.fillRect(x + w * 0.12, wy + wh * 0.92, w * 0.76, 1.2);
    }
    a.strokeStyle = "rgba(0,0,0,0.35)";
    a.lineWidth = 1;
    a.strokeRect(x + 0.5, wy + 0.5, w - 1, wh - 1);
  };
  if (closed) {
    panel(wx, ww / 2);
    panel(wx + ww / 2, ww / 2);
    rect(g, "#000000", wx, wy, ww, wh);
    if (lit) {
      // les lames laissent passer un peu de la lumiere de la piece
      g.fillStyle = "rgba(255,190,110,0.16)";
      for (let k = lame / 2; k < wh; k += lame) g.fillRect(wx, wy + k, ww, 1);
    }
    return;
  }
  // ouverts : rabattus contre le mur, de chaque cote de la baie
  const sw = sh.kind === "persienne" ? ww * 0.16 : ww / 2;
  panel(wx - sw - 1, sw);
  panel(wx + ww + 1, sw);
}

/** Garde-corps en fer forge : main courante, barreaux, et une frise basse. */
function garde(p: Painter, x: number, y: number, w: number, h: number) {
  const { a, g } = p;
  a.fillStyle = "rgba(18,16,15,0.85)";
  a.fillRect(x, y, w, Math.max(1.5, h * 0.08));
  a.fillRect(x, y + h - 1.5, w, 1.5);
  const step = Math.max(3, p.pxU * 0.12);
  for (let k = x + step / 2; k < x + w; k += step) a.fillRect(k, y, 1.2, h);
  // les volutes, simplifiees en une frise de losanges
  a.strokeStyle = "rgba(18,16,15,0.8)";
  a.lineWidth = 1;
  a.beginPath();
  for (let k = x; k < x + w - step; k += step * 2) {
    a.moveTo(k, y + h * 0.55);
    a.lineTo(k + step, y + h * 0.3);
    a.lineTo(k + step * 2, y + h * 0.55);
    a.lineTo(k + step, y + h * 0.8);
    a.closePath();
  }
  a.stroke();
  // le fer coupe la lumiere de la fenetre derriere
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(x, y, w, Math.max(1.5, h * 0.08));
  for (let k = x + step / 2; k < x + w; k += step) g.fillRect(k, y, 1.2, h);
}

/** Bandeau horizontal d'etage : une moulure claire soulignee d'ombre. */
function bandeau(p: Painter, y: number, hM: number) {
  const hh = Math.max(2, hM * p.pxV);
  rect(p.a, "rgba(255,255,255,0.20)", 0, y, LAYER_W, hh);
  rect(p.a, "rgba(0,0,0,0.18)", 0, y + hh, LAYER_W, Math.max(1, hh * 0.4));
}

// --- matieres de mur (en gris sur blanc : la teinte vient du sommet) --------

function enduit(p: Painter, salt: number) {
  // crepi : taches douces, pas de joints
  for (let k = 0; k < 220; k++) {
    const r = seeded(salt * 7 + k);
    const x = seeded(salt * 11 + k * 3) * LAYER_W;
    const y = seeded(salt * 13 + k * 5) * LAYER_H;
    const s = 6 + r * 26;
    p.a.fillStyle = `rgba(0,0,0,${(0.015 + r * 0.03).toFixed(3)})`;
    p.a.fillRect(x, y, s, s * 0.7);
  }
}

function pierreDeTaille(p: Painter, rangM: number, strong: boolean) {
  const rang = rangM * p.pxV;
  const bloc = 0.9 * p.pxU;
  p.a.fillStyle = strong ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.07)";
  for (let y = 0, r = 0; y < LAYER_H; y += rang, r++) {
    p.a.fillRect(0, y, LAYER_W, strong ? 2 : 1);
    if (strong) continue; // les refends ne marquent que les lits horizontaux
    for (let x = (r % 2) * bloc * 0.5; x < LAYER_W; x += bloc) p.a.fillRect(x, y, 1, rang);
  }
}

function briques(p: Painter) {
  // un joint marque tous les trois rangs, et des briques plus sombres semees
  const rang = 0.075 * 3 * p.pxV;
  const bw = 0.22 * p.pxU;
  for (let y = 0, r = 0; y < LAYER_H; y += rang, r++) {
    p.a.fillStyle = "rgba(0,0,0,0.10)";
    p.a.fillRect(0, y, LAYER_W, 1);
    for (let x = (r % 2) * bw * 0.5; x < LAYER_W; x += bw) {
      const n = seeded(r * 131 + Math.floor(x));
      if (n < 0.18) {
        p.a.fillStyle = `rgba(40,10,0,${(0.05 + n * 0.3).toFixed(3)})`;
        p.a.fillRect(x, y + 1, bw - 1, rang - 1);
      }
    }
  }
}

function panneaux(p: Painter, wM: number, hM: number) {
  const pw = wM * p.pxU;
  const ph = hM * p.pxV;
  for (let y = 0; y < LAYER_H; y += ph) {
    for (let x = 0; x < LAYER_W; x += pw) {
      const n = seeded(Math.floor(x) * 7 + Math.floor(y) * 13);
      p.a.fillStyle = `rgba(0,0,0,${(0.02 + n * 0.06).toFixed(3)})`;
      p.a.fillRect(x, y, pw, ph);
    }
  }
  p.a.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < LAYER_H; y += ph) p.a.fillRect(0, y, LAYER_W, 1.5);
  for (let x = 0; x < LAYER_W; x += pw) p.a.fillRect(x, 0, 1.5, LAYER_H);
}

/** Nez de dalle : l'ombre au pied de chaque etage. */
function dalles(p: Painter, alpha = 0.16) {
  for (let iy = 0; iy < VARIANT_FLOORS; iy++) rect(p.a, `rgba(0,0,0,${alpha})`, 0, (iy + 1) * p.ch - p.ch * 0.05, LAYER_W, p.ch * 0.05);
}

// --- couleurs ---------------------------------------------------------------
// Les volets sont peints dans la texture et multiplies par la teinte du mur :
// on les tient donc clairs et un peu satures, ils ressortent en teinte rompue
// sur l'enduit, comme les vrais apres vingt ans de soleil.
const VERT = "#a3c9ad";
const BRUN = "#c09470";
const GRIS_BLEU = "#b6c6d6";
const ROUGE_BASQUE = "#cc7f6c";
const BLANC = "#e4e2dc";
const GRIS_METAL = "#a4a8ad";
const PIERRE_CLAIRE = "#ffffff";

// --- les variantes ------------------------------------------------------------

const lv = (b: VariantInput) => b.levels;
const old = (b: VariantInput, y: number) => b.year !== undefined && b.year < y;
const between = (b: VariantInput, y0: number, y1: number) => b.year !== undefined && b.year >= y0 && b.year <= y1;

export const VARIANTS: Variant[] = [
  // ============================ PIERRE ======================================
  // Immeubles de rapport du XIXe : rue de la Republique, place Jean-Jaures,
  // cours Fauriel. Pierre beige-gris, hautes fenetres a la francaise.
  {
    key: "pierre-balcon-filant",
    archetype: Archetype.Pierre,
    bays: 4,
    bayW: 2.5,
    floorH: 3.4,
    weight: (b) => (lv(b) >= 4 ? 3 : 1),
    paint(p) {
      pierreDeTaille(p, 0.45, false);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.44, h: 0.62, top: 0.16, panes: [2, 3], sill: true, streak: true,
          surround: { colour: PIERRE_CLAIRE, alpha: 0.35, pad: 0.05 },
          shutter: { kind: "persienne", colour: GRIS_METAL, closed: 0.35 },
        });
      });
      // le balcon filant du deuxieme etage, et sa dalle
      const y = 1 * p.ch + p.ch * 0.56;
      rect(p.a, "rgba(255,255,255,0.3)", 0, y + p.ch * 0.22, LAYER_W, p.ch * 0.05);
      garde(p, 0, y, LAYER_W, p.ch * 0.22);
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) bandeau(p, iy * p.ch + p.ch * 0.8, 0.12);
      dalles(p, 0.1);
    },
  },
  {
    key: "pierre-linteau-clef",
    archetype: Archetype.Pierre,
    bays: 4,
    bayW: 2.6,
    floorH: 3.5,
    weight: (b) => (old(b, 1900) ? 3 : 2),
    paint(p) {
      pierreDeTaille(p, 0.4, false);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.42, h: 0.6, top: 0.18, shape: "segment", panes: [2, 3], sill: true, keystone: true, streak: true,
          surround: { colour: PIERRE_CLAIRE, alpha: 0.4, pad: 0.06 },
          shutter: { kind: "battant", colour: GRIS_BLEU, closed: 0.3 },
        });
      });
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) bandeau(p, iy * p.ch + p.ch * 0.83, 0.15);
    },
  },
  {
    key: "pierre-travees-serrees",
    archetype: Archetype.Pierre,
    bays: 5,
    bayW: 2.0,
    floorH: 3.3,
    weight: (b) => (old(b, 1880) ? 3 : 1.5),
    paint(p) {
      pierreDeTaille(p, 0.4, false);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.5, h: 0.64, top: 0.15, panes: [2, 3], sill: true, streak: true,
          shutter: { kind: "persienne", colour: BLANC, closed: 0.45 },
        });
      });
      dalles(p, 0.12);
    },
  },
  {
    key: "pierre-balconnets",
    archetype: Archetype.Pierre,
    bays: 3,
    bayW: 2.8,
    floorH: 3.5,
    weight: (b) => (lv(b) >= 5 ? 2.5 : 1),
    paint(p) {
      pierreDeTaille(p, 0.5, false);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.4, h: 0.68, top: 0.14, panes: [2, 4], railing: true, streak: true,
          surround: { colour: PIERRE_CLAIRE, alpha: 0.3, pad: 0.05 },
          shutter: { kind: "persienne", colour: GRIS_METAL, closed: 0.25 },
        });
      });
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) bandeau(p, iy * p.ch + p.ch * 0.02, 0.1);
    },
  },
  {
    key: "pierre-refends",
    archetype: Archetype.Pierre,
    bays: 4,
    bayW: 2.7,
    floorH: 3.6,
    weight: (b) => (lv(b) <= 5 ? 2 : 1),
    paint(p) {
      pierreDeTaille(p, 0.36, true);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.38, h: 0.58, top: 0.2, shape: "segment", panes: [2, 3], keystone: true, sill: true,
          surround: { colour: "#000000", alpha: 0.08, pad: 0.04 },
        });
      });
    },
  },

  // =========================== FAUBOURG =====================================
  // Le tissu ordinaire : enduit, deux a quatre niveaux, volets partout.
  {
    key: "faubourg-volets-verts",
    archetype: Archetype.Faubourg,
    bays: 4,
    bayW: 2.6,
    floorH: 3.0,
    weight: () => 3,
    paint(p) {
      enduit(p, 3);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.36, h: 0.56, top: 0.2, panes: [2, 3], sill: true, streak: true,
          shutter: { kind: "battant", colour: VERT, closed: 0.4 },
        });
      });
      dalles(p, 0.06);
    },
  },
  {
    key: "faubourg-volets-bruns",
    archetype: Archetype.Faubourg,
    bays: 4,
    bayW: 2.8,
    floorH: 3.0,
    weight: () => 3,
    paint(p) {
      enduit(p, 5);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.34, h: 0.54, top: 0.22, panes: [2, 3], sill: true, streak: true,
          surround: { colour: "#ffffff", alpha: 0.35, pad: 0.05 },
          shutter: { kind: "battant", colour: c.ix % 3 === 1 ? ROUGE_BASQUE : BRUN, closed: 0.45 },
        });
      });
    },
  },
  {
    key: "faubourg-volets-roulants",
    archetype: Archetype.Faubourg,
    bays: 4,
    bayW: 2.7,
    floorH: 2.9,
    weight: (b) => (b.year === undefined || b.year >= 1950 ? 3 : 1),
    paint(p) {
      enduit(p, 7);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.44, h: 0.52, top: 0.24, panes: [2, 1], sill: true,
          shutter: { kind: "roulant", colour: BLANC, closed: 0.3 },
        });
      });
      dalles(p, 0.05);
    },
  },
  {
    key: "faubourg-encadrements",
    archetype: Archetype.Faubourg,
    bays: 3,
    bayW: 3.0,
    floorH: 3.0,
    weight: (b) => (lv(b) <= 3 ? 2.5 : 1.5),
    paint(p) {
      enduit(p, 9);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.32, h: 0.5, top: 0.22, panes: [2, 2], sill: true, streak: true,
          surround: { colour: "#ffffff", alpha: 0.55, pad: 0.07 },
          shutter: { kind: "persienne", colour: GRIS_BLEU, closed: 0.3 },
        });
      });
      // chaine d'angle en pierre, au bord de la tuile
      for (let y = 0; y < LAYER_H; y += p.pxV * 0.6) {
        const w = (Math.floor(y / (p.pxV * 0.6)) % 2 ? 0.5 : 0.8) * p.pxU;
        rect(p.a, "rgba(255,255,255,0.3)", 0, y, w, p.pxV * 0.55);
      }
    },
  },
  {
    key: "faubourg-pavillon",
    archetype: Archetype.Faubourg,
    bays: 3,
    bayW: 3.4,
    floorH: 2.8,
    weight: (b) => (lv(b) <= 2 ? 3 : between(b, 1950, 1990) ? 1.5 : 0.3),
    paint(p) {
      enduit(p, 11);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.6, h: 0.42, top: 0.26, panes: [3, 1], sill: true,
          shutter: { kind: "roulant", colour: "#d8d4ca", closed: 0.35 },
        });
      });
    },
  },
  {
    key: "faubourg-persiennes-closes",
    archetype: Archetype.Faubourg,
    bays: 4,
    bayW: 2.4,
    floorH: 3.1,
    weight: (b) => (old(b, 1930) ? 2.5 : 1),
    paint(p) {
      enduit(p, 13);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.42, h: 0.6, top: 0.17, panes: [2, 3], sill: true, streak: true,
          shutter: { kind: "persienne", colour: c.iy % 2 ? BLANC : GRIS_BLEU, closed: 0.6 },
        });
      });
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) bandeau(p, iy * p.ch + p.ch * 0.84, 0.1);
    },
  },

  // ============================ BRIQUE ======================================
  // Manufacture, Manufrance, ateliers de passementerie, cites ouvrieres.
  {
    key: "brique-atelier-arcs",
    archetype: Archetype.Brique,
    bays: 3,
    bayW: 3.4,
    floorH: 4.0,
    weight: (b) => (b.area >= 400 ? 3 : 1),
    paint(p) {
      briques(p);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.62, h: 0.62, top: 0.16, shape: "segment", panes: [4, 4], keystone: true,
          surround: { colour: "#ffffff", alpha: 0.28, pad: 0.03 },
          lit: 0.26,
        });
      });
      dalles(p, 0.14);
    },
  },
  {
    key: "brique-cite",
    archetype: Archetype.Brique,
    bays: 4,
    bayW: 2.6,
    floorH: 3.0,
    weight: (b) => (b.area < 400 ? 3 : 1),
    paint(p) {
      briques(p);
      cells(p, (c) => {
        fenetre(p, c, {
          w: 0.38, h: 0.52, top: 0.22, panes: [2, 3], sill: true,
          shutter: { kind: "battant", colour: BRUN, closed: 0.35 },
          lit: 0.3,
        });
        // linteau de pierre claire, droit
        rect(p.a, "rgba(255,255,255,0.35)", c.x + c.w * 0.28, c.y + c.h * 0.16, c.w * 0.44, c.h * 0.06);
      });
    },
  },
  {
    key: "brique-pilastres",
    archetype: Archetype.Brique,
    bays: 3,
    bayW: 3.6,
    floorH: 4.2,
    weight: (b) => (b.area >= 800 ? 2.5 : 0.8),
    paint(p) {
      briques(p);
      // pilastres entre les travees, un peu plus sombres et saillants
      for (let ix = 0; ix <= p.v.bays; ix++) {
        const x = ix * p.cw - p.cw * 0.06;
        rect(p.a, "rgba(60,20,10,0.14)", x, 0, p.cw * 0.12, LAYER_H);
        rect(p.a, "rgba(0,0,0,0.2)", x + p.cw * 0.12, 0, 1.5, LAYER_H);
      }
      cells(p, (c) => {
        fenetre(p, c, { w: 0.56, h: 0.7, top: 0.12, panes: [3, 5], lit: 0.22 });
      });
      // corniche de briques en dents d'engrenage sous chaque etage
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) {
        const y = iy * p.ch + p.ch * 0.9;
        for (let x = 0; x < LAYER_W; x += p.pxU * 0.3) rect(p.a, "rgba(0,0,0,0.2)", x, y, p.pxU * 0.15, p.ch * 0.05);
      }
    },
  },
  {
    key: "brique-polychrome",
    archetype: Archetype.Brique,
    bays: 4,
    bayW: 2.8,
    floorH: 3.6,
    weight: (b) => (old(b, 1914) ? 2.5 : 1),
    paint(p) {
      briques(p);
      // les bandes de brique claire de Chateaucreux, a chaque etage
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) {
        rect(p.a, "rgba(255,235,200,0.35)", 0, iy * p.ch + p.ch * 0.05, LAYER_W, p.ch * 0.06);
        rect(p.a, "rgba(255,235,200,0.35)", 0, iy * p.ch + p.ch * 0.86, LAYER_W, p.ch * 0.04);
      }
      cells(p, (c) => {
        // claveaux alternes clair / sombre autour de l'arc
        const ww = c.w * 0.4;
        const wx = c.x + (c.w - ww) / 2;
        const wy = c.y + c.h * 0.2;
        for (let k = 0; k < 7; k++) {
          const t0 = Math.PI + (k / 7) * Math.PI;
          p.a.strokeStyle = k % 2 ? "rgba(255,235,200,0.5)" : "rgba(40,10,0,0.3)";
          p.a.lineWidth = c.w * 0.05;
          p.a.beginPath();
          p.a.arc(wx + ww / 2, wy + ww / 2, ww / 2 + c.w * 0.03, t0, t0 + Math.PI / 7);
          p.a.stroke();
        }
        fenetre(p, c, { w: 0.4, h: 0.58, top: 0.2, shape: "arch", panes: [2, 3], sill: true, lit: 0.28 });
      });
    },
  },

  // ============================= BARRE ======================================
  // La Metare, Montchovet, Beaulieu, Montreynaud, la Cotonne.
  {
    key: "barre-loggias",
    archetype: Archetype.Barre,
    bays: 4,
    bayW: 2.7,
    floorH: 2.8,
    weight: () => 3,
    paint(p) {
      dalles(p, 0.18);
      cells(p, (c) => {
        if (c.ix % 2 === 0) {
          // loggia : un creux sombre, le fond de la loggia et son garde-corps plein
          rect(p.a, "#303238", c.x + c.w * 0.04, c.y + c.h * 0.08, c.w * 0.92, c.h * 0.84);
          fenetre(p, c, { w: 0.5, h: 0.6, top: 0.14, panes: [2, 1], lit: 0.5 });
          rect(p.a, "rgba(255,255,255,0.55)", c.x + c.w * 0.04, c.y + c.h * 0.6, c.w * 0.92, c.h * 0.32);
          rect(p.g, "#000000", c.x + c.w * 0.04, c.y + c.h * 0.6, c.w * 0.92, c.h * 0.32);
        } else {
          fenetre(p, c, { w: 0.46, h: 0.46, top: 0.24, panes: [2, 1], lit: 0.5, shutter: { kind: "roulant", colour: BLANC, closed: 0.2 } });
        }
      });
    },
  },
  {
    key: "barre-panneaux",
    archetype: Archetype.Barre,
    bays: 5,
    bayW: 2.6,
    floorH: 2.8,
    weight: (b) => (lv(b) >= 9 ? 3 : 1.5),
    paint(p) {
      panneaux(p, 2.6, 2.8);
      cells(p, (c) => {
        fenetre(p, c, { w: 0.42, h: 0.44, top: 0.24, panes: [2, 1], lit: 0.5, streak: true });
      });
    },
  },
  {
    key: "barre-balcons-couleur",
    archetype: Archetype.Barre,
    bays: 4,
    bayW: 2.8,
    floorH: 2.8,
    weight: (b) => (between(b, 1960, 1980) ? 3 : 1.5),
    paint(p) {
      // allèges de couleur des annees 70, rabattues pour la nuit
      const couleurs = ["#e0a060", "#8fb0d0", "#e8d070", "#c9c4bc"];
      cells(p, (c) => {
        fenetre(p, c, { w: 0.62, h: 0.56, top: 0.12, panes: [3, 1], lit: 0.5 });
        const col = couleurs[(c.iy + (c.ix >> 1)) % couleurs.length];
        rect(p.a, col, c.x, c.y + c.h * 0.66, c.w, c.h * 0.3);
        rect(p.a, "rgba(0,0,0,0.25)", c.x, c.y + c.h * 0.96, c.w, c.h * 0.04);
        rect(p.g, "#000000", c.x, c.y + c.h * 0.66, c.w, c.h * 0.34);
      });
    },
  },
  {
    key: "barre-bandeaux",
    archetype: Archetype.Barre,
    bays: 6,
    bayW: 2.0,
    floorH: 2.9,
    weight: (b) => (lv(b) >= 12 ? 3 : 1),
    paint(p) {
      // fenetres en bandeau continu, allege de beton lisse
      cells(p, (c) => {
        fenetre(p, c, { w: 0.94, h: 0.46, top: 0.2, panes: [1, 1], lit: 0.45 });
      });
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) rect(p.a, "rgba(255,255,255,0.18)", 0, iy * p.ch + p.ch * 0.7, LAYER_W, p.ch * 0.24);
      dalles(p, 0.2);
    },
  },
  {
    key: "barre-cage-escalier",
    archetype: Archetype.Barre,
    bays: 5,
    bayW: 2.7,
    floorH: 2.8,
    weight: () => 2,
    paint(p) {
      enduit(p, 17);
      cells(p, (c) => {
        if (c.ix === 2) {
          // cage d'escalier : une colonne de pavés de verre eclairee toute la nuit
          rect(p.a, "rgba(255,255,255,0.2)", c.x + c.w * 0.2, 0, c.w * 0.6, LAYER_H);
          rect(p.a, "#dfe6d8", c.x + c.w * 0.36, c.y + c.h * 0.3, c.w * 0.28, c.h * 0.5);
          rect(p.g, "#c9d8b8", c.x + c.w * 0.36, c.y + c.h * 0.3, c.w * 0.28, c.h * 0.5);
          p.a.fillStyle = "rgba(0,0,0,0.2)";
          for (let k = 0; k < 4; k++) p.a.fillRect(c.x + c.w * 0.36, c.y + c.h * (0.3 + k * 0.125), c.w * 0.28, 1);
          return;
        }
        fenetre(p, c, { w: 0.46, h: 0.5, top: 0.22, panes: [2, 1], lit: 0.5, shutter: { kind: "roulant", colour: BLANC, closed: 0.25 } });
      });
      dalles(p, 0.12);
    },
  },

  // ============================ MODERNE =====================================
  // Cite du Design, Chateaucreux, Steel, tertiaire des annees 1990-2020.
  {
    key: "moderne-mur-rideau",
    archetype: Archetype.Moderne,
    bays: 6,
    bayW: 1.5,
    floorH: 3.8,
    weight: (b) => (lv(b) >= 5 ? 3 : 1.5),
    paint(p) {
      // les bureaux s'allument par plateau entier, pas fenetre par fenetre
      for (let iy = 0; iy < VARIANT_FLOORS; iy++) {
        const plateau = seeded(iy * 977 + 3) < 0.45;
        for (let ix = 0; ix < p.v.bays; ix++) {
          const c = { ix, iy, x: ix * p.cw, y: iy * p.ch, w: p.cw, h: p.ch, seed: ix * 73 + iy * 149 + 5 };
          fenetre(p, c, { w: 0.96, h: 0.72, top: 0.04, panes: [1, 2], lit: plateau ? 0.9 : 0.08 });
        }
        rect(p.a, "rgba(0,0,0,0.3)", 0, iy * p.ch + p.ch * 0.76, LAYER_W, p.ch * 0.24);
      }
    },
    glow: 1.8,
  },
  {
    key: "moderne-bardage",
    archetype: Archetype.Moderne,
    bays: 4,
    bayW: 3.0,
    floorH: 3.4,
    weight: () => 2,
    paint(p) {
      // lames horizontales de bardage, fenetres en longueur
      p.a.fillStyle = "rgba(0,0,0,0.1)";
      for (let y = 0; y < LAYER_H; y += p.pxV * 0.25) p.a.fillRect(0, y, LAYER_W, 1);
      cells(p, (c) => {
        fenetre(p, c, { w: 0.8, h: 0.36, top: 0.3, panes: [2, 1], dx: seeded(c.iy * 7) < 0.5 ? -0.08 : 0.08 });
      });
    },
  },
  {
    key: "moderne-brise-soleil",
    archetype: Archetype.Moderne,
    bays: 6,
    bayW: 1.6,
    floorH: 3.6,
    weight: (b) => (b.year !== undefined && b.year >= 2000 ? 3 : 1.5),
    paint(p) {
      cells(p, (c) => {
        fenetre(p, c, { w: 0.9, h: 0.78, top: 0.06, panes: [1, 1] });
      });
      // lames verticales devant le vitrage : elles coupent la lumiere en bandes
      for (let x = 0; x < LAYER_W; x += p.cw / 2) {
        rect(p.a, "rgba(255,255,255,0.7)", x, 0, p.cw * 0.12, LAYER_H);
        rect(p.a, "rgba(0,0,0,0.2)", x + p.cw * 0.12, 0, 1.5, LAYER_H);
        rect(p.g, "#000000", x, 0, p.cw * 0.13, LAYER_H);
      }
    },
  },
  {
    key: "moderne-perfore",
    archetype: Archetype.Moderne,
    bays: 4,
    bayW: 2.4,
    floorH: 3.6,
    weight: () => 1.2,
    paint(p) {
      // tole perforee devant des baies irregulieres : la ou passe la lumiere,
      // elle passe en pointilles
      cells(p, (c) => {
        const w = 0.3 + seeded(c.seed * 3) * 0.5;
        fenetre(p, c, { w, h: 0.6, top: 0.18, panes: [1, 1], dx: (seeded(c.seed * 5) - 0.5) * (0.9 - w) });
      });
      const pas = Math.max(4, p.pxU * 0.25);
      for (let y = 0; y < LAYER_H; y += pas) {
        for (let x = (Math.floor(y / pas) % 2) * pas * 0.5; x < LAYER_W; x += pas) {
          rect(p.a, "rgba(0,0,0,0.18)", x, y, pas * 0.35, pas * 0.35);
        }
      }
    },
  },
];

/** Variantes d'un archetype, dans l'ordre du tableau (donc du calque). */
const BY_ARCH: number[][] = Array.from({ length: 5 }, () => []);
VARIANTS.forEach((v, i) => BY_ARCH[v.archetype].push(i));

/**
 * Indice de variante (et de calque) d'un batiment. Deterministe : tire au hash
 * de l'id, pondere par ce que la donnee dit du batiment (hauteur, age, emprise).
 */
export function variantFor(b: VariantInput): number {
  const list = BY_ARCH[b.archetype];
  let total = 0;
  const w = list.map((i) => {
    const x = Math.max(0, VARIANTS[i].weight(b));
    total += x;
    return x;
  });
  if (total <= 0) return list[0];
  let r = hash01(b.id, 97) * total;
  for (let k = 0; k < list.length; k++) {
    r -= w[k];
    if (r < 0) return list[k];
  }
  return list[list.length - 1];
}

/** Dimensions d'une tuile de texture, en metres. */
export function tileOf(v: Variant): { tileU: number; tileV: number } {
  return { tileU: v.bays * v.bayW, tileV: v.floorH * VARIANT_FLOORS };
}

/**
 * Peint une variante : albedo en RGB (blanc = teinte du mur) et lueur des
 * fenetres, sur deux canvas opaques. facadeTextures.ts les fusionne en un
 * calque RGBA, la lueur passant dans l'alpha.
 */
export function paintVariant(index: number): { albedo: HTMLCanvasElement; glow: HTMLCanvasElement } {
  const v = VARIANTS[index];
  const style = STYLES[v.archetype];
  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = LAYER_W;
  albedo.height = glow.height = LAYER_H;
  const a = albedo.getContext("2d")!;
  const g = glow.getContext("2d")!;
  a.fillStyle = "#ffffff";
  a.fillRect(0, 0, LAYER_W, LAYER_H);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, LAYER_W, LAYER_H);

  const { tileU, tileV } = tileOf(v);
  const p: Painter = {
    a,
    g,
    style,
    v,
    cw: LAYER_W / v.bays,
    ch: LAYER_H / VARIANT_FLOORS,
    pxU: LAYER_W / tileU,
    pxV: LAYER_H / tileV,
    salt: index + 1,
  };
  v.paint(p);

  // carre de mur nu pour les bandeaux de toit et les masses sans fenetres
  a.fillStyle = "#ffffff";
  a.fillRect(0, 0, LAYER_PATCH, LAYER_PATCH);
  a.fillStyle = "rgba(0,0,0,0.10)";
  a.fillRect(0, 0, LAYER_PATCH, LAYER_PATCH);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, LAYER_PATCH, LAYER_PATCH);
  return { albedo, glow };
}

/** Point UV du carre de mur nu, commun a tous les calques. */
export const LAYER_PATCH_UV: [number, number] = [LAYER_PATCH / 2 / LAYER_W, 1 - LAYER_PATCH / 2 / LAYER_H];
