// Niveaux de qualite et descente automatique, decidee sur la duree de frame
// reellement mesuree.
//
// Pourquoi ce module existe : la scene de nuit tient son aspect de quatre passes
// plein ecran (bloom a flou mipmap, tone mapping ACES, vignette, grain) posees
// sur une cible HDR en MSAA 4x. Sur un GPU dedie ca passe ; sur un GPU integre
// c'est la bande passante qui plafonne, pas la geometrie. Mesure sur un Intel
// Iris Xe en 1389x945 a dpr 1 : 36 fps, alors que la geometrie residente ne
// represente que 200 draw calls et 76 000 triangles, soit trois pour cent de
// plus que la version sans les kits de famille.
//
// On ne choisit donc pas la qualite sur le materiel (impossible a deviner de
// facon fiable depuis le navigateur) mais sur la mesure : si la frame mediane
// depasse le budget sur une fenetre entiere, on descend d'un cran.
//
// Ce module est volontairement pur, sans three.js ni DOM : la politique est ce
// qui a le plus de risque d'osciller, et elle se verifie dans Node. Le cablage
// est dans src/scene/Quality.tsx.

export const enum Quality {
  High = 0,
  Medium = 1,
  Low = 2,
}

export const QUALITY_NAMES = ["haute", "moyenne", "basse"];

export type QualityLevel = {
  /** Echantillons MSAA sur la cible HDR du composer. */
  multisampling: number;
  /** Plafond de densite de pixels. */
  dprMax: number;
  /** Grain photographique : une passe plein ecran de plus. */
  grain: boolean;
};

// L'ordre des renoncements n'est pas arbitraire, il suit le cout mesure :
//   1. le MSAA d'abord. C'est le plus cher (une cible multi-echantillons de
//      1,3 Mpx resolue a chaque frame) et le moins identitaire : de nuit, sur
//      une scene majoritairement sombre avec du grain, l'escalier d'arete se
//      voit beaucoup moins que sur un rendu diurne a plat.
//   2. la densite de pixels ensuite, qui divise le remplissage sans rien
//      changer a la composition.
//   3. le grain en dernier, parce qu'il ne coute qu'une passe et qu'il fait
//      beaucoup pour l'aspect photographique.
// Le bloom n'est jamais coupe : sans lui les fenetres allumees, les beffrois et
// les feux de balisage ne sont plus que des taches plates, et c'est ce qui porte
// la lecture nocturne de la ville.
export const LEVELS: QualityLevel[] = [
  { multisampling: 4, dprMax: 2, grain: true },
  { multisampling: 0, dprMax: 1.5, grain: true },
  { multisampling: 0, dprMax: 1, grain: false },
];

/** Budget de frame, en ms. 21 ms vaut 47 fps : on descend avant de tomber a 30. */
export const FRAME_BUDGET_MS = 21;

/** Taille de la fenetre de mesure, en frames. A 60 fps, une seconde et demie. */
export const WINDOW = 90;

/**
 * Frames ignorees apres le demarrage et apres chaque changement de niveau. Le
 * chargement, la compilation des shaders et la reconstruction du composer
 * produisent des frames longues qui n'ont rien a voir avec le regime courant.
 */
export const WARMUP = 60;

/** Mediane des durees de frame, en ms. Robuste aux hoquets de streaming. */
export function medianFrame(times: number[]): number {
  if (!times.length) return 0;
  const s = [...times].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Niveau vise, connaissant le niveau courant et la fenetre de mesure.
 *
 * La descente est a sens unique, volontairement : remonter des qu'on repasse
 * sous le budget ferait osciller le MSAA et la densite de pixels au gre du
 * trafic de tuiles, et une bascule visible toutes les deux secondes est bien
 * pire qu'un cran de qualite en moins. Le niveau se reevalue au rechargement.
 */
export function nextQuality(current: Quality, times: number[]): Quality {
  if (times.length < WINDOW) return current;
  if (current >= Quality.Low) return current;
  return medianFrame(times) > FRAME_BUDGET_MS ? ((current + 1) as Quality) : current;
}
