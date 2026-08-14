// Kits des reperes : la silhouette de chaque monument, reprisee a la main a
// partir de dimensions REELLES (Wikipedia / site officiel / base Merimee,
// relevees le 2026-08-07 pour les six premiers et le 2026-08-14 pour les sept
// suivants), posee sur l'emprise OSM. Voir src/lib/landmarkGeometry.ts pour les
// primitives, src/scene/Landmarks.tsx pour le rendu.
//
// La difference avec les familles (src/lib/families.ts) est la source des cotes :
// une famille deduit ses proportions de l'emprise, un repere les tient d'un
// releve. Quand un batiment a une entree dans LANDMARKS, il perd sa famille :
// le bespoke prime.
//
// Dimensions sources :
//   Hotel de Ville    : Dalgabio, 1822-1830, plan carre a cour. Perron au sud,
//                       SEPT arcades egales, colonnade d'ordre colossal a
//                       l'etage noble, attique, et un simple cadran au centre :
//                       le dome de 51 m de Boisson a brule en 1952 et a ete
//                       demoli en 1953, le couronnement est PLAT depuis. Les
//                       deux statues sont La Metallurgie et La Rubanerie
//                       (Etienne Montagny, 1870 et 1872), en haut du perron.
//   Cathedrale        : croix latine 80 x 30 m, hauteur 40 m, AUCUNE tour.
//   Stade G.-Guichard : terrain 105 x 68 m, 4 tribunes, 192 projecteurs en
//                       toiture (pas de mats), vert/blanc (ASSE).
//   Zenith            : Foster, >25 m, toiture aluminium galbee + facade vitree.
//   Gare Carnot       : gare historique en pierre, pavillon d'horloge central.
//   Chevalement       : 35 m, metal, molettes Ø 5,5 m.
//   Bourse du Travail : 1901, Leon Lamaiziere. Corps central de CINQ travees,
//                       deux ailes terminees par des pavillons d'angle, pierre
//                       de taille de Saint-Paul-Trois-Chateaux, decor
//                       neoclassique. Facades, toitures et PERISTYLE inscrits
//                       MH en 2002.
//   Nouvelles Galeries: 1894, Lamaiziere. Art nouveau, ossature de fonte, angle
//                       traite en tourelle. 3 000 m2 sur TROIS niveaux. Le dome
//                       et l'horloge de la tourelle ont BRULE, et le dome a ete
//                       retire dans les annees 1960 avec la mise sous bardage
//                       metallique de la facade : on pose donc la tourelle
//                       ECIMEE, pas le dome. MH 2007.
//   Prefecture        : 1895-1902, neoclassique. QUADRILATERE a pavillons
//                       d'angle, pierre de taille, facade a DEUX niveaux sur
//                       socle, baies cintrees au premier niveau. Elle regarde
//                       la place Jean Jaures, au sud.
//   La Comedie        : 2017, StudioMilou. Trois volumes, salle de 700 places,
//                       plateau de 400 m2, et une CAGE DE SCENE DE 28 M en
//                       polycarbonate opaque qui rayonne de l'interieur : c'est
//                       une lanterne, et c'est toute sa silhouette de nuit.
//   Centre Deux       : inaugure en 1979 sur le terrain de l'ancienne prison.
//                       39 000 m2 commerciaux, 80 boutiques, grands volumes en
//                       BRIQUE ROUGE. Masse aveugle : pas de trame de fenetres.
//   Chateaucreux      : batiment voyageurs de 1882-1884, Joseph-Antoine Bouvard
//                       pour le PLM. Ossature metallique hourdee de BRIQUES
//                       POLYCHROMES, plan en U (corps central et deux ailes sur
//                       cour), entree sous marquise, toiture surmontee d'une
//                       importante HORLOGE.
//   Palais Mimard     : 1893, Lamaiziere, pour le rubanier Adrien David, achete
//                       en 1905 par Etienne Mimard (Manufrance). Seul exemple
//                       NEO-GOTHIQUE de la ville, mele de neo-renaissance
//                       italienne, brique et pierre, plan en U sur cour. MH.
//                       Il donne sur la place Anatole France, donc sur la ligne
//                       de depart du circuit.
//
// Orientation des facades principales : mesuree, pas supposee. Pour chaque
// emprise on a compare la distance des quatre milieux de facade au reseau reel
// (voir le harnais dans les notes du chantier). Deux resultats valent d'etre
// notes : la Prefecture sort cote sud, ce que confirme la source historique
// (batie au nord de l'ancienne place Marengo), et le Palais Mimard sortait
// ambigu a 30 contre 34 m, tranche par la position relevee de la place Anatole
// France, au sud du batiment.

import type { Emit, Anchor, Tint, Dims } from "./landmarkGeometry";
import {
  // addDome a disparu avec le campanile de l'Hotel de Ville, qui n'existe pas :
  // le seul dome de la ville etait celui de Boisson, demoli en 1953.
  addBox, addGable, addCylinder, addVault, addDisc, addGlowBox, addCross,
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
const SHOPFRONT: [number, number, number] = [2.1, 1.85, 1.35]; // vitrine, blanc chaud
const FOYER: [number, number, number] = [1.75, 1.6, 1.3]; // hall de theatre eclaire
// La cage de scene de la Comedie : polycarbonate opaque rayonnant de
// l'interieur. Volontairement moins violent qu'un projecteur, c'est une
// lanterne diffuse, pas une source ponctuelle.
const LANTERN: [number, number, number] = [1.45, 1.5, 1.6];
// Hotel de Ville : quatorze grandes baies sur une seule facade, c'est deux fois
// plus de surface lumineuse que sur n'importe quel autre repere. Aux valeurs
// communes le rez-de-chaussee fusionnait en un bandeau blanc sans forme sous le
// bloom. On reste au-dessus du seuil, mais de peu.
const HDV_ARCADE: [number, number, number] = [1.32, 1.0, 0.58];
const HDV_WINDOW: [number, number, number] = [1.2, 1.1, 0.86];
const STAGE: Tint = { r: 0.28, g: 0.29, b: 0.32 }; // sa base mate

// --- Hotel de Ville ---------------------------------------------------------
//
// Repris le 2026-08-14 sur les deux photos de reference/photos (Wikimedia
// Commons, dont une de juin 2025), et non plus de memoire. Le premier jet
// tenait sur les bons faits (Dalgabio, 1822-1830, plan carre a cour, perron au
// sud, SEPT arcades, La Metallurgie et La Rubanerie de Montagny 1870-1872) mais
// se trompait sur quatre points que la photo tranche :
//
//   1. Il coiffait le batiment d'un PAVILLON D'HORLOGE A FRONTON surmonte d'un
//      CAMPANILE A DOME. Rien de tout ca n'existe. Le dome de 51 m de Boisson,
//      qui abritait l'horloge et sa cloche, a brule en 1952 et a ete demoli
//      l'annee suivante : depuis, le couronnement est PLAT. L'horloge est un
//      simple cadran pose au centre de l'attique. C'etait la plus grosse
//      infidelite du kit, et elle etait assumee dans un commentaire ("on evoque
//      un campanile modeste") au lieu d'etre verifiee.
//   2. Les deux statues ne sont pas plantees a dix metres sur le parvis mais
//      sur de HAUTS SOCLES EN HAUT DU PERRON, encadrant l'arcade.
//   3. Le perron montait 3,5 m en sept marches, soit des contremarches de 50 cm
//      qu'on ne peut pas gravir. Il en fait seize, larges et basses.
//   4. Les sept arcades sont EGALES ; la travee centrale n'est pas elargie.
//
// Ce que la photo ajoute, et qui manquait : la colonnade d'ordre colossal de
// l'etage noble avec ses sept hautes fenetres cintrees, le balcon continu, la
// frise ("LIBERTE EGALITE FRATERNITE", illisible a cette echelle mais c'est le
// bandeau qui compte), l'attique a panneaux, et les deux passages voutes au
// niveau de la place sous les ailes.
//
// Repere local : x le long de la facade sud, -y vers le parvis, via le champ
// rot de LANDMARKS, corrige en meme temps que ce kit. L'emprise est alors un
// rectangle de 49,4 x 82,5 m dont la facade sud fait 49,3 m d'un seul tenant,
// ce qui permet enfin de caler l'arcade en proportion : 56 % de la largeur
// batie, mesures sur la photo frontale.
const hotelDeVille: KitBuilder = (e, a, _tex, tint, roofTint, dims) => {
  const H = dims.height; // corniche principale, 18,5 m mesures sur photo
  const facadeY = dims.miny; // nu de la facade sud, cote parvis
  const STONE: Tint = { r: 0.52, g: 0.49, b: 0.43 };

  // Le corps central occupe un peu plus de la moitie de la facade : mesure sur
  // la photo frontale, l'arcade couvre 56 % de la largeur batie.
  const arcadeW = dims.w * 0.56;
  const pitch = arcadeW / 7;

  // 1) Le grand perron. Seize marches basses et profondes, plus large que
  //    l'arcade qu'il dessert, comme sur la photo ou il deborde sous les deux
  //    statues.
  const stairRise = 3.4;
  const stairW = dims.w * 0.8;
  addStairs(e, a, {
    x: 0, yFacade: facadeY, w: stairW, depth: 8, height: stairRise, steps: 16, tint: STONE,
  });

  // 2) Le leger avant-corps du corps central, qui detache l'arcade des ailes.
  //    En PIERRE PLEINE, surtout pas avec le skin texture : la texture de facade
  //    porte la trame de fenetres courantes de l'archetype, et un avant-corps
  //    texture de 18,5 m repeignait donc des rangees de petites fenetres carrees
  //    par-dessus l'arcade et l'etage noble. On voyait litteralement deux
  //    facades superposees, une ordinaire sous la monumentale. Le corps central
  //    d'un edifice neoclassique n'a pas de trame courante : il a ses arcades,
  //    ses grandes baies cintrees et son attique, tous poses par ce kit.
  addBox(e, a, null, {
    x: 0, y: facadeY + 0.3, w: arcadeW + 2.4, d: 0.6, h: H, base: 0,
    skin: "plain", tint, roofTint: tint,
  });

  // 3) Les sept arcades en plein cintre du rez-de-chaussee sureleve, egales.
  //    Elles sont volontairement moins lumineuses que la valeur commune ARCADE :
  //    sept baies de 2,3 m cote a cote, plus sept baies a l'etage, ca fait
  //    beaucoup de surface au-dessus du seuil de bloom, et sur la capture le
  //    rez-de-chaussee virait au bandeau blanc sans forme. Assez chaud pour
  //    bloomer, assez sage pour qu'on lise les arcs et les trumeaux.
  for (let i = 0; i < 7; i++) {
    addArchGlow(e, a, {
      x: -arcadeW / 2 + pitch * (i + 0.5), y: facadeY, base: stairRise,
      w: pitch * 0.58, hRect: 3.6, color: HDV_ARCADE, axis: "y", sign: -1, offset: 0.6,
    });
  }

  // 4) La frise et le balcon continu, au-dessus des arcades. C'est le bandeau
  //    qui porte LIBERTE EGALITE FRATERNITE.
  const friezeZ = stairRise + 5.2;
  addBox(e, a, null, {
    x: 0, y: facadeY - 0.2, w: arcadeW + 2.4, d: 1.2, h: 1.6, base: friezeZ,
    skin: "plain", tint, roofTint: tint,
  });

  // 5) L'etage noble : sept hautes fenetres cintrees eclairees, et la colonnade
  //    d'ordre colossal qui les separe. C'est ce qui fait la facade de nuit.
  const nobleZ = friezeZ + 1.6;
  const nobleH = 6.2; // jusqu'a 16,4 m, la corniche couvrant les 2 m restants
  for (let i = 0; i < 7; i++) {
    addArchGlow(e, a, {
      x: -arcadeW / 2 + pitch * (i + 0.5), y: facadeY, base: nobleZ + 0.4,
      w: pitch * 0.44, hRect: 3.4, color: HDV_WINDOW, axis: "y", sign: -1, offset: 0.55,
    });
  }
  for (let i = 0; i <= 7; i++) {
    addCylinder(e, a, {
      x: -arcadeW / 2 + pitch * i, y: facadeY - 0.5, r: 0.52, h: nobleH,
      base: nobleZ, segments: 8, tint, cap: true,
    });
  }

  // 6) L'attique a panneaux, plus haut sur le corps central, et le cadran au
  //    milieu. Pas de dome, pas de campanile : le couronnement est plat depuis
  //    la demolition de 1953.
  addBox(e, a, null, {
    x: (dims.minx + dims.maxx) / 2, y: (dims.miny + dims.maxy) / 2,
    w: dims.w * 0.99, d: dims.d * 0.99, h: 2.2, base: H,
    skin: "plain", tint, roofTint,
  });
  addBox(e, a, null, {
    x: 0, y: facadeY + 4, w: arcadeW + 2.4, d: 8, h: 3, base: H,
    skin: "plain", tint, roofTint,
  });
  addBox(e, a, null, {
    x: 0, y: facadeY + 2, w: 7, d: 4, h: 1.2, base: H + 3,
    skin: "plain", tint, roofTint,
  });
  addDisc(e, a, { x: 0, y: facadeY - 0.1, z: H + 3.5, r: 1.7, facing: "y-", color: CLOCK });

  // 7) Les deux statues allegoriques, en haut du perron, sur leurs socles :
  //    La Metallurgie et La Rubanerie, Etienne Montagny, 1870 et 1872.
  for (const s of [-1, 1]) {
    const px = s * (arcadeW / 2 + 3.6);
    const py = facadeY - 2.4;
    addBox(e, a, null, {
      x: px, y: py, w: 2.4, d: 2.4, h: 3.8, base: stairRise, skin: "plain", tint: STONE, roofTint: STONE,
    });
    addCylinder(e, a, {
      x: px, y: py, r: 0.78, rTop: 0.55, h: 3.2, base: stairRise + 3.8,
      segments: 8, tint: STATUE, cap: true,
    });
  }

  // 8) Les deux passages voutes des ailes, au niveau de la place.
  for (const s of [-1, 1]) {
    addArchGlow(e, a, {
      x: s * dims.w * 0.44, y: facadeY, base: 0, w: 3.4, hRect: 2.6,
      color: HDV_ARCADE, axis: "y", sign: -1,
    });
  }

  // 9) Arcades laterales sur les facades est et ouest, cote cour.
  for (const s of [-1, 1]) {
    const fx = s > 0 ? dims.maxx : dims.minx;
    for (let i = 1; i <= 3; i++) {
      addArchGlow(e, a, {
        x: fx, y: dims.miny + (dims.d * i) / 4, base: 1.4, w: 4.2, hRect: 3.2,
        color: ARCADE, axis: "x", sign: s as -1 | 1,
      });
    }
  }
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

// --- Bourse du Travail ------------------------------------------------------
// Corps central de cinq travees encadre de deux ailes a pavillons d'angle. Le
// peristyle est protege au titre des MH, donc c'est lui qu'il faut voir : six
// colonnes et leur entablement devant le corps central, cote rue (y+ local,
// rue mesuree a 9,1 m contre 27,8 m sur l'autre long cote).
const bourseDuTravail: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const H = dims.height; // 15 m, trois niveaux monumentaux
  const front = dims.maxy;
  const STONE: Tint = { r: 0.5, g: 0.48, b: 0.42 };

  // 1) Les cinq travees du rez-de-chaussee, en baies cintrees eclairees.
  const bayW = Math.min(dims.w * 0.52, 5 * 5.4);
  const pitch = bayW / 5;
  for (let i = 0; i < 5; i++) {
    addArchGlow(e, a, {
      x: -bayW / 2 + pitch * (i + 0.5), y: front, base: 1.2,
      w: pitch * 0.62, hRect: 3.4, color: ARCADE, axis: "y", sign: 1,
    });
  }

  // 2) Le peristyle : colonnes en saillie de 2 m sur le trottoir, entablement
  //    continu. Six colonnes pour cinq travees, une par trumeau plus les deux
  //    d'about.
  const colY = front + 2;
  const colH = H * 0.62;
  for (let i = 0; i <= 5; i++) {
    addCylinder(e, a, {
      x: -bayW / 2 + pitch * i, y: colY, r: 0.62, h: colH, base: 0.6,
      segments: 8, tint: STONE, cap: true,
    });
  }
  addBox(e, a, null, {
    x: 0, y: colY, w: bayW + 2.4, d: 2.6, h: 1.5, base: 0.6 + colH,
    skin: "plain", tint: STONE, roofTint: STONE,
  });

  // 3) Fronton du corps central, au-dessus du peristyle.
  addGable(e, a, null, {
    x: 0, y: front - 3, w: bayW + 3, d: 8, wallH: 0.6, ridgeH: 3.4, base: H,
    tint: roofTint, wallSkin: "plain",
  });

  // 4) Les quatre pavillons d'angle, qui depassent la corniche des ailes.
  const pw = Math.min(11, dims.w * 0.2);
  const pd = Math.min(11, dims.d * 0.32);
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      const px = sx > 0 ? dims.maxx - pw / 2 : dims.minx + pw / 2;
      const py = sy > 0 ? dims.maxy - pd / 2 : dims.miny + pd / 2;
      addBox(e, a, tex, {
        x: px, y: py, w: pw, d: pd, h: 3.2, base: H, skin: "facade", tint, roofTint,
      });
      // toiture en pavillon : pyramide a quatre pans
      addCylinder(e, a, {
        x: px, y: py, r: Math.min(pw, pd) * 0.62, rTop: 0.1, h: 3.6,
        base: H + 3.2, segments: 4, tint: roofTint, cap: false,
      });
    }
  }
};

// --- Les Nouvelles Galeries -------------------------------------------------
// L'angle est traite en tourelle, et c'est le seul geste qui compte ici. Le
// dome qui la couronnait a brule, puis a ete retire dans les annees 1960 en
// meme temps que la facade passait sous bardage metallique : on pose donc la
// tourelle ECIMEE, terminee par une terrasse et sa couronne, exactement comme
// l'Hotel de Ville n'a pas son dome de 1952. L'angle de rue est mesure : sommet
// local (38, -19), cote de la rue Gambetta (y- local, rue a 3,7 m).
const nouvellesGaleries: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const H = dims.height; // 15 m, trois niveaux de grand magasin
  const front = dims.miny;
  const turretX = dims.maxx - 8;
  const turretY = front + 8;

  // 1) La tourelle d'angle : tambour polygonal qui monte de 5 m au-dessus de
  //    l'attique, ecime, avec une balustrade en couronnement.
  addCylinder(e, a, {
    x: turretX, y: turretY, r: 7.4, rTop: 7.4, h: 5, base: H,
    segments: 12, tint, cap: true,
  });
  addCylinder(e, a, {
    x: turretX, y: turretY, r: 7.9, rTop: 7.9, h: 0.9, base: H + 5,
    segments: 12, tint: roofTint, cap: false,
  });

  // 2) La vitrine du grand magasin : bandeau eclaire continu au rez-de-chaussee
  //    sur la facade de rue. Un grand magasin s'annonce par sa vitrine.
  addGlowBox(e, a, {
    x: (dims.minx + dims.maxx) / 2, y: front + 0.15,
    w: dims.w * 0.92, d: 0.3, h: 3.6, base: 1, color: SHOPFRONT,
  });

  // 3) Bandeau d'attique, qui donne l'assise horizontale du bardage.
  addBox(e, a, tex, {
    x: (dims.minx + dims.maxx) / 2, y: (dims.miny + dims.maxy) / 2,
    w: dims.w * 0.98, d: dims.d * 0.98, h: 1.4, base: H, skin: "facade", tint, roofTint,
  });
};

// --- Prefecture de la Loire -------------------------------------------------
// Quadrilatere a pavillons d'angle, deux niveaux sur socle, baies cintrees au
// premier niveau. Elle regarde la place Jean Jaures, au sud, soit le bout x+
// local (rue mesuree a 7,3 m, et la source historique dit bien que la
// prefecture a ete batie au nord de l'ancienne place Marengo).
const prefecture: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const H = dims.height; // 18 m, socle plus deux niveaux monumentaux
  const front = dims.maxx;
  const STONE: Tint = { r: 0.52, g: 0.5, b: 0.44 };

  // 1) Le socle : bandeau plein en pierre au pied de tout le quadrilatere.
  addBox(e, a, null, {
    x: (dims.minx + dims.maxx) / 2, y: (dims.miny + dims.maxy) / 2,
    w: dims.w * 1.01, d: dims.d * 1.01, h: 1.8, skin: "plain", tint: STONE, roofTint: STONE,
  });

  // 2) Les baies cintrees du premier niveau, sur la facade d'honneur.
  const bays = 7;
  const span = Math.min(dims.d * 0.66, bays * 5.2);
  for (let i = 0; i < bays; i++) {
    addArchGlow(e, a, {
      x: front, y: -span / 2 + (span / bays) * (i + 0.5), base: 1.8,
      w: (span / bays) * 0.55, hRect: 4.2, color: ARCADE, axis: "x", sign: 1,
    });
  }

  // 3) Le pavillon d'entree, en leger avant-corps, avec son fronton.
  const pavD = Math.min(20, dims.d * 0.4);
  addBox(e, a, tex, {
    x: front - 5, y: 0, w: 10, d: pavD, h: 2.6, base: H, skin: "facade", tint, roofTint,
  });
  addGable(e, a, null, {
    x: front - 5, y: 0, w: 10, d: pavD, wallH: 0.5, ridgeH: 3.6, base: H + 2.6,
    tint: roofTint, wallSkin: "plain",
  });

  // 4) Les quatre pavillons d'angle du quadrilatere, coiffes en pavillon.
  const pw = Math.min(14, dims.w * 0.16);
  const pd = Math.min(14, dims.d * 0.26);
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      const px = sx > 0 ? dims.maxx - pw / 2 : dims.minx + pw / 2;
      const py = sy > 0 ? dims.maxy - pd / 2 : dims.miny + pd / 2;
      addBox(e, a, tex, {
        x: px, y: py, w: pw, d: pd, h: 2.8, base: H, skin: "facade", tint, roofTint,
      });
      addCylinder(e, a, {
        x: px, y: py, r: Math.min(pw, pd) * 0.6, rTop: 0.1, h: 4.4,
        base: H + 2.8, segments: 4, tint: roofTint, cap: false,
      });
    }
  }
};

// --- La Comedie de Saint-Etienne --------------------------------------------
// Tout tient dans la cage de scene : 28 m, en polycarbonate opaque qui rayonne
// de l'interieur pendant les representations. De nuit c'est une lanterne posee
// sur des volumes bas, et c'est la seule chose qu'on reconnait de loin. Le
// plateau fait 400 m2, soit environ 20 x 20 m, ce qui donne l'emprise de la
// cage ; sa position dans l'emprise est deduite, elle, faute de plan.
const comedie: KitBuilder = (e, a, _tex, _tint, roofTint, dims) => {
  const H = dims.height; // 12 m, les volumes bas
  const cx = (dims.minx + dims.maxx) / 2;
  const cy = (dims.miny + dims.maxy) / 2;

  // 1) La cage de scene, de 0 a 28 m : une masse mate, puis la lanterne.
  addBox(e, a, null, {
    x: cx, y: cy, w: 20, d: 20, h: 18, skin: "plain", tint: STAGE, roofTint: STAGE,
  });
  addGlowBox(e, a, { x: cx, y: cy, w: 20.4, d: 20.4, h: 10, base: 18, color: LANTERN });

  // 2) Le socle vitre et l'auvent d'entree, cote parvis (x- local, la rue la
  //    plus proche a 63 m : le batiment est au milieu de la plaine Achille).
  addGlowBox(e, a, {
    x: dims.minx + 0.2, y: cy, w: 0.4, d: dims.d * 0.5, h: 4.5, base: 0.8, color: FOYER,
  });
  addBox(e, a, null, {
    x: dims.minx + 4, y: cy, w: 8, d: dims.d * 0.55, h: 0.5, base: 5.2,
    skin: "plain", tint: roofTint, roofTint,
  });

  // 3) Edicules techniques sur les volumes bas : une salle a 700 places a
  //    beaucoup de machinerie, et ca casse la lecture de simple boite.
  for (const s of [-1, 1] as const) {
    addBox(e, a, null, {
      x: cx + s * 22, y: cy + s * 8, w: 9, d: 7, h: 2.4, base: H,
      skin: "plain", tint: roofTint, roofTint,
    });
  }
};

// --- Centre Deux ------------------------------------------------------------
// 26 400 m2 d'emprise, 321 m de long : c'est la plus grande emprise de la ville
// et elle sort aujourd'hui en verre moderne, ce qui est faux. Grands volumes en
// brique rouge de 1979, masse AVEUGLE (le kit ne pose donc aucune fenetre, et
// l'entree LANDMARKS coupe la trame lumineuse). Ce qui la fait reconnaitre :
// des volumes decroches, la machinerie de toiture, et les entrees eclairees.
const centreDeux: KitBuilder = (e, a, _tex, tint, roofTint, dims) => {
  const H = dims.height; // 14 m, deduit de deux a trois niveaux commerciaux
  const cy = (dims.miny + dims.maxy) / 2;

  // 1) Trois volumes decroches le long de l'axe : la galerie n'est pas une
  //    dalle unique, elle monte et descend.
  const steps = [
    { u: 0.18, w: dims.w * 0.3, h: 4.5 },
    { u: 0.52, w: dims.w * 0.22, h: 7.5 },
    { u: 0.82, w: dims.w * 0.24, h: 3 },
  ];
  for (const s of steps) {
    addBox(e, a, null, {
      x: dims.minx + dims.w * s.u, y: cy, w: s.w, d: dims.d * 0.72, h: s.h, base: H,
      skin: "plain", tint, roofTint,
    });
  }

  // 2) Machinerie de toiture : une rangee de caissons de ventilation.
  for (let i = 0; i < 9; i++) {
    addBox(e, a, null, {
      x: dims.minx + dims.w * (0.08 + i * 0.1), y: cy + dims.d * (i % 2 ? 0.22 : -0.2),
      w: 7, d: 5, h: 2, base: H, skin: "plain", tint: roofTint, roofTint,
    });
  }

  // 3) Entrees eclairees sur les trois cotes bordes de rue (mesure : 11,1 m a
  //    l'est, 12,7 et 13,8 m sur les deux longs cotes).
  addGlowBox(e, a, { x: dims.maxx - 0.2, y: cy, w: 0.4, d: 14, h: 5, base: 0.5, color: SHOPFRONT });
  for (const sy of [-1, 1] as const) {
    addGlowBox(e, a, {
      x: dims.minx + dims.w * 0.6, y: sy > 0 ? dims.maxy - 0.2 : dims.miny + 0.2,
      w: 18, d: 0.4, h: 5, base: 0.5, color: SHOPFRONT,
    });
  }
};

// --- Gare de Chateaucreux ---------------------------------------------------
// Batiment voyageurs de 1882-1884 : ossature metallique hourdee de briques
// polychromes, plan en U (corps central, deux ailes), entree sous marquise, et
// une importante horloge en couronnement. OSM la tague building:levels=1 avec
// roof:levels=2, d'ou un corps bas et une haute toiture. Le parvis est au sud,
// soit le cote y- local.
const chateaucreux: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const H = dims.height; // 8,5 m, le niveau unique tague par OSM
  const front = dims.miny;
  const cx = (dims.minx + dims.maxx) / 2;

  // 1) Haute toiture a croupes sur toute la longueur (roof:levels=2).
  addGable(e, a, null, {
    x: cx, y: (dims.miny + dims.maxy) / 2, w: dims.w * 0.99, d: dims.d * 0.9,
    wallH: 0.5, ridgeH: 5.5, base: H, tint: roofTint, wallSkin: "plain",
  });

  // 2) Corps central plus haut, qui porte l'horloge des deux cotes.
  const bw = Math.min(22, dims.w * 0.2);
  const bd = dims.d * 0.86;
  addBox(e, a, tex, { x: cx, y: 0, w: bw, d: bd, h: 4.5, base: H, skin: "facade", tint, roofTint });
  addGable(e, a, null, {
    x: cx, y: 0, w: bw, d: bd, wallH: 0.4, ridgeH: 4.4, base: H + 4.5,
    tint: roofTint, wallSkin: "plain",
  });
  addDisc(e, a, { x: cx, y: front + 0.6, z: H + 6.2, r: 2.2, facing: "y-", color: CLOCK });
  addDisc(e, a, { x: cx, y: dims.maxy - 0.6, z: H + 6.2, r: 2.2, facing: "y+", color: CLOCK });

  // 3) La marquise du parvis, et les baies du hall sous elle.
  addBox(e, a, null, {
    x: cx, y: front + 3, w: dims.w * 0.42, d: 6, h: 0.5, base: 5.4,
    skin: "plain", tint: roofTint, roofTint,
  });
  for (let i = -2; i <= 2; i++) {
    addArchGlow(e, a, {
      x: cx + i * 7, y: front, base: 0.8, w: 4.2, hRect: 3.6,
      color: ARCADE, axis: "y", sign: -1,
    });
  }
};

// --- Le Palais Mimard -------------------------------------------------------
// Seul edifice neo-gothique de la ville, brique et pierre, plan en U sur cour.
// Il donne au sud sur la place Anatole France, donc sur la ligne de depart : il
// est vu de pres et longtemps, ce qui justifie les lucarnes et les pinacles.
// Facade principale au bout x- local (position de la place relevee au sud).
const palaisMimard: KitBuilder = (e, a, tex, tint, roofTint, dims) => {
  const H = dims.height; // 19 m, cinq niveaux hauts de 1893
  const front = dims.minx;
  const cy = (dims.miny + dims.maxy) / 2;

  // 1) Toiture neo-gothique raide sur le corps principal, faite en travers de
  //    l'emprise pour que le pignon regarde la place.
  const bodyW = Math.min(12, dims.w * 0.42);
  addGable(e, a, null, {
    x: front + bodyW / 2, y: cy, w: bodyW, d: dims.d * 0.92,
    wallH: 0.8, ridgeH: 7.5, base: H, tint: roofTint, wallSkin: "plain",
  });

  // 2) Trois lucarnes sur le rampant qui regarde la place.
  for (let i = -1; i <= 1; i++) {
    addGable(e, a, tex, {
      x: front + 2.2, y: cy + i * (dims.d * 0.26), w: 2.6, d: 2.2,
      wallH: 1.8, ridgeH: 3.4, base: H + 1, tint, wallSkin: "facade",
    });
  }

  // 3) Quatre pinacles, la signature neo-gothique.
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      addCylinder(e, a, {
        x: sx > 0 ? front + bodyW - 1 : front + 1, y: cy + sy * (dims.d * 0.42),
        r: 0.9, rTop: 0.08, h: 5.5, base: H, segments: 6, tint: roofTint, cap: false,
      });
    }
  }

  // 4) La porte cocheres eclairee du corps principal, sur la place.
  addArchGlow(e, a, {
    x: front, y: cy, base: 0, w: 3.4, hRect: 4.2, color: ARCADE, axis: "x", sign: -1,
  });
};

/** Reperes poses sur une emprise OSM existante (clef = id OSM). */
export const LANDMARK_KITS = new Map<number, KitBuilder>([
  [-5201020, hotelDeVille],
  [63322493, cathedrale],
  [63272393, gareCarnot],
  [49047886, zenith],
  [63308936, chevalement],
  [63319547, bourseDuTravail],
  [63281257, nouvellesGaleries],
  [-1000783, prefecture],
  [63288593, comedie],
  [63303610, centreDeux],
  [63322681, chateaucreux],
  [63300869, palaisMimard],
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
