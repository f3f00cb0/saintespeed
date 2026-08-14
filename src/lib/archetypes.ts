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
// 4. Les palettes de mur et de vitres sont calees sur des photos du terrain
//    (reference/NOTES.md, calage du 2026-08-07) : pierre beige-gris et non
//    creme, beton froid et non gris chaud, vitres eteintes bleu-gris partout.
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
  // Pierre de taille beige-gris, rythme de fenetres regulier, toit zinc sombre.
  [Archetype.Pierre]: {
    // La pierre stephanoise mesuree sur photos est un beige-gris neutre, pas un
    // creme : clusters dominants #918f8c / #73706f sur l'Hotel de Ville et les
    // Nouvelles Galeries (reference/NOTES.md). Le jaune en moins, elle reste
    // distincte du faubourg, maintenant lui aussi rabattu vers le gris.
    wall: [0xd6d3ca, 0xc2bfb6, 0xe0ddd4],
    roof: 0x3a3d42, // zinc, mesure a #2e2e2d sur les photos
    sloped: true,
    litRatio: 0.35,
    warm: [
      ["#ffcf8f", "#ffb257"],
      ["#ffdaa6", "#f5a63c"],
      ["#f7e3c0", "#e8c07a"],
    ],
    dark: "#262b33", // vitrage eteint bleu-gris, reflexion mesuree #353a47
    bays: 6,
    win: [0.34, 0.46],
    frame: "#6b6455",
    glow: 2.3,
  },

  // Heritage minier et manufacturier. Brique rouge-brun, bati bas et large,
  // grandes ouvertures d'atelier, linteaux pierre. Tres sombre la nuit.
  [Archetype.Brique]: {
    // La brique de la Manufacture mesuree sur photos est plus sombre et plus
    // brune que vive : clusters #4c3529 et #684d33. On garde un rouge soutenu
    // pour la lisibilite de nuit, mais la variante brune ancre la palette.
    wall: [0x8a4636, 0x6e3a2c, 0x9a5242],
    roof: 0x2e2a28,
    sloped: false,
    litRatio: 0.12,
    warm: [
      ["#ffd9a0", "#e8a04a"],
      ["#ffcf8f", "#d4913f"],
    ],
    dark: "#222630", // vitrage eteint bleu-gris, reflexion mesuree #3565ad
    bays: 4, // trame industrielle large
    win: [0.52, 0.5],
    frame: "#d8cdb4", // linteaux et bandeaux, rappel pierre
    glow: 2.0,
  },

  // Barres et tours de La Metare, Beaulieu, Montchovet. Beton delave, trame de
  // fenetres dense et uniforme. La nuit, un mur de points lumineux, et c'est
  // assume : c'est la signature de ces quartiers.
  [Archetype.Barre]: {
    // Le beton mesure sur les panoramas est un gris froid (#b4b4b5, #babcc2),
    // pas le gris chaud d'avant : sous la lumiere bleue de nuit, le chaud
    // convergeait vers le faubourg et les deux quartiers n'en faisaient qu'un.
    wall: [0x9a9ca0, 0x8e9094, 0xa6a8ac],
    roof: 0x2b2c2e,
    sloped: false,
    litRatio: 0.5, // residentiel tres habite
    warm: [
      ["#ffcf8f", "#ffb257"],
      ["#ffc98a", "#f59b3c"],
      ["#f7e3c0", "#e8c07a"],
    ],
    dark: "#24272e",
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
    // Les enduits mesures (Montreynaud, lignes de trolley) sont neutres a
    // peine chauds (#908676, #8e8e8e), loin de l'ocre sature d'avant. On garde
    // une pointe de chaleur et on reste plus sombre que la pierre : c'est cet
    // ecart la qui les separe maintenant, plus la saturation.
    wall: [0xbcae92, 0xaa9d84, 0xc8bb9f],
    roof: 0x4a3f38, // tuile assombrie
    sloped: true,
    litRatio: 0.3,
    warm: [
      ["#ffcf8f", "#ffb257"],
      ["#f7e3c0", "#e8c07a"],
    ],
    dark: "#262b33", // vitrage eteint bleu-gris, comme la pierre
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
  /**
   * Hauteur totale mesuree (metres), prioritaire sur l'inference. Indispensable
   * aux monuments : la table inferLevels est calee sur du logement, pas sur une
   * cathedrale de 40 m. Sert aussi de base aux kits (voir src/lib/landmarks.ts).
   */
  height?: number;
  /**
   * Le kit decale l'extrusion generique : Buildings.tsx ne dessine pas ce
   * batiment, src/scene/Landmarks.tsx le rend entierement (Zenith, chevalement).
   */
  replaceBase?: boolean;
  /**
   * Orientation imposee du repere local (radians, depuis l'est), quand l'axe
   * principal ne suffit pas (batiment quasi carre dont la facade a un sens
   * precis). L'axe x local suit la facade, -y pointe vers le parvis.
   */
  rot?: number;
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
  // rot et hauteur repris le 2026-08-14 sur mesure. L'ancien rot de 0,414 rad
  // etait faux de 12,5 degres : le nu de facade coupait l'emprise en biais et
  // n'en touchait qu'un coin, si bien que le perron, les arcades et les statues
  // se posaient dans le vide. L'azimut de l'arete sud du contour donne 0,196 rad,
  // et l'emprise devient alors un rectangle de 49,4 x 82,5 m dont la facade sud
  // fait 49,3 m d'un seul tenant. La hauteur de corniche vient des photos de
  // reference/photos, mise a l'echelle sur cette largeur de facade : 18,5 m,
  // pour 22,7 m au sommet du cadran.
  [-5201020, { archetype: Archetype.Pierre, wall: 0xe2d8c1, height: 18.5, rot: 0.196, label: "Hotel de Ville" }],
  // Cite du Design : long volume clair perfore, la signature moderne de la
  // ville. Elle etait hors de l'ancienne bbox batiments.
  [63303051, { archetype: Archetype.Moderne, wall: 0xd6dade, label: "La Platine" }],
  // Zenith : grande coque claire isolee, repere de loin sur l'est. Le kit
  // remplace l'extrusion : murs vitres + voute aluminium (Foster, >25 m).
  [49047886, { archetype: Archetype.Moderne, wall: 0xcfd4d9, roof: 0xb4b8bc, height: 25, replaceBase: true, label: "Zenith" }],
  // Manufacture d'Armes : le bati manufacturier de reference, brique et pierre.
  [63261991, { archetype: Archetype.Brique, wall: 0x9c5646, label: "Ancienne Manufacture d'Armes" }],
  // Cathedrale Saint-Charles : croix latine 80 x 30 m, 40 m de haut, sans tour.
  [63322493, { archetype: Archetype.Pierre, wall: 0xbfb69f, height: 40, unlit: true, label: "Cathedrale Saint-Charles" }],
  // Opera : grande masse claire du centre, eclairee proprement.
  [63305534, { archetype: Archetype.Pierre, wall: 0xe2d8c1, label: "Opera" }],
  // Musee d'Art et d'Industrie : pierre monumentale du centre.
  [63340891, { archetype: Archetype.Pierre, wall: 0xded3ba, label: "Musee d'Art et d'Industrie" }],
  // Puits Couriot : le chevalement (35 m, metal), memoire miniere. Le kit
  // remplace l'extrusion : treillis pyramidal + molettes + salle des machines.
  [63308936, { archetype: Archetype.Brique, wall: 0x6f6f76, roof: 0x55555c, replaceBase: true, label: "Chevalement du Puits Couriot" }],
  // Centrale energie de Manufrance : brique manufacturiere.
  [63330900, { archetype: Archetype.Brique, wall: 0x8f4a3a, label: "Centrale Manufrance" }],
  // Gare de Saint-Etienne Carnot, place Sadi Carnot. Les trois emprises du
  // batiment voyageurs portent "operator=SNCF" et sont anonymes dans le cache,
  // d'ou les ids en dur. La troisieme n'existe que depuis la reparation des
  // relations multipolygones.
  //
  // Elles etaient en PIERRE, ce qui etait faux : la gare est de 1980, oeuvre de
  // M. Beynet, moderniste et en beton. Le campanile a horloge que le kit leur
  // ajoutait a ete supprime pour la meme raison (voir src/lib/landmarks.ts).
  // Les trois emprises SNCF sont SOUS les quais, pas a cote : mesure en plan,
  // elles recouvrent l'emprise des quais, et a 12,4 et 13 m elles traversaient
  // le tablier et l'abri. Leurs niveaux OSM (4) decrivent un immeuble ordinaire,
  // pas un hall sous des quais aeriens. Elles s'arretent donc sous le tablier.
  [63272393, { archetype: Archetype.Moderne, wall: 0xb2b4b6, roof: 0x3a3c3f, height: 8, label: "Gare Carnot" }],
  [63275816, { archetype: Archetype.Moderne, wall: 0xb2b4b6, roof: 0x3a3c3f, height: 8, label: "Gare Carnot" }],
  // Celle-ci est SOUS le tablier : c'est la seule emprise de la ville que le
  // viaduc traverse, mesure a l'appui (5 emprises survolees, une seule plus
  // haute que le tablier). Sa hauteur de 15,5 m etait inferee, pas taguee, et
  // l'inference est calee sur du logement : un hall de gare sous des quais
  // aeriens s'arrete sous le tablier, a 8 m.
  [-1000824, { archetype: Archetype.Moderne, wall: 0xb2b4b6, roof: 0x3a3c3f, height: 8, label: "Gare Carnot" }],
  // Les deux auvents de quai, cartographies en building=roof. Sans traitement
  // ils sortaient en murs pleins de 9,3 m de haut le long des quais, ce qui
  // ecrasait la gare au sol. replaceBase : c'est le kit qui les dessine, avec
  // les piles, le tablier et l'encadrement orange vitre.
  [1365990293, { archetype: Archetype.Moderne, wall: 0xc4581c, roof: 0xb04e18, height: 14, replaceBase: true, label: "Quai sud de la gare Carnot" }],
  [1365990292, { archetype: Archetype.Moderne, wall: 0xc4581c, roof: 0xb04e18, height: 14, replaceBase: true, label: "Quai nord de la gare Carnot" }],

  // --- silhouettes majeures, relevees le 2026-08-14 -------------------------
  // Les hauteurs viennent des niveaux reels quand la source les donne, jamais
  // de l'inference : la table inferLevels est calee sur du logement et sortait
  // ces sept emprises entre 9 et 15 m, y compris une gare a 3,1 m.
  //
  // Bourse du Travail, 1901, Lamaiziere : trois niveaux monumentaux en pierre
  // de taille de Saint-Paul-Trois-Chateaux, peristyle inscrit MH.
  [63319547, { archetype: Archetype.Pierre, wall: 0xd8cfb8, height: 15, label: "Bourse du Travail" }],
  // Nouvelles Galeries, 1894, Lamaiziere : 3 000 m2 sur TROIS niveaux. La
  // facade est sous bardage metallique depuis les annees 1960, d'ou le gris
  // froid plutot que la pierre, et le dome de la tourelle a disparu.
  [63281257, { archetype: Archetype.Pierre, wall: 0xb4b5b2, roof: 0x4a4c4e, height: 15, label: "Les Nouvelles Galeries" }],
  // Prefecture, 1895-1902 : socle plus deux niveaux monumentaux. Elle sortait
  // en archetype faubourg a 9,3 m, soit un pavillon de banlieue.
  [-1000783, { archetype: Archetype.Pierre, wall: 0xdcd3bc, height: 18, label: "Prefecture de la Loire" }],
  // La Comedie, 2017, StudioMilou : volumes bas, la cage de scene de 28 m est
  // posee par le kit.
  [63288593, { archetype: Archetype.Moderne, wall: 0x53565c, roof: 0x40434a, height: 12, label: "La Comedie" }],
  // Centre Deux, 1979 : brique rouge et masse aveugle. Il sortait en verre
  // moderne, ce qui est faux sur 26 400 m2 d'emprise.
  [63303610, { archetype: Archetype.Brique, wall: 0x8f4b3c, roof: 0x3a3330, height: 14, unlit: true, label: "Centre Deux" }],
  // Chateaucreux, 1882-1884, Bouvard pour le PLM : briques polychromes. OSM
  // tague building:levels=1, ce qui donnait un batiment voyageurs de 3,1 m ;
  // on garde le niveau unique mais a sa vraie hauteur de hall, la toiture et
  // le corps d'horloge venant du kit.
  [63322681, { archetype: Archetype.Brique, wall: 0x9c5a44, roof: 0x40342e, height: 8.5, label: "Gare de Chateaucreux" }],
  // Palais Mimard, 1893, Lamaiziere : cinq niveaux hauts, brique et pierre,
  // seul edifice neo-gothique de la ville, sur la ligne de depart.
  [63300869, { archetype: Archetype.Pierre, wall: 0xc9b79c, roof: 0x4b3f36, height: 19, label: "Le Palais Mimard" }],
]);
