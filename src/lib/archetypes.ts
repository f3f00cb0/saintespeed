// Archetypes de facade, ancres dans les strates architecturales stephanoises.
//
// Le principe du projet tient en une phrase : la variete est pilotee par la
// donnee reelle, jamais par un tirage aleatoire. Chaque facade descend soit d'un
// tag OSM, soit d'une jointure spatiale calculee a la generation, soit, en
// dernier recours, d'un hash deterministe de l'id OSM. Rien ne scintille d'une
// frame a l'autre et la ville est identique d'un chargement au suivant.
//
// --- ce que la mesure a impose ---------------------------------------------
//
// La cascade a ete calee sur un comptage prealable des 22 509 emprises de la
// bbox, pas sur une intuition. Trois resultats ont change la conception :
//
// 1. "building:material" et "building:colour" sont quasi absents a
//    Saint-Etienne : 4 et 7 batiments. On les garde en tete de cascade parce
//    qu'ils sont la donnee la plus fidele, mais ils ne pilotent rien.
// 2. "landuse=industrial" touche 1 534 batiments (6,8 %) la ou
//    "building=industrial|warehouse" n'en touche que 118. La jointure de zone
//    vaut treize fois le tag de batiment : c'est elle qui fait exister la
//    brique des faubourgs, pas le tag.
// 3. "landuse=residential" couvre 89 % des batiments. C'est la ville entiere,
//    donc zero pouvoir discriminant : la branche residentielle de la zone est
//    volontairement absente de la cascade.
//
// Une entorse assumee, chiffree, sur l'archetype BARRE. La spec le decrit a
// 8-16 niveaux, mais seuls 95 batiments portent "building:levels >= 8" et ils
// ne sont pas dans les grands ensembles : le centre en compte 10, La Metare 3.
// La morphologie au sol ne rattrape pas le coup, teste et rejete : "plus grand
// cote >= 50 m" predit "levels >= 8" avec 18 % de precision et 15 % de rappel,
// et les 259 emprises longues et etroites hors centre ont une mediane taguee de
// 3 niveaux, ce sont des ateliers et des rangees, pas des barres. L'archetype
// BARRE ne touche donc que la matiere et la trame de fenetres. Les hauteurs
// restent celles de inferLevels, calees sur la mediane OSM mesuree.

export const enum Archetype {
  Pierre = 0, // centre haussmannien stephanois
  Brique = 1, // faubourgs miniers et manufacturiers
  Barre = 2, // grands ensembles des annees 60-70
  Moderne = 3, // verre et metal contemporain
  Faubourg = 4, // tissu ordinaire, maisons de ville
}

export const ARCHETYPE_COUNT = 5;

export const ARCHETYPE_NAMES = ["pierre", "brique", "barre", "moderne", "faubourg"];

/** Reglage complet d'un archetype, consomme par le peintre de facades. */
export type ArchetypeStyle = {
  /** Teintes de mur possibles, choisies par hash de l'id. */
  wall: number[];
  /** Toiture. */
  roof: number;
  /** Toit en pente fakee (bandeau incline) plutot que plat. */
  sloped: boolean;
  /** Part de fenetres allumees la nuit. */
  litRatio: number;
  /** Couples verre / halo des fenetres allumees. */
  warm: [string, string][];
  /** Verre eteint. */
  dark: string;
  /** Travees par tuile horizontale : pilote la densite de la trame. */
  bays: number;
  /** Largeur et hauteur de la fenetre, en fraction de la travee. */
  win: [number, number];
  /** Encadrement / meneau. */
  frame: string;
  /** Intensite emissive des fenetres allumees, franchit le seuil du bloom. */
  glow: number;
};

// Note sur une consigne ecartee : la spec demandait une reflexion speculaire
// (roughness 0,3) sur l'archetype moderne. La scene n'a qu'une hemisphereLight
// et une directionnelle rasante a 0,9, et aucune environment map. Un lobe
// speculaire n'aurait donc rien a reflechir : il produirait un unique point
// brillant au lieu d'une lecture de verre, pour le cout d'un materiau standard
// a la place d'un Lambert. Le moderne se distingue par son albedo froid et la
// teinte froide de ses fenetres, qui sont ce qui se lit reellement de nuit.

// Toutes les couleurs sont des albedo de base. La scene les refroidit et les
// assombrit (nuit bleue, brouillard, bloom des fenetres), elles paraissent donc
// plus claires ici qu'a l'ecran. Les facades sont volontairement desaturees
// pour que les fenetres chaudes ressortent.
export const STYLES: Record<Archetype, ArchetypeStyle> = {
  // Le centre autour de l'Hotel de Ville, place Dorian, rue de la Republique.
  // Pierre de taille creme, rythme de fenetres regulier, toit zinc sombre.
  [Archetype.Pierre]: {
    wall: [0xd8cdb4, 0xcfc3a6, 0xe0d6bf],
    roof: 0x3a3d42, // zinc
    sloped: true,
    litRatio: 0.35,
    warm: [
      ["#ffcf8f", "#ffb257"],
      ["#ffdaa6", "#f5a63c"],
      ["#f7e3c0", "#e8c07a"],
    ],
    dark: "#2b2d24",
    bays: 6,
    win: [0.34, 0.46],
    frame: "#6b6455",
    glow: 2.3,
  },

  // Heritage minier et manufacturier. Brique rouge-brun, bati bas et large,
  // grandes ouvertures d'atelier, linteaux pierre. Tres sombre la nuit.
  [Archetype.Brique]: {
    wall: [0x8f4a3a, 0x7d4234, 0x9c5646],
    roof: 0x2e2a28,
    sloped: false,
    litRatio: 0.12,
    warm: [
      ["#ffd9a0", "#e8a04a"],
      ["#ffcf8f", "#d4913f"],
    ],
    dark: "#231d1a",
    bays: 4, // trame industrielle large
    win: [0.52, 0.5],
    frame: "#d8cdb4", // linteaux et bandeaux, rappel pierre
    glow: 2.0,
  },

  // Barres et tours de La Metare, Beaulieu, Montchovet. Beton delave, trame de
  // fenetres dense et uniforme. La nuit, un mur de points lumineux, et c'est
  // assume : c'est la signature de ces quartiers.
  [Archetype.Barre]: {
    wall: [0x9a9488, 0x8f897d, 0xa5a094],
    roof: 0x2b2c2e,
    sloped: false,
    litRatio: 0.5, // residentiel tres habite
    warm: [
      ["#ffcf8f", "#ffb257"],
      ["#ffc98a", "#f59b3c"],
      ["#f7e3c0", "#e8c07a"],
    ],
    dark: "#26282a",
    bays: 8, // trame serree
    win: [0.42, 0.44],
    frame: "#6a7a6a", // bandes balcon desaturees
    glow: 2.4,
  },

  // Cite du Design, Zenith, promotions recentes. Gris clair froid, grandes
  // surfaces vitrees, lumiere plus froide que partout ailleurs.
  [Archetype.Moderne]: {
    wall: [0xc4c8cc, 0x2a3138, 0xb8bec4],
    roof: 0x26282b,
    sloped: false,
    litRatio: 0.3,
    warm: [
      ["#e8ecf0", "#b9c6d2"],
      ["#dfe6ec", "#a8bac9"],
    ],
    dark: "#1e242a",
    bays: 5,
    win: [0.7, 0.6], // grandes baies
    frame: "#3d444a",
    glow: 1.9,
  },

  // Le tissu ordinaire hors centre et hors barres : enduit beige melange,
  // souvent un commerce en rez.
  [Archetype.Faubourg]: {
    wall: [0xc9b79a, 0xb0a48f, 0xd0c0a4],
    roof: 0x4a3f38, // tuile assombrie
    sloped: true,
    litRatio: 0.3,
    warm: [
      ["#ffcf8f", "#ffb257"],
      ["#f7e3c0", "#e8c07a"],
    ],
    dark: "#2b2d24",
    bays: 6,
    win: [0.36, 0.44],
    frame: "#5d5546",
    glow: 2.2,
  },
};

// --- hash deterministe ------------------------------------------------------
// Meme xorshift que le reste du projet. Seede sur l'id OSM et sur un sel, pour
// tirer plusieurs valeurs independantes du meme batiment sans correlation.
export function hash01(id: number, salt: number): number {
  let x = (id | 0) ^ ((salt * 0x9e3779b9) | 0);
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

/** Ce que la cascade a besoin de savoir d'un batiment. */
export type ArchetypeInput = {
  id: number;
  /** building=*, absent si "yes". */
  kind?: string;
  /** building:levels tague, absent sinon. */
  levels?: number;
  /** building:material tague. */
  material?: string;
  /** Niveaux effectivement rendus, tagues ou deduits. */
  renderedLevels: number;
  /** Surface au sol projetee, en m2. */
  area: number;
  /** Distance a l'Hotel de Ville, en metres. */
  dist: number;
  /** "i" si le batiment tombe dans un landuse industriel ou en friche. */
  zone?: string;
  /** Masque commerce : 1 POI, 2 bord d'axe, 4 zone retail. */
  shop?: number;
};

// Seuils de centralite. Le coeur pierre est un degrade doux, pas un mur : au
// dela de PIERRE_CORE la probabilite de tomber en pierre decroit lineairement
// jusqu'a zero a PIERRE_EDGE. Ca reproduit la vraie transition centre pierre ->
// faubourgs, au lieu d'un cercle net visible depuis la voiture.
const PIERRE_CORE = 500;
const PIERRE_EDGE = 1500;

// Un grand ensemble est un immeuble d'habitation de grande emprise, loin du
// centre. On ne peut pas s'appuyer sur la hauteur, elle n'est pas dans OSM ici.
const BARRE_MIN_AREA = 240; // m2, contre 186 de mediane pour les apartments
const BARRE_MIN_DIST = 1100; // m, au dela du tissu de centre-ville

/**
 * Assigne un archetype a un batiment. Fonction pure : meme entree, meme sortie,
 * aucun etat, aucun aleatoire non seede. Premier match gagne, du signal le plus
 * fiable au plus heuristique.
 */
export function archetypeFor(b: ArchetypeInput): Archetype {
  const kind = b.kind ?? "yes";

  // --- 1. tags de matiere : la donnee la plus fidele ------------------------
  // Mesure : 4 batiments sur 22 509. On la respecte quand meme, elle est
  // toujours plus juste que n'importe quelle heuristique en dessous.
  const mat = b.material;
  if (mat) {
    if (/brick/.test(mat)) return Archetype.Brique;
    if (/glass|metal|steel/.test(mat)) return Archetype.Moderne;
    if (/concrete|cement/.test(mat)) {
      return b.renderedLevels > 7 ? Archetype.Barre : Archetype.Brique;
    }
    if (/stone|sandstone|limestone/.test(mat)) return Archetype.Pierre;
  }

  // --- 2. type de batiment --------------------------------------------------
  switch (kind) {
    case "industrial":
    case "warehouse":
    case "factory":
    case "hangar":
      return Archetype.Brique;
    case "house":
    case "detached":
    case "semidetached_house":
    case "terrace":
    case "bungalow":
      return Archetype.Faubourg;
    case "retail":
    case "supermarket":
    case "commercial":
    case "office":
      // Le tertiaire recent lit en verre, le tertiaire de centre reste pierre.
      return b.dist < PIERRE_CORE && b.renderedLevels <= 6 ? Archetype.Pierre : Archetype.Moderne;
    case "university":
    case "college":
    case "sports_centre":
    case "sports_hall":
    case "train_station":
    case "hospital":
      return Archetype.Moderne;
    case "church":
    case "cathedral":
    case "chapel":
      // Silhouette verticale sombre : la pierre sans fenetres allumees suffit,
      // le peintre de facades coupe l'eclairage sur ces emprises.
      return Archetype.Pierre;
    case "apartments":
      if (b.area >= BARRE_MIN_AREA && b.dist >= BARRE_MIN_DIST) return Archetype.Barre;
      break;
  }

  // --- 3. zone (jointure spatiale, calculee a la generation) ----------------
  // Le gros apport mesure : 1 534 batiments, treize fois le tag de batiment.
  // On ne l'applique qu'aux emprises assez grandes pour lire comme du bati
  // industriel, sinon les pavillons coinces dans une zone d'activite passent
  // en brique et le quartier devient uniformement rouge.
  if (b.zone === "i" && b.area >= 90) return Archetype.Brique;

  // --- 4. hauteur et centralite --------------------------------------------
  if (b.renderedLevels >= 8) return Archetype.Barre;

  // Degrade doux vers l'exterieur, tire au hash pour rester stable.
  if (b.renderedLevels >= 4 && b.dist < PIERRE_EDGE) {
    const p =
      b.dist <= PIERRE_CORE
        ? 1
        : 1 - (b.dist - PIERRE_CORE) / (PIERRE_EDGE - PIERRE_CORE);
    if (hash01(b.id, 7) < p) return Archetype.Pierre;
  }

  // Grande emprise d'habitation en peripherie sans tag apartments : la trame
  // beton reste la lecture la plus probable.
  if (b.area >= BARRE_MIN_AREA * 1.6 && b.dist >= BARRE_MIN_DIST && b.renderedLevels >= 4) {
    return Archetype.Barre;
  }

  return Archetype.Faubourg;
}

/** Le rez-de-chaussee recoit-il une vitrine eclairee ? */
export function hasShopFront(b: ArchetypeInput): boolean {
  // Un hangar ou une maison individuelle n'a pas de vitrine, meme au bord d'un
  // boulevard : le signal "bord d'axe" est le plus large des trois et c'est
  // celui qui deraperait.
  const kind = b.kind ?? "yes";
  if (kind === "house" || kind === "detached" || kind === "semidetached_house") return false;
  if (kind === "garage" || kind === "garages" || kind === "shed" || kind === "roof") return false;
  if (kind === "church" || kind === "cathedral" || kind === "chapel") return false;
  return (b.shop ?? 0) !== 0;
}

// --- reperes poses a la main ------------------------------------------------
// Une poignee de batiments merite un traitement bespoke, comme points d'ancrage
// visuels. Les ids sont releves dans le cache OSM (way id), pas devines.
// Geoffroy-Guichard n'y figure pas : le stade n'est pas tague "building" dans
// OSM, il n'existe donc pas dans les emprises. Le vert-noir ASSE ne se
// justifierait nulle part ailleurs, ce serait un gadget.
export type Landmark = {
  archetype: Archetype;
  /** Force la teinte de mur au lieu de la tirer au hash. */
  wall?: number;
  roof?: number;
  /**
   * Facade sans fenetres allumees. Les fenetres sont peintes dans la texture
   * de l'archetype, donc partagees : on ne peut pas baisser leur nombre pour
   * un seul batiment. En revanche on peut envoyer ses murs sur le carre de mur
   * nu de la texture, ce qui donne exactement la silhouette sombre attendue
   * d'un clocher ou d'un chevalement.
   */
  unlit?: boolean;
  label: string;
};

/** Un batiment cultuel se lit comme une masse sombre, jamais comme du logement. */
export function isUnlit(kind: string | undefined, landmark?: Landmark): boolean {
  if (landmark?.unlit) return true;
  return kind === "church" || kind === "cathedral" || kind === "chapel";
}

export const LANDMARKS = new Map<number, Landmark>([
  // Hotel de Ville : pierre monumentale du coeur de ville. Il est arrive tard
  // dans la scene, non par oubli mais parce qu'il est cartographie en relation
  // multipolygone (rel 5201020) et que l'import ne prenait que les ways : il
  // n'existait tout simplement pas. Les contours issus de relations portent
  // l'id OSM en negatif, d'ou la clef.
  [-5201020, { archetype: Archetype.Pierre, wall: 0xe2d8c1, label: "Hotel de Ville" }],
  // Cite du Design : long volume clair perfore, la signature moderne de la
  // ville. Elle etait hors de l'ancienne bbox batiments.
  [63303051, { archetype: Archetype.Moderne, wall: 0xd6dade, label: "La Platine" }],
  // Zenith : grande coque claire isolee, repere de loin sur l'est.
  [49047886, { archetype: Archetype.Moderne, wall: 0xcfd4d9, label: "Zenith" }],
  // Manufacture d'Armes : le bati manufacturier de reference, brique et pierre.
  [63261991, { archetype: Archetype.Brique, wall: 0x9c5646, label: "Ancienne Manufacture d'Armes" }],
  // Cathedrale Saint-Charles : silhouette verticale sombre, pierre, non eclairee.
  [63322493, { archetype: Archetype.Pierre, wall: 0xbfb69f, unlit: true, label: "Cathedrale Saint-Charles" }],
  // Opera : grande masse claire du centre, eclairee proprement.
  [63305534, { archetype: Archetype.Pierre, wall: 0xe2d8c1, label: "Opera" }],
  // Musee d'Art et d'Industrie : pierre monumentale du centre.
  [63340891, { archetype: Archetype.Pierre, wall: 0xded3ba, label: "Musee d'Art et d'Industrie" }],
  // Puits Couriot : le chevalement, memoire miniere, sombre et haut.
  [63308936, { archetype: Archetype.Brique, wall: 0x6f4034, label: "Chevalement du Puits Couriot" }],
  // Centrale energie de Manufrance : brique manufacturiere.
  [63330900, { archetype: Archetype.Brique, wall: 0x8f4a3a, label: "Centrale Manufrance" }],
]);
