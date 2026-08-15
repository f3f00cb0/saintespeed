// Les objets de la place Jean-Jaures : kiosque, bassins, sculptures.
//
// Ce ne sont pas des batiments : ils n'ont pas d'emprise dans OSM, seulement un
// point. Ils passent donc par le meme mecanisme que le stade Geoffroy-Guichard,
// une position reelle et un kit pose dessus (SYNTHETIC_LANDMARKS).
//
// Pourquoi ceux-la et pas une couche de statues instanciees : parce que la
// donnee les NOMME, avec l'auteur et la date. Un socle generique repete mettrait
// le meme objet sous un Landowski de 1912 et sous une sculpture de 2001. Ce qui
// se voit d'une place, c'est justement que ses objets ne se ressemblent pas.
//
// --- ce que dit la source ---------------------------------------------------
//
// La place, ancienne PLACE MARENGO (nommee le 14 mars 1801, devenue Jean-Jaures
// le 30 decembre 1919), est amenagee des l'origine en jardin public avec bassin,
// vegetation et kiosque. Elle forme un quadrilatere separe par la voie
// principale en deux parties, l'une carree a l'ouest, l'autre rectangulaire a
// l'est. C'est l'une des seules places stephanoises qui possede encore des
// bassins.
//
// Le KIOSQUE A MUSIQUE DE MARENGO (inscrit MH, PA00117602) est construit en
// 1870 par Mazerat, architecte de la ville. Il est entierement RECONSTRUIT EN
// 1914 sur de nouvelles fondations et avec un nouvel escalier d'acces, en
// reemployant tous les elements de FONTE de l'ancien kiosque. Sur CHAQUE FACE,
// un cartouche porte le nom d'un compositeur : Ravel, Bizet, Debussy,
// Saint-Saens, Massenet, Gounod, Faure, Berlioz, Lalo, Chabrier. Dix noms, donc
// DIX FACES : la geometrie du kiosque sort de la source elle-meme, elle n'est
// pas choisie.
//
// VENUS (Paul Belmondo, le pere de l'acteur) et APOLLON, deux statues
// monumentales installees en 1951, qui ont fait scandale a leur pose.
//
// --- ce que dit la donnee OSM ----------------------------------------------
//
// Positions relevees dans export.geojson, rayons des bassins dans la couche
// decor, et emprise reelle pour le kiosque (way 161467265). Detail que la
// mesure a sorti et qu'aucun texte ne donnait : DAPHNE est
// a 1,4 m du centre du bassin de 8,8 m. Ce n'est pas une statue posee a cote
// d'un bassin, c'est une statue DE bassin, et elle se pose donc dans l'eau.
//
// --- ce qui n'est pas source, et qui est donc annonce ----------------------
//
// Le diametre du kiosque (9 m), la hauteur de ses colonnes de fonte, les cotes
// des socles et la silhouette des figures. Les statues sont des SILHOUETTES a
// hauteur de voiture, pas des portraits : ce qui est fidele, c'est leur
// position, leur type (buste sur colonne contre statue en pied), leur matiere
// quand OSM la donne (bronze pour Daphne), et le fait qu'elles different entre
// elles. L'eclairage des bassins est un choix : de nuit, une vasque non eclairee
// est un trou noir, et la place perd ce qui fait son caractere.

import type { Tint } from "./landmarkGeometry";
import { addBox, addCylinder, addDome, addDisc, addGlowBox } from "./landmarkGeometry";
import type { KitBuilder } from "./landmarks";
import { hash01 } from "./archetypes";

const STONE: Tint = { r: 0.5, g: 0.48, b: 0.43 }; // socles et margelles
const CAST_IRON: Tint = { r: 0.24, g: 0.26, b: 0.27 }; // la fonte du kiosque
const ZINC: Tint = { r: 0.3, g: 0.32, b: 0.34 }; // sa couverture
const BRONZE: Tint = { r: 0.34, g: 0.32, b: 0.24 }; // bronze patine, de nuit

// Eau eclairee : elle part dans le tampon lumineux, donc sans eclairage de
// scene, mais SOUS le seuil du bloom. Elle ne bave pas, elle existe juste.
const WATER: [number, number, number] = [0.22, 0.36, 0.44];
const KIOSK_LIGHT: [number, number, number] = [1.5, 1.3, 0.9];

/** Dix faces, une par compositeur au cartouche. */
const KIOSK_FACES = 10;

// --- kiosque a musique de Marengo -------------------------------------------
//
// Il a une EMPRISE dans OSM, contrairement aux sculptures : way 161467265,
// building=roof, leisure=bandstand, roof:shape=conical, heritage=3, inscrit MH
// le 2 fevrier 1987. Le harnais l'a trouvee a 0,7 m du point patrimoine, alors
// que le kit etait parti sur un diametre devine de 9 m. Le kit est donc pose
// SUR l'emprise (replaceBase), et son rayon en sort : 99 m2, soit 5,62 m de
// rayon equivalent, pour un contour de 20 sommets tracé au cercle. Le nombre de
// FACES, lui, reste celui de la source : dix cartouches, dix pans.
//
// Sans ce traitement il sortait en boite generique de 3,1 m avec une trame de
// fenetres, au milieu du jardin public.
export const kiosqueMarengo: KitBuilder = (e, a, _tex, _tint, _roofTint, dims) => {
  // rayon equivalent de l'emprise reelle, et non plus une valeur choisie
  const R = Math.max(3, Math.sqrt(Math.max(dims.area, 30) / Math.PI));
  const floorZ = 1.35; // plancher sureleve, avec son escalier d'acces (1914)
  const colH = 3.4;
  const roofZ = floorZ + colH;

  // Soubassement de pierre et son emmarchement.
  addCylinder(e, a, { x: 0, y: 0, r: R + 0.35, h: floorZ, base: 0, segments: KIOSK_FACES, tint: STONE, cap: true });
  for (let i = 0; i < 3; i++) {
    addBox(e, a, null, {
      x: 0, y: -R - 0.8 - i * 0.34, w: 3.2, d: 0.7, h: floorZ - (i + 1) * (floorZ / 4),
      base: 0, skin: "plain", tint: STONE, roofTint: STONE,
    });
  }

  // Les colonnes de fonte, une par face, remployees de 1870 lors de la
  // reconstruction de 1914.
  for (let i = 0; i < KIOSK_FACES; i++) {
    const t = (i / KIOSK_FACES) * Math.PI * 2;
    addCylinder(e, a, {
      x: Math.cos(t) * (R - 0.3), y: Math.sin(t) * (R - 0.3), r: 0.14, h: colH,
      base: floorZ, segments: 6, tint: CAST_IRON, cap: false,
    });
  }

  // La frise a cartouches, puis la couverture et son epi de faitage.
  addCylinder(e, a, { x: 0, y: 0, r: R + 0.5, rTop: R + 0.5, h: 0.55, base: roofZ, segments: KIOSK_FACES, tint: CAST_IRON, cap: false });
  addCylinder(e, a, { x: 0, y: 0, r: R + 0.7, rTop: R * 0.28, h: 1.9, base: roofZ + 0.55, segments: KIOSK_FACES, tint: ZINC, cap: true });
  addDome(e, a, { x: 0, y: 0, r: R * 0.28, base: roofZ + 2.45, tint: ZINC, bands: 3 });
  addCylinder(e, a, { x: 0, y: 0, r: 0.1, rTop: 0.03, h: 1.2, base: roofZ + 2.45 + R * 0.28, segments: 4, tint: CAST_IRON, cap: false });

  // Un kiosque eclaire par en dessous : c'est ce qui le fait exister de nuit.
  addGlowBox(e, a, { x: 0, y: 0, w: R * 1.5, d: R * 1.5, h: 0.12, base: roofZ - 0.2, color: KIOSK_LIGHT });
};

// --- bassins ----------------------------------------------------------------
/** Margelle de pierre et plan d'eau. Le rayon vient de la donnee OSM. */
const bassin = (radius: number): KitBuilder => (e, a) => {
  const rim = 0.45;
  addCylinder(e, a, { x: 0, y: 0, r: radius, h: rim, base: 0, segments: 18, tint: STONE, cap: true });
  addCylinder(e, a, { x: 0, y: 0, r: radius - 0.55, h: rim - 0.12, base: 0, segments: 18, tint: STONE, cap: true });
  addDisc(e, a, { x: 0, y: 0, z: rim - 0.1, r: radius - 0.55, facing: "up", color: WATER });
};

// --- sculptures -------------------------------------------------------------
//
// Deux familles, et c'est la seule chose que la silhouette doit dire : un BUSTE
// est une masse courte sur une colonne haute, une STATUE EN PIED est une masse
// elancee sur un socle bas. A hauteur de voiture, c'est ce qui les distingue.

const buste = (h: number): KitBuilder => (e, a) => {
  addBox(e, a, null, { x: 0, y: 0, w: 1.5, d: 1.5, h: 0.35, base: 0, skin: "plain", tint: STONE, roofTint: STONE });
  addBox(e, a, null, { x: 0, y: 0, w: 1, d: 1, h, base: 0.35, skin: "plain", tint: STONE, roofTint: STONE });
  // buste : epaules puis tete
  addCylinder(e, a, { x: 0, y: 0, r: 0.42, rTop: 0.3, h: 0.62, base: 0.35 + h, segments: 8, tint: BRONZE, cap: true });
  addDome(e, a, { x: 0, y: 0, r: 0.24, base: 0.35 + h + 0.62, tint: BRONZE, bands: 3 });
};

const statue = (socle: number, corps: number): KitBuilder => (e, a) => {
  addBox(e, a, null, { x: 0, y: 0, w: 1.9, d: 1.9, h: 0.3, base: 0, skin: "plain", tint: STONE, roofTint: STONE });
  addBox(e, a, null, { x: 0, y: 0, w: 1.4, d: 1.4, h: socle, base: 0.3, skin: "plain", tint: STONE, roofTint: STONE });
  const z = 0.3 + socle;
  addCylinder(e, a, { x: 0, y: 0, r: 0.34, rTop: 0.26, h: corps * 0.62, base: z, segments: 8, tint: BRONZE, cap: true });
  addCylinder(e, a, { x: 0, y: 0, r: 0.3, rTop: 0.22, h: corps * 0.28, base: z + corps * 0.62, segments: 8, tint: BRONZE, cap: true });
  addDome(e, a, { x: 0, y: 0, r: 0.19, base: z + corps * 0.9, tint: BRONZE, bands: 3 });
};

// --- typologies de l'espace public -----------------------------------------
//
// Les 49 objets ponctuels de src/lib/monumentPoints.ts. On ne pose que les
// types ou la FORME DECOULE DU TYPE : une croix de chemin est un fut sur un
// emmarchement avec une croix au sommet, un monument aux morts est un obelisque
// sur un socle, une stele est une dalle dressee. Ce sont des typologies, pas des
// portraits, et c'est justement ce qui les rend defendables : le tag OSM porte
// la forme.
//
// Les sculptures contemporaines ne sont PAS ici, et c'est un choix : leur forme
// est ce qu'aucune etiquette ne determine. Voir l'en-tete du fichier genere.

/** Croix de chemin : emmarchement, fut, croix. Tres present dans le Forez. */
const croixDeChemin = (h: number): KitBuilder => (e, a) => {
  addBox(e, a, null, { x: 0, y: 0, w: 1.5, d: 1.5, h: 0.28, base: 0, skin: "plain", tint: STONE, roofTint: STONE });
  addBox(e, a, null, { x: 0, y: 0, w: 1.1, d: 1.1, h: 0.26, base: 0.28, skin: "plain", tint: STONE, roofTint: STONE });
  addCylinder(e, a, { x: 0, y: 0, r: 0.22, rTop: 0.16, h, base: 0.54, segments: 6, tint: STONE, cap: true });
  const z = 0.54 + h;
  addBox(e, a, null, { x: 0, y: 0, w: 0.16, d: 0.16, h: 0.95, base: z, skin: "plain", tint: CAST_IRON, roofTint: CAST_IRON });
  addBox(e, a, null, { x: 0, y: 0, w: 0.62, d: 0.14, h: 0.15, base: z + 0.5, skin: "plain", tint: CAST_IRON, roofTint: CAST_IRON });
};

/** Monument aux morts : socle a deux ressauts et obelisque. */
const monumentAuxMorts = (h: number): KitBuilder => (e, a) => {
  addBox(e, a, null, { x: 0, y: 0, w: 3.2, d: 2.2, h: 0.3, base: 0, skin: "plain", tint: STONE, roofTint: STONE });
  addBox(e, a, null, { x: 0, y: 0, w: 2.4, d: 1.6, h: 0.55, base: 0.3, skin: "plain", tint: STONE, roofTint: STONE });
  addBox(e, a, null, { x: 0, y: 0, w: 1.5, d: 1.1, h: 0.9, base: 0.85, skin: "plain", tint: STONE, roofTint: STONE });
  addCylinder(e, a, { x: 0, y: 0, r: 0.62, rTop: 0.3, h, base: 1.75, segments: 4, tint: STONE, cap: true });
  addCylinder(e, a, { x: 0, y: 0, r: 0.3, rTop: 0.02, h: 0.7, base: 1.75 + h, segments: 4, tint: STONE, cap: false });
};

/** Stele : dalle dressee sur un socle bas. */
const stele = (h: number): KitBuilder => (e, a) => {
  addBox(e, a, null, { x: 0, y: 0, w: 1.6, d: 1.1, h: 0.25, base: 0, skin: "plain", tint: STONE, roofTint: STONE });
  addBox(e, a, null, { x: 0, y: 0, w: 1.15, d: 0.42, h, base: 0.25, skin: "plain", tint: STONE, roofTint: STONE });
  addDome(e, a, { x: 0, y: 0, r: 0.575, base: 0.25 + h, tint: STONE, bands: 3 });
};

/**
 * Kit d'une typologie. `seed` fait varier les hauteurs de plus ou moins 10 % :
 * ces objets sont poses par dizaines, et deux croix de chemin identiques au
 * centimetre trahissent le procedural plus surement qu'une forme approximative.
 */
export function kitForPointKind(kind: number, seed: number): KitBuilder | null {
  const v = 0.9 + hash01(seed, 7) * 0.2;
  switch (kind) {
    case 0: return croixDeChemin(2.1 * v);
    case 1: return monumentAuxMorts(2.6 * v);
    case 2: return stele(1.7 * v);
    case 3: return buste(2.3 * v);
    case 4: return statue(1.2 * v, 2.2 * v);
    default: return null;
  }
}

export type PlaceMonument = {
  key: string;
  lon: number;
  lat: number;
  rot: number;
  build: KitBuilder;
  /** Ce que la source dit, garde a cote de la geometrie. */
  note: string;
};

/**
 * Place Jean-Jaures. Positions relevees dans export.geojson, rayons de bassin
 * dans la couche decor. L'orientation n'est pas cartographiee : elle vaut zero,
 * ce qui n'a d'effet que sur des volumes de revolution.
 */
export const PLACE_MONUMENTS: PlaceMonument[] = [
  {
    key: "bassin-ouest",
    lon: 4.385991, lat: 45.441242, rot: 0,
    build: bassin(10.3),
    note: "bassin, rayon 10,3 m releve dans OSM",
  },
  {
    key: "bassin-est",
    lon: 4.387, lat: 45.441168, rot: 0,
    build: bassin(8.8),
    note: "bassin, rayon 8,8 m releve dans OSM ; Daphne se tient dedans",
  },
  {
    key: "daphne",
    lon: 4.387003, lat: 45.441156, rot: 0,
    build: statue(0.9, 2.3),
    note: "Daphne changee en Lauriers, Jules Dercheu, bronze, dans le bassin est",
  },
  {
    key: "venus-belmondo",
    lon: 4.3863, lat: 45.441385, rot: 0,
    build: statue(1.3, 2.4),
    note: "Venus, Paul Belmondo, 1951",
  },
  {
    key: "apollon",
    lon: 4.386357, lat: 45.441181, rot: 0,
    build: statue(1.3, 2.4),
    note: "Apollon, Serge Goldberg, 1951, pose en meme temps que la Venus",
  },
  {
    key: "buste-jean-jaures",
    lon: 4.387083, lat: 45.44087, rot: 0,
    build: buste(2.4),
    note: "buste de Jean Jaures, Emile Tournayre, 1931",
  },
  {
    key: "buste-jose-frappa",
    lon: 4.386808, lat: 45.441852, rot: 0,
    build: buste(2.2),
    note: "buste de Jose Frappa, Georges Bareau, 1912",
  },
];
