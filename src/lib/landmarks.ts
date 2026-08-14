// Kits des reperes : la silhouette de chaque monument, reprisee a la main a
// partir de dimensions REELLES (Wikipedia / site officiel, relevees le
// 2026-08-07), posee sur l'emprise OSM. Voir src/lib/landmarkGeometry.ts pour
// les primitives, src/scene/Landmarks.tsx pour le rendu.
//
// Dimensions sources :
//   Hotel de Ville    : neoclassique, plan carre a cour, dome de 51 m DETRUIT
//                       en 1952 -> on evoque un campanile modeste, pas le dome.
//   Cathedrale        : croix latine 80 x 30 m, hauteur 40 m, AUCUNE tour.
//   Stade G.-Guichard : terrain 105 x 68 m, 4 tribunes, 192 projecteurs en
//                       toiture (pas de mats), vert/blanc (ASSE).
//   Zenith            : Foster, >25 m, toiture aluminium galbee + facade vitree.
//   Gare Carnot       : gare historique en pierre, pavillon d'horloge central.
//   Chevalement       : 35 m, metal, molettes Ø 5,5 m.

import type { Emit, Anchor, Tint, Dims } from "./landmarkGeometry";
import {
  addBox, addGable, addCylinder, addDome, addVault, addDisc, addGlowBox, addCross,
  addArchGlow, addStairs,
} from "./landmarkGeometry";
import type { Painted } from "./facadeTextures";

/**
 * Dimensions de l'emprise dans le repere local du repere : meme structure que
 * pour les kits de famille, definie avec les primitives (landmarkGeometry).
 */
export type LandmarkDims = Dims;

export type KitBuilder = (
  e: Emit,
  a: Anchor,
  tex: Painted,
  tint: Tint,
  roofTint: Tint,
  dims: LandmarkDims,
) => void;

// Couleurs d'accent (lumineuses), toutes en HDR pour franchir le seuil du bloom.
const CLOCK: [number, number, number] = [2.0, 1.7, 1.1]; // cadran chaud
const CROSS: [number, number, number] = [1.7, 1.55, 1.2];
const FLOOD: [number, number, number] = [2.4, 2.4, 2.6]; // projecteurs blanc froid
const MOLETTE: [number, number, number] = [0.5, 0.5, 0.55]; // metal non eclaire
const ARCADE: [number, number, number] = [1.9, 1.45, 0.8]; // baie voutee chaude
const STATUE: Tint = { r: 0.42, g: 0.38, b: 0.3 }; // bronze patine

// --- Hotel de Ville ---------------------------------------------------------
// Corps principal garde (emprise reelle en anneau a cour, orientee par le
// champ rot : x local le long de la facade sud, -y vers le parvis). Le kit
// ajoute ce qui la rend reconnaissable : le grand perron, les sept arcades en
// plein cintre du rez-de-chaussee suréleve, les deux statues allegoriques qui
// encadrent la montee, le pavillon d'horloge a fronton au-dessus de l'entree,
// et le campanile du carillon. L'axe x suit la facade, donc tout se pose en
// fonction de dims.miny (le nu de la facade sud).
const hotelDeVille: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const H = dims.height; // corps principal (16 m)
  const facadeY = dims.miny; // facade sud, cote parvis
  const STONE: Tint = { r: 0.52, g: 0.49, b: 0.43 };

  // Largeur de l'arcade : les sept travees occupent le coeur de la facade.
  const arcadeW = Math.min(dims.w * 0.8, 7 * 6.6);
  const pitch = arcadeW / 7;

  // 1) Le grand perron : monte du parvis jusqu'au rez-de-chaussee suréleve,
  //    presque aussi large que l'arcade qu'il dessert.
  const stairRise = 3.5;
  const stairW = arcadeW * 0.85;
  addStairs(e, a, {
    x: 0, yFacade: facadeY, w: stairW, depth: 12, height: stairRise, steps: 7, tint: STONE,
  });

  // 2) Les sept arcades en plein cintre, au nu de la facade sud. La travee du
  //    milieu (entree principale) est un peu plus large.
  for (let i = 0; i < 7; i++) {
    const x = -arcadeW / 2 + pitch * (i + 0.5);
    const main = i === 3;
    addArchGlow(e, a, {
      x, y: facadeY, base: stairRise, w: pitch * (main ? 0.8 : 0.6),
      hRect: main ? 4 : 3.4, color: ARCADE, axis: "y", sign: -1,
    });
  }

  // 3) Les deux statues (La Rubanerie, La Metallurgie) au bas du perron.
  for (const s of [-1, 1]) {
    const px = s * (stairW / 2 + 2.6);
    const py = facadeY - 10;
    addBox(e, a, null, { x: px, y: py, w: 2, d: 2, h: 2.4, base: 0, skin: "plain", tint: STONE, roofTint: STONE });
    addCylinder(e, a, { x: px, y: py, r: 0.55, rTop: 0.42, h: 2.7, base: 2.4, segments: 8, tint: STATUE, cap: true });
  }

  // 4) Arcades laterales sur les facades est et ouest.
  for (const s of [-1, 1]) {
    const fx = s > 0 ? dims.maxx : dims.minx;
    for (let i = 1; i <= 3; i++) {
      const yy = dims.miny + (dims.d * i) / 4;
      addArchGlow(e, a, {
        x: fx, y: yy, base: 1.4, w: 4.2, hRect: 3.2, color: ARCADE,
        axis: "x", sign: s as -1 | 1,
      });
    }
  }

  // 5) Le pavillon d'horloge au-dessus de l'entree, fronton + cadran.
  const pavW = 15, pavD = 12, pavH = 5;
  const pavY = facadeY + pavD / 2;
  addBox(e, a, tex, { x: 0, y: pavY, w: pavW, d: pavD, h: pavH, base: H, skin: "facade", tint, roofTint });
  addGable(e, a, null, { x: 0, y: pavY, w: pavW, d: pavD, wallH: 0, ridgeH: 2.6, base: H + pavH, tint: roofTint, wallSkin: "plain" });
  addDisc(e, a, { x: 0, y: pavY - pavD / 2, z: H + 3.1, r: 1.9, facing: "y-", color: CLOCK });

  // 6) Le campanile du carillon, au sommet du pavillon.
  const campBase = H + pavH + 2.6;
  addCylinder(e, a, { x: 0, y: pavY, r: 2.1, rTop: 1.9, h: 4.2, base: campBase, segments: 10, tint, cap: true });
  addDome(e, a, { x: 0, y: pavY, r: 2.0, base: campBase + 4.2, tint: roofTint, bands: 4 });
};

// --- Cathedrale Saint-Charles ----------------------------------------------
// La masse sombre en croix latine vient de l'extrusion ; le kit y pose la
// lanterne du transept surmontee de sa croix, une rosace lumineuse sur la
// facade occidentale, et quatre pinacles aux coins du transept pour accrocher
// la lumiere et donner le rythme gothique. L'edifice n'a jamais eu de tours.
const ROSE: [number, number, number] = [1.8, 1.0, 1.25]; // vitrail rose
const cathedrale: KitBuilder = (e, a, _tex, tint, roofTint, dims) => {
  const H = dims.height; // 40 m, voir landmark.height
  // lanterne du croisillon + croix
  addCylinder(e, a, { x: 0, y: 0, r: 4.2, rTop: 3.6, h: 7, base: H, segments: 10, tint, cap: true });
  addCross(e, a, { x: 0, y: 0, z: H + 7.5, h: 6, color: CROSS });
  // rosace sur la facade occidentale (pignon de la nef)
  addDisc(e, a, { x: dims.minx, y: 0, z: H * 0.62, r: 4.2, facing: "x-", color: ROSE });
  // quatre pinacles aux coins du transept
  const tx = dims.w * 0.10, ty = dims.d / 2 - 2.5;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      addCylinder(e, a, {
        x: sx * tx, y: sy * ty, r: 1.4, rTop: 0.15, h: 9, base: H, segments: 6, tint: roofTint, cap: false,
      });
    }
  }
};

// --- Gare Carnot ------------------------------------------------------------
// Batiment voyageurs historique : campanile d'horloge elance au centre de la
// facade, grandes baies voutrees du hall, et fronton.
const gareCarnot: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const H = dims.height; // 13 m, voir landmark.height
  // campanile central, plus haut que le corps
  const cw = Math.min(7, dims.w * 0.35);
  const cd = Math.min(7, dims.d * 0.9);
  addBox(e, a, tex, { x: 0, y: 0, w: cw, d: cd, h: 9, base: H, skin: "facade", tint, roofTint });
  addDisc(e, a, { x: cw / 2 + 0.1, y: 0, z: H + 6.2, r: 2.0, facing: "x+", color: CLOCK });
  addDisc(e, a, { x: -cw / 2 - 0.1, y: 0, z: H + 6.2, r: 2.0, facing: "x-", color: CLOCK });
  // fleche du campanile
  addCylinder(e, a, { x: 0, y: 0, r: cw * 0.48, rTop: 0.1, h: 5, base: H + 9, segments: 4, tint: roofTint, cap: false });
  // grandes baies voutrees du hall, au nu des deux pignons
  for (const s of [-1, 1]) {
    const fx = s > 0 ? dims.maxx : dims.minx;
    addArchGlow(e, a, { x: fx, y: 0, base: 1.2, w: Math.min(5.5, dims.d * 0.6), hRect: 5.5, color: ARCADE, axis: "x", sign: s as -1 | 1 });
  }
};

// --- Zenith -----------------------------------------------------------------
// Remplace l'extrusion : murs vitres + toiture aluminium en berceau (Foster).
const zenith: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const wallH = 15;
  addBox(e, a, tex, { x: 0, y: 0, w: dims.w, d: dims.d, h: wallH, skin: "facade", tint, roofTint });
  addVault(e, a, { x: 0, y: 0, w: dims.w * 1.03, d: dims.d * 0.98, h: 10, base: wallH, tint: roofTint });
};

// --- Chevalement du Puits Couriot ------------------------------------------
// Remplace l'extrusion : treillis metallique pyramidal de 35 m + molettes, et
// la salle des machines en contrebas.
const chevalement: KitBuilder = (e, a, tex, tint, _roofTint) => {
  const BRICK: Tint = { r: 0.42, g: 0.24, b: 0.18 };
  const BRICK_ROOF: Tint = { r: 0.16, g: 0.14, b: 0.13 };
  addCylinder(e, a, { x: 0, y: 0, r: 6, rTop: 2.4, h: 35, base: 0, segments: 4, tint, cap: true });
  addDisc(e, a, { x: 0, y: 0, z: 32.5, r: 2.75, facing: "x+", color: MOLETTE });
  addDisc(e, a, { x: 0, y: 0, z: 32.5, r: 2.75, facing: "x-", color: MOLETTE });
  addBox(e, a, tex, { x: 13, y: 0, w: 11, d: 8, h: 7, base: 0, skin: "facade", tint: BRICK, roofTint: BRICK_ROOF });
};

// --- Stade Geoffroy-Guichard (synthetique) ---------------------------------
// Pas un building OSM : pose a ses vraies coordonnees. Cuvette rectangulaire
// fermee (config Euro 2016), pelouse, bandeau de projecteurs en toiture.
const stade: KitBuilder = (e, a) => {
  const CONCRETE: Tint = { r: 0.42, g: 0.43, b: 0.46 };
  const ROOF: Tint = { r: 0.3, g: 0.31, b: 0.34 };
  const PITCH: Tint = { r: 0.1, g: 0.22, b: 0.12 };

  const pitchL = 105, pitchW = 68;
  const standH = 22, standD = 18, margin = 6;
  const outerL = pitchL + 2 * (margin + standD);
  const outerW = pitchW + 2 * (margin + standD);

  // pelouse
  const hl = pitchL / 2, hw2 = pitchW / 2;
  const g0 = [ -hl, -hw2 ], g1 = [ hl, -hw2 ], g2 = [ hl, hw2 ], g3 = [ -hl, hw2 ];
  const gw = (p: number[]) => {
    const c = Math.cos(a.rot), s = Math.sin(a.rot);
    return [a.x + p[0] * c - p[1] * s, a.y + p[0] * s + p[1] * c];
  };
  const q0 = gw(g0), q1 = gw(g1), q2 = gw(g2), q3 = gw(g3);
  e.roofs.pos.push(
    q0[0], 0.4, -q0[1], q1[0], 0.4, -q1[1], q2[0], 0.4, -q2[1],
    q0[0], 0.4, -q0[1], q2[0], 0.4, -q2[1], q3[0], 0.4, -q3[1],
  );
  for (let i = 0; i < 6; i++) { e.roofs.norm.push(0, 1, 0); e.roofs.uv.push(0, 0); e.roofs.col.push(PITCH.r, PITCH.g, PITCH.b); }

  // quatre tribunes formant l'anneau ferme
  const yOff = outerW / 2 - standD / 2;
  const xOff = outerL / 2 - standD / 2;
  addBox(e, a, null, { x: 0, y: yOff, w: outerL, d: standD, h: standH, skin: "plain", tint: CONCRETE, roofTint: ROOF });
  addBox(e, a, null, { x: 0, y: -yOff, w: outerL, d: standD, h: standH, skin: "plain", tint: CONCRETE, roofTint: ROOF });
  addBox(e, a, null, { x: xOff, y: 0, w: standD, d: outerW - 2 * standD, h: standH, skin: "plain", tint: CONCRETE, roofTint: ROOF });
  addBox(e, a, null, { x: -xOff, y: 0, w: standD, d: outerW - 2 * standD, h: standH, skin: "plain", tint: CONCRETE, roofTint: ROOF });

  // bandeau de projecteurs integre en toiture
  addGlowBox(e, a, { x: 0, y: yOff, w: outerL * 0.96, d: 1.2, h: 0.6, base: standH, color: FLOOD });
  addGlowBox(e, a, { x: 0, y: -yOff, w: outerL * 0.96, d: 1.2, h: 0.6, base: standH, color: FLOOD });
  addGlowBox(e, a, { x: xOff, y: 0, w: 1.2, d: (outerW - 2 * standD) * 0.96, h: 0.6, base: standH, color: FLOOD });
  addGlowBox(e, a, { x: -xOff, y: 0, w: 1.2, d: (outerW - 2 * standD) * 0.96, h: 0.6, base: standH, color: FLOOD });
};

/** Reperes poses sur une emprise OSM existante (clef = id OSM). */
export const LANDMARK_KITS = new Map<number, KitBuilder>([
  [-5201020, hotelDeVille],
  [63322493, cathedrale],
  [63272393, gareCarnot],
  [49047886, zenith],
  [63308936, chevalement],
]);

/** Repere sans emprise OSM : position + orientation reelles. */
export const SYNTHETIC_LANDMARKS: {
  key: string;
  lon: number;
  lat: number;
  rot: number;
  build: KitBuilder;
}[] = [
  // Geoffroy-Guichard : la pelouse est orientee nord-sud, donc l'axe principal
  // du kit (x local) pointe vers le nord.
  { key: "stade-geoffroy-guichard", lon: 4.390344, lat: 45.460856, rot: Math.PI / 2, build: stade },
];
