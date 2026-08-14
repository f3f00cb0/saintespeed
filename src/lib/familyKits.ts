// Kits de famille : la geometrie proprement dite. Le choix de la famille est
// dans src/lib/families.ts, qui reste sans dependance a three.js ; ici on pose
// les volumes avec les memes primitives que les reperes bespoke
// (src/lib/landmarkGeometry.ts), et les kits sont fusionnes dans les tampons
// des tuiles par src/scene/Buildings.tsx.
//
// Ce que chaque famille pose sur l'emprise reelle est documente dans
// families.ts, avec les comptes mesures.

import { hash01 } from "./archetypes";
import type { Emit, Anchor, Dims, Tint } from "./landmarkGeometry";
import {
  addBox, addGable, addCylinder, addDome, addDisc, addGlowBox, addCross,
  addArchGlow, addSawtooth,
} from "./landmarkGeometry";
import { Family } from "./families";

// --- couleurs ---------------------------------------------------------------
// Les teintes lumineuses sont en HDR (> 1) pour franchir le seuil du bloom,
// meme convention que les kits bespoke.

const SLATE: Tint = { r: 0.17, g: 0.18, b: 0.2 }; // ardoise et zinc des toitures
const STONE: Tint = { r: 0.4, g: 0.38, b: 0.34 }; // pierre de taille de nuit
const TILE: Tint = { r: 0.29, g: 0.19, b: 0.15 }; // tuile mecanique
const METAL: Tint = { r: 0.3, g: 0.31, b: 0.34 }; // couverture metallique
const BRICK: Tint = { r: 0.36, g: 0.21, b: 0.16 }; // cheminee d'usine
const CONCRETE: Tint = { r: 0.44, g: 0.45, b: 0.48 }; // edicules de toiture

const BELFRY: [number, number, number] = [1.9, 1.5, 0.85]; // baies du beffroi
const ROSE: [number, number, number] = [1.7, 0.95, 1.2]; // rosace
const CROSS_LIGHT: [number, number, number] = [1.7, 1.55, 1.2];
const GLASS: [number, number, number] = [0.85, 1.05, 1.35]; // verriere de shed
const HALL: [number, number, number] = [1.5, 1.45, 1.2]; // hall de gare eclaire
const CLOCK: [number, number, number] = [2.0, 1.7, 1.1];
const BEACON: [number, number, number] = [2.6, 0.25, 0.2]; // feu de balisage

// --- contexte de rendu ------------------------------------------------------

export type FamilyCtx = {
  /** Loin du joueur : on ne pose que la masse, sans detail ni lumiere. */
  far: boolean;
  /** Monument historique, d'apres la table de notabilite. */
  mh: boolean;
  /** religion=*, pour departager eglise et mosquee. */
  religion?: string;
  /** Graine deterministe (id OSM). */
  id: number;
};

export type FamilyKit = (e: Emit, a: Anchor, dims: Dims, ctx: FamilyCtx) => void;

// --- culte ------------------------------------------------------------------

// En dessous de cette surface on est sur une chapelle : pas de clocher, un
// simple clocheton sur le pignon. Mesure : 9 des 56 emprises.
const CHAPEL_MAX_AREA = 260;

/**
 * Largeur de nef. Sur un plan en croix latine, la bbox de l'axe principal est
 * elargie par le transept : surface / longueur donne la largeur MOYENNE, qui
 * est la bonne portee de charpente. On la borne a la moitie de la bbox pour ne
 * pas retrecir les eglises a plan simple.
 */
function naveWidth(dims: Dims): number {
  return Math.max(dims.d * 0.5, Math.min(dims.d, dims.area / Math.max(dims.w, 1)));
}

/**
 * A quel bout de la nef poser le clocher. Une eglise est orientee : choeur a
 * l'est, entree et clocher a l'ouest. L'axe local x pointe vers l'est quand
 * cos(rot) > 0, donc le clocher va au bout -x dans ce cas, +x sinon. C'est une
 * regle vraie, pas un tirage : elle place les clochers du bon cote sur les
 * eglises reellement orientees, et ne coute rien sur les autres.
 */
function towerEnd(a: Anchor): -1 | 1 {
  return Math.cos(a.rot) > 0 ? -1 : 1;
}

const culte: FamilyKit = (e, a, dims, ctx) => {
  const H = dims.height;
  const naveW = naveWidth(dims);
  const chapel = dims.area < CHAPEL_MAX_AREA;
  const muslim = ctx.religion === "muslim";
  const side = towerEnd(a);
  const endX = side < 0 ? dims.minx : dims.maxx;

  // 1) La couverture de la nef : deux pentes le long de l'axe principal, sur un
  //    petit mur de couronnement qui tient lieu de corniche.
  const pitch = Math.max(3.5, Math.min(9, naveW * 0.45));
  addGable(e, a, null, {
    x: (dims.minx + dims.maxx) / 2,
    y: 0,
    w: dims.w,
    d: naveW,
    wallH: 0.4,
    ridgeH: 0.4 + pitch,
    base: H,
    tint: chapel ? TILE : SLATE,
    wallSkin: "plain",
  });

  // 2) L'abside : demi-tour au bout du choeur, coiffee en cone. Cheap et c'est
  //    ce qui distingue une eglise d'une halle vue de trois quarts. Le choeur
  //    est a l'oppose du clocher : on lit la bbox du bon cote, pas |endX|, qui
  //    tombait a cote des que le centroide n'etait pas au milieu de l'emprise.
  if (!chapel && !muslim) {
    const ar = naveW * 0.34;
    const choirX = side < 0 ? dims.maxx : dims.minx;
    const ax = choirX + side * ar * 0.8; // rentre dans l'emprise
    addCylinder(e, a, { x: ax, y: 0, r: ar, h: H * 0.86, base: 0, segments: 9, tint: STONE, cap: true });
    addCylinder(e, a, { x: ax, y: 0, r: ar * 1.06, rTop: 0.1, h: ar * 1.1, base: H * 0.86, segments: 9, tint: SLATE, cap: false });
  }

  if (muslim) {
    // 3a) Mosquee : dome sur la salle de priere, minaret a un angle.
    const r = Math.min(naveW, dims.w) * 0.3;
    addCylinder(e, a, { x: 0, y: 0, r: r * 1.05, h: 2.2, base: H, segments: 12, tint: STONE, cap: false });
    addDome(e, a, { x: 0, y: 0, r, base: H + 2.2, tint: METAL, bands: 6 });
    const mx = endX - side * 3.5;
    const my = (dims.miny + dims.maxy) / 2 + naveW * 0.32;
    const mh = Math.max(22, Math.min(34, H * 2));
    addCylinder(e, a, { x: mx, y: my, r: 1.5, rTop: 1.3, h: mh, base: 0, segments: 8, tint: STONE, cap: true });
    if (!ctx.far) {
      addGlowBox(e, a, { x: mx, y: my, w: 2.9, d: 2.9, h: 0.5, base: mh - 3.4, color: BELFRY });
      addDome(e, a, { x: mx, y: my, r: 1.5, base: mh, tint: METAL, bands: 4 });
    }
    return;
  }

  if (chapel) {
    // 3b) Chapelle : un clocheton sur le pignon d'entree, avec sa croix.
    const cx = endX - side * 1.4;
    addBox(e, a, null, {
      x: cx, y: 0, w: 1.8, d: 1.8, h: 3.2, base: H + pitch * 0.6,
      skin: "plain", tint: STONE, roofTint: STONE,
    });
    addCylinder(e, a, { x: cx, y: 0, r: 1.3, rTop: 0.08, h: 2.6, base: H + pitch * 0.6 + 3.2, segments: 4, tint: SLATE, cap: false });
    if (!ctx.far) {
      addCross(e, a, { x: cx, y: 0, z: H + pitch * 0.6 + 6, h: 2.2, color: CROSS_LIGHT });
    }
    return;
  }

  // 3c) Eglise : le clocher, sa fleche, son beffroi.
  const tw = Math.max(4.5, Math.min(8, naveW * 0.42));
  // Le clocher se dimensionne sur l'emprise, pas sur la hauteur de nef : celle-
  // ci sature a 18 m des 900 m2, et toutes les grandes eglises sortaient alors
  // avec exactement le meme clocher de 36 m. La racine de la surface garde un
  // ecart entre une eglise de quartier et une paroissiale, et le tirage seede
  // sur l'id (plus ou moins 8 %) evite l'effet catalogue sur 46 clochers.
  const jitter = 0.92 + hash01(ctx.id, 11) * 0.16;
  const towerH = Math.max(18, Math.min(40, 14 + Math.sqrt(dims.area) * 0.45)) * jitter;
  const tx = endX - side * tw * 0.5; // le clocher affleure le pignon d'entree
  addBox(e, a, null, {
    x: tx, y: 0, w: tw, d: tw, h: towerH, base: 0,
    skin: "plain", tint: STONE, roofTint: STONE,
  });

  // Fleche octogonale : c'est elle qui se voit du bas de la vallee.
  const spireH = Math.max(5, Math.min(14, towerH * 0.4));
  addCylinder(e, a, {
    x: tx, y: 0, r: tw * 0.55, rTop: 0.12, h: spireH, base: towerH, segments: 8, tint: SLATE, cap: false,
  });

  if (ctx.far) return;

  // Beffroi : une baie eclairee par face, juste sous la fleche.
  const belfryBase = towerH - Math.max(4, tw * 0.9);
  const bw = tw * 0.42;
  addArchGlow(e, a, { x: tx, y: -tw / 2, base: belfryBase, w: bw, hRect: tw * 0.35, color: BELFRY, axis: "y", sign: -1 });
  addArchGlow(e, a, { x: tx, y: tw / 2, base: belfryBase, w: bw, hRect: tw * 0.35, color: BELFRY, axis: "y", sign: 1 });
  addArchGlow(e, a, { x: tx + (side < 0 ? -tw / 2 : tw / 2), y: 0, base: belfryBase, w: bw, hRect: tw * 0.35, color: BELFRY, axis: "x", sign: side });

  // Croix de fleche.
  addCross(e, a, { x: tx, y: 0, z: towerH + spireH + 0.4, h: Math.max(2.5, tw * 0.5), color: CROSS_LIGHT });

  // Portail et rosace sur la facade d'entree, au nu du clocher.
  const face = tx + (side < 0 ? -tw / 2 : tw / 2);
  addArchGlow(e, a, { x: face, y: 0, base: 0, w: tw * 0.4, hRect: 3.2, color: BELFRY, axis: "x", sign: side });
  addDisc(e, a, {
    x: face + side * 0.1, y: 0, z: Math.min(towerH * 0.55, H * 0.8),
    r: Math.max(1.4, tw * 0.26), facing: side < 0 ? "x-" : "x+", color: ROSE,
  });
};

// --- halle ------------------------------------------------------------------

const halle: FamilyKit = (e, a, dims, ctx) => {
  const H = dims.height;
  // Une travee de shed fait une dizaine de metres ; on borne le compte pour ne
  // pas mailler une halle de 280 m avec trente dents.
  const bays = Math.max(3, Math.min(16, Math.round(dims.w / 11)));
  const rise = Math.max(1.8, Math.min(3.4, dims.d * 0.06));

  addSawtooth(e, a, {
    x: (dims.minx + dims.maxx) / 2,
    y: (dims.miny + dims.maxy) / 2,
    w: dims.w * 0.98,
    d: dims.d * 0.96,
    base: H,
    rise,
    bays,
    tint: METAL,
    // Au loin les verrieres passent en volume plein et sombre : le tampon
    // lumineux n'est pas construit a cette distance, et sans elles la toiture
    // serait ajouree.
    glass: ctx.far ? [0.22, 0.25, 0.3] : GLASS,
    glassTo: ctx.far ? "roofs" : "glow",
  });

  if (ctx.far) return;

  // La cheminee ne se pose que sur les sites classes : les puits, la
  // Manufacture, la centrale. Ailleurs ce serait un gadget pose sur des hangars
  // de zone d'activite.
  if (ctx.mh) {
    const cx = dims.minx + dims.w * 0.16;
    const cy = dims.miny + dims.d * 0.2;
    const ch = Math.max(22, Math.min(38, 14 + Math.sqrt(dims.area) * 0.2));
    addCylinder(e, a, { x: cx, y: cy, r: 2.1, rTop: 1.25, h: ch, base: 0, segments: 10, tint: BRICK, cap: true });
    addCylinder(e, a, { x: cx, y: cy, r: 1.5, rTop: 1.45, h: 1.2, base: ch - 1.2, segments: 10, tint: SLATE, cap: false });
  }
};

// --- gare -------------------------------------------------------------------

const gare: FamilyKit = (e, a, dims, ctx) => {
  const H = dims.height;
  const marqueeH = Math.max(4.5, Math.min(H - 1, 6));

  // Marquise : la dalle debordante au-dessus du parvis, du cote de la facade
  // principale (le grand cote). Elle reste dans l'emprise, sinon elle flotte
  // au-dessus de la rue.
  addBox(e, a, null, {
    x: (dims.minx + dims.maxx) / 2,
    y: dims.miny + dims.d * 0.14,
    w: dims.w * 0.8,
    d: Math.max(3, dims.d * 0.22),
    h: 0.5,
    base: marqueeH,
    skin: "plain",
    tint: METAL,
    roofTint: METAL,
  });

  if (ctx.far) return;

  // Verriere du hall : bandeau lumineux au nu des deux longs cotes.
  for (const s of [-1, 1] as const) {
    addGlowBox(e, a, {
      x: (dims.minx + dims.maxx) / 2,
      y: s < 0 ? dims.miny + 0.2 : dims.maxy - 0.2,
      w: dims.w * 0.82,
      d: 0.4,
      h: Math.min(4.5, H * 0.5),
      base: 1.6,
      color: HALL,
    });
  }

  // Horloge sur les deux pignons : le signal "gare" a lui tout seul.
  const z = Math.min(H - 1.6, marqueeH + 3);
  addDisc(e, a, { x: dims.maxx - 0.1, y: 0, z, r: 1.5, facing: "x+", color: CLOCK });
  addDisc(e, a, { x: dims.minx + 0.1, y: 0, z, r: 1.5, facing: "x-", color: CLOCK });
};

// --- grand ensemble ---------------------------------------------------------

const ensemble: FamilyKit = (e, a, dims, ctx) => {
  const H = dims.height;
  if (ctx.far) return; // a 700 m, la masse suffit : l'extrusion la porte deja

  // Cage d'ascenseur, posee a un tiers ou aux deux tiers de la longueur selon
  // la graine, jamais au centre exact : c'est ce qui casse la symetrie de
  // catalogue quand on longe une barre.
  const t = hash01(ctx.id, 17) < 0.5 ? 0.32 : 0.68;
  const cx = dims.minx + dims.w * t;
  const cy = (dims.miny + dims.maxy) / 2;
  const cw = Math.min(7, dims.w * 0.22);
  const cd = Math.min(5.5, dims.d * 0.5);
  addBox(e, a, null, {
    x: cx, y: cy, w: cw, d: cd, h: 3.2, base: H,
    skin: "plain", tint: CONCRETE, roofTint: CONCRETE,
  });

  // Un ou deux edicules techniques plus bas (gaines, machinerie).
  const extras = 1 + (hash01(ctx.id, 19) < 0.45 ? 1 : 0);
  for (let i = 0; i < extras; i++) {
    const u = 0.2 + 0.6 * hash01(ctx.id, 23 + i * 4);
    addBox(e, a, null, {
      x: dims.minx + dims.w * u,
      y: cy + (hash01(ctx.id, 31 + i) - 0.5) * dims.d * 0.4,
      w: Math.min(4, dims.w * 0.12),
      d: Math.min(3, dims.d * 0.3),
      h: 1.6,
      base: H,
      skin: "plain",
      tint: CONCRETE,
      roofTint: CONCRETE,
    });
  }

  // Antennes : deux tiges fines, seedees.
  if (hash01(ctx.id, 37) < 0.6) {
    addCylinder(e, a, {
      x: cx + cw * 0.3, y: cy, r: 0.14, rTop: 0.06,
      h: 4 + hash01(ctx.id, 53) * 3, base: H + 3.2, segments: 4, tint: CONCRETE, cap: false,
    });
  }

  // Feu de balisage : au dela de 35 m un batiment porte un feu rouge. De nuit
  // c'est ce qui donne l'echelle des tours de Montreynaud ou de Beaulieu.
  if (H >= 35) {
    addGlowBox(e, a, { x: cx, y: cy, w: 0.7, d: 0.7, h: 0.7, base: H + 3.2, color: BEACON });
  }
};

const KITS: (FamilyKit | null)[] = [null, culte, halle, gare, ensemble];

/** Kit d'une famille, ou null pour Family.None. */
export function kitFor(f: Family): FamilyKit | null {
  return KITS[f] ?? null;
}
