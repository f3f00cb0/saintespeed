// GENERE par scripts/build-notable.mjs depuis export.geojson. Ne pas editer a
// la main : relancer `npm run build-notable`.
//
// Objets ponctuels de l'espace public : 49 points, croix 14, guerre 10, stele 6, buste 6, statue 13.
//
// Le filtre est mesure, pas suppose. Sur les 261 points de l'export :
//   8 sont des oeuvres CONTEMPORAINES (posterieures a 1950) : leur
//      forme ne decoule d'aucune etiquette, meme quand OSM les tague "statue" ;
//   2 sont deja posees par un kit bespoke, les reposer les mettrait en double ;
//   181 sont d'un type dont la forme ne decoule PAS du type (sculptures
//      contemporaines, oeuvres, plaques, peintures murales), ou ne sont pas des
//      objets du tout (points de vue, noms de gare et de place, musees) ;
//   6 tombent DANS un batiment : ce sont des points d'interet
//      d'interieur, il n'y a rien a poser dans la rue ;
//   2 sont dans un cimetiere ;
//   13 sont a plus de 30 m de toute chaussee, donc invisibles depuis la
//      voiture ;
//   0 tombent en pleine chaussee et ne peuvent pas en etre sortis.
//
// 1 objets ont ete pousses perpendiculairement hors de la chaussee, de moins
// de 3 m : leur position OSM est juste, c'est la largeur de chaussee du rendu
// qui est une convention.
//
// Donnees OpenStreetMap sous ODbL.

/** Typologies ou la forme decoule du type. */
export const enum PointKind {
  Croix = 0,
  Guerre = 1,
  Stele = 2,
  Buste = 3,
  Statue = 4,
}

export const POINT_KIND_NAMES = ["croix","guerre","stele","buste","statue"];

/** [lon, lat, type, nom] */
export const MONUMENT_POINTS: [number, number, PointKind, string][] = [
  [4.367577, 45.392258, 0, ""],
  [4.33261, 45.397916, 1, ""],
  [4.336769, 45.398892, 0, ""],
  [4.36178, 45.399661, 2, ""],
  [4.366262, 45.403881, 4, "Statue de Michel Rondet"],
  [4.370667, 45.404913, 1, ""],
  [4.386874, 45.406186, 4, ""],
  [4.419994, 45.415855, 0, ""],
  [4.417416, 45.417981, 2, ""],
  [4.405758, 45.420175, 0, ""],
  [4.427273, 45.421266, 0, ""],
  [4.398154, 45.422423, 0, ""],
  [4.414114, 45.422428, 0, ""],
  [4.397304, 45.426432, 2, ""],
  [4.39117, 45.426983, 4, "Femme qui marche"],
  [4.383615, 45.427611, 4, "Victoire de Samothrace"],
  [4.390566, 45.430715, 3, "Monument à la mémoire d'Antoine Durafour"],
  [4.387816, 45.431274, 4, "L'Égyptienne"],
  [4.389191, 45.431595, 4, "Le Coq Gaulois"],
  [4.387261, 45.431814, 4, "Ouvrier terrassier"],
  [4.388311, 45.431859, 1, "Monument Au 102ème Territorial"],
  [4.390461, 45.432252, 2, ""],
  [4.386162, 45.435346, 4, "Le Loup"],
  [4.436744, 45.435815, 1, ""],
  [4.385161, 45.436407, 4, "Jeanne d'Arc"],
  [4.386461, 45.437109, 4, "Allégorie à l'armurerie"],
  [4.390335, 45.437246, 4, "La Muse de Massenet"],
  [4.381817, 45.43728, 2, ""],
  [4.393206, 45.437351, 2, "Le Mur de Fauriel"],
  [4.386347, 45.437409, 4, "Le Petit Buveur"],
  [4.392223, 45.437664, 3, "Buste de Jean Moulin"],
  [4.396089, 45.439779, 1, "Monument aux combattants d'Afrique du Nord"],
  [4.387083, 45.44087, 3, "Jean Jaurès"],
  [4.386808, 45.441852, 3, "José Frappa"],
  [4.331876, 45.444475, 0, ""],
  [4.337237, 45.444568, 0, ""],
  [4.363279, 45.444754, 1, "Monument aux Morts de Côte Chaude"],
  [4.33346, 45.445823, 0, ""],
  [4.385193, 45.447708, 3, "Buste de Jules Janin"],
  [4.381859, 45.447898, 3, "Buste d'Émile Girodet"],
  [4.437103, 45.460697, 0, ""],
  [4.353219, 45.467697, 1, ""],
  [4.353206, 45.468224, 0, ""],
  [4.377817, 45.474938, 0, ""],
  [4.43276, 45.480705, 1, ""],
  [4.387078, 45.485509, 1, ""],
  [4.378248, 45.485588, 0, ""],
  [4.378252, 45.485625, 1, ""],
  [4.391002, 45.48766, 4, "Madone"],
];
