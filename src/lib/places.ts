// Caractere des espaces ouverts : mineral, jardin, parc.
//
// Cible : quelqu'un qui CONNAIT Saint-Etienne mais n'arrive pas a raccrocher ce
// qu'il voit a la carte qu'il a en tete. L'information de reconnaissance est
// deja dans sa memoire, le travail est seulement de lui donner assez de points
// d'accroche corrects pour declencher le match.
//
// Ce qui separe trois places de plus loin, avant tout detail lisible, c'est le
// CARACTERE du vide, parce que la memoire est rangee comme ca :
//   - place du Peuple      mineral, dense, resserre
//   - place Jean Jaures    jardin, clos et ouvert a la fois, arbore
//   - place Carnot         parc ouvert, aere
//
// --- ce que la mesure a impose ---------------------------------------------
//
// Les trois places ne sont PAS taguees "place=square" dans OSM, contrairement a
// ce qu'on pourrait supposer : ce sont des "highway=pedestrian" nommes (Peuple
// porte meme surface=paving_stones). Seule Carnot est un place=square. La
// classification ne peut donc pas s'appuyer sur place=square, qui ne couvre que
// 27 objets sur la ville.
//
// Comptage des arbres dans un rayon de 120 m, qui valide le decoupage :
//   Jaures 114 arbres · Peuple 18 · Carnot 17
// Jaures se separe donc nettement par les arbres. Carnot NE se separe PAS de
// Peuple par les arbres : ce qui la distingue, c'est le parc de 8 367 m2 qui la
// jouxte a 9 m. Le caractere doit donc lire les deux canaux, pas seulement la
// densite d'arbres.

import type { AreaKind } from "./features";

export const enum Character {
  Mineral = 0,
  Jardin = 1,
  Parc = 2,
}

export const CHARACTER_NAMES = ["mineral", "jardin", "parc"];

export type OpenSpace = {
  kind: AreaKind;
  /** leisure=park|garden|playground quand il est tague */
  leisure?: string;
  /** surface=* OSM */
  surface?: string;
  /** place=square */
  square?: boolean;
  /** surface au sol projetee, en m2 */
  area: number;
  /** arbres OSM tombant dans le polygone */
  trees: number;
  /** metres de cloture releves le long du perimetre */
  fenceLen: number;
  /** allees dont le milieu tombe dans le polygone */
  paths: number;
};

// Seuils cales sur la mesure des espaces ouverts de la bbox, pas poses a vue.
// Voir le tableau de calibrage dans le README.
const GARDEN_MAX_AREA = 12000; // au dela, meme cloture, ca lit comme un parc
const FENCE_RATIO = 0.35; // part du perimetre equivalent qui doit etre clos
const TREE_DENSITY = 1 / 250; // un arbre pour 250 m2 = plante, pas juste borde
const BIG_PARK = 6000; // un parc franchement ouvert
const SMALL_GREEN = 1200; // en dessous, c'est un massif, pas un parc

/** Perimetre approche d'un polygone de cette surface, pour normaliser la cloture. */
function perimeterOf(area: number): number {
  // un carre de meme surface : suffisant pour une comparaison de proportion
  return 4 * Math.sqrt(Math.max(area, 1));
}

/**
 * Caractere d'un espace ouvert, ou null si ce n'est pas un espace ouvert (eau,
 * parking, terrain de sport, cimetiere, foret). Fonction pure.
 */
export function characterFor(a: OpenSpace): Character | null {
  if (a.kind !== "pedestrian" && a.kind !== "park" && a.kind !== "grass") return null;

  const fenced = a.fenceLen >= perimeterOf(a.area) * FENCE_RATIO;
  const planted = a.trees >= a.area * TREE_DENSITY;

  // --- 1. tag explicite ----------------------------------------------------
  // leisure=garden est la donnee la plus directe : c'est litteralement un
  // jardin. 124 objets sur la bbox, ils ne se discutent pas.
  if (a.leisure === "garden") return Character.Jardin;

  // --- 2. surface dure -----------------------------------------------------
  // Une place dallee est minerale, sauf quand elle est franchement plantee :
  // c'est le cas de Jean Jaures, une dalle piquetee de massifs avec 132 arbres
  // dans 130 m, contre 21 au Peuple et 23 a Dorian.
  //
  // La cloture ne peut PAS etre exigee ici, contrairement a ce qu'on attendrait
  // d'un jardin clos : mesure faite, OSM ne cartographie aucune barriere autour
  // de Jean Jaures. Exiger la cloture renvoyait la place en mineral, donc
  // identique au Peuple, et faisait tomber le test. La cloture reste un signal
  // suffisant, jamais necessaire.
  if (a.kind === "pedestrian") {
    if (planted || fenced) return Character.Jardin;
    return Character.Mineral;
  }

  // --- 3. vert : jardin clos ou parc ouvert ---------------------------------
  // La cloture est le canal le plus discriminant quand elle existe. Un jardin
  // ceinture de grilles ne ressemble a rien d'autre.
  if (fenced && a.area < GARDEN_MAX_AREA) return Character.Jardin;
  // Un massif n'est pas un parc. Les plates-bandes de Jean Jaures font 283 a
  // 501 m2 : les compter comme parc peignait la place en pelouse alors que
  // c'est une dalle piquetee de massifs.
  if (a.area < SMALL_GREEN) return Character.Jardin;
  if (a.area >= BIG_PARK) return Character.Parc;
  // Vert intermediaire non clos : plante et parcouru d'allees, c'est un
  // jardin ; sinon c'est une pelouse residuelle, qui lit comme du parc.
  if (planted && a.paths > 0) return Character.Jardin;
  return Character.Parc;
}

// --- rendu -----------------------------------------------------------------
// La distinction ne doit pas vivre dans un seul canal : elle se repartit sur
// ceux qui survivent a la distance. La couleur de sol porte le fond, la
// cloture porte le jardin, les allees portent le parc.
//
// De nuit tout est sombre et desature, comme le reste de la palette : la
// couleur ne sert qu'a distinguer les natures de sol, pas a eclairer.
export type CharacterSpec = {
  /** couleur du sol */
  ground: number;
  /** couleur des allees tracees dessus */
  path: number;
  /** allees dessinees ? le mineral se marche entierement, il n'en a pas */
  drawPaths: boolean;
  /** clotures dessinees ? */
  drawFences: boolean;
  z: number;
};

export const CHARACTERS: Record<Character, CharacterSpec> = {
  // pierre et calade, gris chaud dur : c'est le point clair de la scene, c'est
  // lui qui doit se lire comme "place dure resserree"
  [Character.Mineral]: { ground: 0x565049, path: 0x565049, drawPaths: false, drawFences: false, z: 5 },
  // Note : le mineral se subdivise en deux tons selon "surface", voir isPaved.
  // dalle plus massifs plantes : vert grisatre, plus sombre et plus mineral
  // qu'un parc, et surtout ceinture
  [Character.Jardin]: { ground: 0x2b3324, path: 0x4a4436, drawPaths: true, drawFences: true, z: 3 },
  // pelouse franche, allees de gravier clair qui la traversent
  [Character.Parc]: { ground: 0x2c3d22, path: 0x514a3c, drawPaths: true, drawFences: false, z: 2 },
};

export function characterSpec(c: Character): CharacterSpec {
  return CHARACTERS[c] ?? CHARACTERS[Character.Parc];
}

// --- dallage contre bitume --------------------------------------------------
// Une place n'est pas l'autre : le sol de la place du Peuple est tague
// "paving_stones", celui de Dorian "concrete". Sur les 164 espaces pietons de
// la bbox, 50 portent un revetement de pierre appareillee (paving_stones 33,
// sett 16, tiles 1) contre 82 en bitume ou beton. La bande claire du Peuple est
// une ancre citee par la spec, et elle est litteralement dans le tag.
const PAVED = /^(paving_stones|sett|cobblestone|tiles|marble|granite|stone)$/;

export function isPaved(surface?: string): boolean {
  return PAVED.test(surface ?? "");
}

/** Ton du sol mineral : pierre appareillee, plus claire et plus chaude, contre bitume. */
export const MINERAL_PAVED = 0x615a4e;
