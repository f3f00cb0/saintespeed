// Ce que chaque photo doit trancher.
//
// Une photo de reference ne sert pas a "voir le batiment" : elle sert a repondre
// oui ou non a une affirmation du kit. La liste n'est donc pas descriptive, elle
// est tiree de ce que le code AFFIRME SANS SOURCE, en relisant chaque kit de
// src/lib/landmarks.ts : une hauteur inferee, une position deduite faute de
// plan, un element evoque. L'Hotel de Ville a montre a quoi ressemble une
// affirmation non verifiee laissee en place : "on evoque un campanile modeste",
// ecrit dans un commentaire, pour un campanile qui n'existe pas depuis 1953.
//
// Chaque entree tient en une question fermee, verifiable d'un coup d'oeil sur
// l'image, et cite la valeur du jeu quand il y en a une : sur le terrain on
// compare a un chiffre, on n'apprecie pas.

export const DEFAUT_QUESTIONS = [
  "silhouette d'ensemble : la masse du jeu tient-elle debout à côté du réel",
  "ce qui se lit de nuit : quelles surfaces sont éclairées, lesquelles restent noires",
];

export const QUESTIONS: Record<string, string[]> = {
  // --- Deja repris sur photo, il reste les valeurs mises a l'echelle ---------
  rel5201020: [
    "corniche à 18,5 m et cadran à 22,7 m : mise à l'échelle sur la largeur de façade, jamais relevée",
    "les deux passages voûtés des ailes au niveau de la place : existent-ils, et à quelle distance des bords",
    "la frise et l'attique à panneaux au-dessus du balcon continu",
    "le couronnement est-il bien PLAT au-dessus du cadran, sans rien qui dépasse",
  ],

  // --- Les onze reperes modelises sans photo --------------------------------
  way63322493: [
    "la lanterne du croisillon : existe-t-elle, et porte-t-elle une croix",
    "la rosace de la façade occidentale : diamètre et hauteur par rapport au pignon",
    "les quatre pinacles aux coins du transept : le kit les pose, la source ne les mentionne pas",
    "40 m au faîte : hauteur taguée, jamais vérifiée sur une image",
  ],
  way1365990293: [
    "hauteur du tablier : 9,5 m assumés, aucune source ne donne le tirant d'air",
    "l'encadrement métallique orange : poteaux, poutre de rive, et jusqu'où vont les vitres",
    "ce qu'on voit du quai depuis la rue, de nuit : la bande éclairée est-elle ce qui se lit en premier",
  ],
  way1365990292: [
    "même section que le quai sud, ou différente",
    "l'écart de 10,3 m entre les deux auvents, mesuré en plan : se vérifie-t-il en élévation",
  ],
  way161467265: [
    "DIX faces : déduites des dix cartouches de compositeurs, jamais comptées sur l'objet",
    "diamètre de 9 m et hauteur des colonnes de fonte : les deux sont des valeurs choisies",
    "l'escalier d'accès refait en 1914 : où est-il, combien de marches",
  ],
  way63303051: [
    "AUCUNE trame de fenêtres sur la peau de triangles : vérifié sur photo de jour, à confirmer de nuit",
    "hauteur de 9,3 m : inférence, aucune source ne la donne",
    "les panneaux translucides : lesquels rayonnent la nuit, sur quelle hauteur de façade",
  ],
  way172156092: [
    "le couronnement vitré du belvédère : éclairé la nuit, ou éteint",
    "la plateforme qui déborde : de combien",
    "31 m tagués contre 32 m dans la source",
  ],
  way63261991: [
    "corniche vers 15 m : mise à l'échelle sur la largeur, contre 9,3 m inférés",
    "la toiture à croupes en tuile : pente et débord",
    "les grandes baies cintrées de l'étage haut, que le kit ne pose pas",
  ],
  way49047886: [
    "la voûte aluminium : hauteur au faîte contre les 25 m du jeu",
    "les murs vitrés : éclairés de l'intérieur la nuit, ou masse sombre",
  ],
  way63308936: [
    "les deux molettes : diamètre réel contre 5,5 m dans le jeu, et hauteur d'axe (32,5 m)",
    "le treillis : 35 m, pyramide à quatre montants ou structure plus fine",
    "la salle des machines en brique : hauteur et position par rapport au chevalement",
  ],
  way63319547: [
    "le péristyle protégé MH : six colonnes pour cinq travées, et 2 m de saillie sur le trottoir",
    "le fronton du corps central : existe-t-il au-dessus du péristyle",
    "les quatre pavillons d'angle dépassent-ils la corniche des ailes, et de combien",
  ],
  way63281257: [
    "la tourelle d'angle ÉCIMÉE : le dôme a brûlé puis a été retiré dans les années 1960",
    "le bardage métallique posé sur la façade à la même époque : couvre-t-il tout",
    "la vitrine du rez-de-chaussée, seul élément lumineux du kit",
  ],
  rel1000783: [
    "SEPT baies cintrées au premier niveau de la façade d'honneur : les compter",
    "le pavillon d'entrée en léger avant-corps et son fronton",
    "18 m de haut : valeur du jeu, non taguée",
  ],
  way63288593: [
    "la cage de scène de 28 m : sa POSITION dans l'emprise est déduite, faute de plan",
    "la lanterne de polycarbonate : rayonne-t-elle hors représentation",
    "le socle vitré et l'auvent d'entrée, côté parvis",
  ],
  way63303610: [
    "masse AVEUGLE : vraiment aucune fenêtre sur 321 m de façade",
    "les volumes décrochés : combien, et de quelle hauteur au-dessus des 14 m",
    "les entrées éclairées : où sont-elles réellement sur les trois côtés bordés de rue",
  ],
  way63322681: [
    "8,5 m de corniche : OSM tague building:levels=1, ce qui est bas pour une gare de 1882",
    "les briques polychromes de l'ossature métallique : trame et couleurs",
    "l'horloge : sur combien de faces du corps central",
    "la marquise d'entrée : largeur et hauteur au-dessus du parvis",
  ],
  way63300869: [
    "néo-gothique : lucarnes, pinacles, et ce qui distingue vraiment sa silhouette",
    "la porte cochère du corps principal, sur la place",
    "19 m de haut, valeur du jeu",
  ],

  // --- Les reperes sans emprise ---------------------------------------------
  "stade-geoffroy-guichard": [
    "cuvette fermée : les quatre tribunes sont-elles à la même hauteur (22 m dans le jeu)",
    "le bandeau de projecteurs : intégré en toiture ou sur des mâts",
  ],
  "bassin-ouest": [
    "diamètre et hauteur de margelle",
    "l'éclairage du bassin est un CHOIX du jeu : la vasque est-elle éclairée en vrai",
  ],
  "bassin-est": [
    "diamètre et hauteur de margelle",
    "l'éclairage du bassin est un choix du jeu, à confronter au réel",
  ],
  daphne: [
    "statue DE bassin : elle est à 1,4 m du centre d'un bassin de 8,8 m, donc dans l'eau",
    "bronze : la matière vient du tag OSM, la silhouette est inventée",
  ],
  "venus-belmondo": [
    "statue monumentale de 1951 : hauteur du socle et hauteur totale",
    "en pied, pas un buste : la différence doit se voir à hauteur de voiture",
  ],
  apollon: [
    "pendant de Vénus : même socle, même hauteur",
    "position par rapport à l'axe de la place",
  ],
  "buste-jean-jaures": [
    "buste sur colonne : hauteur de la colonne, diamètre",
  ],
  "buste-jose-frappa": [
    "buste sur colonne : même type que Jean Jaurès, ou différent",
  ],
};

/**
 * Les objets ponctuels sont poses par typologie : leur forme decoule du type,
 * donc une seule photo par typologie repond pour toute la famille. Ce qui
 * compte est ce qui les distingue les uns des autres a hauteur de voiture.
 */
export const TYPOLOGIE_QUESTIONS: Record<string, string[]> = {
  croix: [
    "hauteur totale et proportion du fût : une croix de chemin n'a pas l'échelle d'une croix de place",
    "socle : maçonnerie, simple degré, ou rien",
  ],
  guerre: [
    "monument aux morts : obélisque, stèle, ou groupe sculpté",
    "hauteur totale et emprise du socle",
  ],
  stele: [
    "hauteur et épaisseur : une stèle se lit de profil autant que de face",
  ],
  buste: [
    "hauteur de la colonne ou du piédestal, qui fait toute la silhouette",
  ],
  statue: [
    "en pied sur socle : rapport entre hauteur du socle et hauteur de la figure",
    "ce qui la distingue des autres statues de la ville à cette échelle",
  ],
};

/**
 * Libelles affiches, en francais correct. Les noms viennent des donnees du jeu
 * (LANDMARKS.label, les clefs des monuments de place), qui suivent la
 * convention sans accents du depot : c'est bon pour du code, pas pour une page
 * qu'on lit dans la rue. La table ne corrige que l'affichage, elle ne touche
 * pas a la donnee.
 */
export const NOMS: Record<string, string> = {
  rel5201020: "Hôtel de Ville",
  way63322493: "Cathédrale Saint-Charles",
  way49047886: "Zénith",
  way161467265: "Kiosque à musique de Marengo",
  rel1000783: "Préfecture de la Loire",
  way63288593: "La Comédie",
  way63322681: "Gare de Châteaucreux",
  way63261991: "Ancienne Manufacture d'armes",
  "stade-geoffroy-guichard": "Stade Geoffroy-Guichard",
  "bassin-ouest": "Bassin ouest, place Jean-Jaurès",
  "bassin-est": "Bassin est, place Jean-Jaurès",
  daphne: "Daphné, dans le bassin est",
  "venus-belmondo": "Vénus, de Paul Belmondo",
  apollon: "Apollon",
  "buste-jean-jaures": "Buste de Jean Jaurès",
  "buste-jose-frappa": "Buste de José Frappa",
};
