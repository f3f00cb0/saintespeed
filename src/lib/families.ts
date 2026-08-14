// Kits de FAMILLE : la silhouette d'un type de batiment, posee sur n'importe
// quelle emprise OSM qui appartient a ce type.
//
// Les kits de src/lib/landmarks.ts sont bespoke, un par monument : l'Hotel de
// Ville, la cathedrale, le chevalement. Ils ne passent pas a l'echelle, et le
// deficit mesure est ailleurs. Sur les 197 emprises notables de export.geojson,
// 87 sont du patrimoine ou du culte et QUATRE seulement etaient traitees : les
// 55 lieux de culte de la ville sortaient en boites de pierre sombres, sans
// clocher ni fleche. Or c'est exactement ce qui se lit de loin sur une ville de
// collines.
//
// Un kit de famille prend donc l'emprise reelle (son axe principal, sa largeur,
// sa surface) et y pose ce qui fait reconnaitre le type :
//
//   culte      55 emprises  nef a deux pentes, clocher a l'ouest, fleche, abside,
//                           beffroi eclaire ; dome et minaret pour les mosquees.
//   halle     286           toiture en sheds, la couverture manufacturiere
//                           stephanoise, plus la cheminee des sites classes.
//   gare        2           marquise, verriere de hall, horloge.
//   ensemble 1533           edicules de toiture, cage d'ascenseur, antennes, et
//                           le feu rouge des tours au dela de 35 m.
//
// Comptes releves par le harnais headless sur les 55 049 emprises du cache, et
// non estimes : 1 876 emprises portent un kit, pour 64 000 triangles sur toute
// la ville, 520 au pire dans une tuile de 240 m.
//
// Les kits vivent dans src/lib/familyKits.ts : ce module-ci ne fait que
// l'affectation, sans dependre de three.js, pour que buildings.ts puisse
// l'appeler sans creer de cycle d'import avec les facades.
//
// Les kits n'ecrivent QUE dans les tampons pleins et lumineux, jamais dans les
// murs textures : ils s'ajoutent a l'extrusion de l'emprise (qui reste la
// verite du plan) au lieu de la remplacer. Un seul cas fait exception, la
// hauteur des lieux de culte, corrigee dans prepareBuildings : la table
// inferLevels est calee sur du logement et sortait des nefs de 9 m.
//
// Sources de dimensionnement : les proportions sont deduites de l'emprise, pas
// relevees monument par monument. Une nef de 35 x 21 m (la mediane mesuree sur
// les 56 emprises) porte un clocher de 6 m de cote et 30 m de haut, ce qui est
// la proportion courante des eglises paroissiales du bassin. Les monuments dont
// les vraies cotes sont connues restent traites a la main dans landmarks.ts,
// qui prime sur les familles.

import type { Dims } from "./frame";
import { NOTABLE } from "./notable";

export const enum Family {
  None = 0,
  Culte = 1,
  Halle = 2,
  Gare = 3,
  Ensemble = 4,
}

export const FAMILY_NAMES = ["aucune", "culte", "halle", "gare", "ensemble"];

// --- affectation ------------------------------------------------------------

/** Ce dont l'affectation a besoin, sans dependre de la forme du cache. */
export type FamilyInput = {
  id: number;
  kind?: string;
  area: number;
  height: number;
  zone?: string;
  /** Archetype deja decide, pour ne pas redecider ce que la cascade sait. */
  isBarre: boolean;
};

const CULTE_KIND = /^(church|chapel|cathedral|mosque|synagogue|temple|monastery|shrine)$/;
const HALLE_KIND = /^(industrial|warehouse|factory|hangar)$/;

// Une halle demande une emprise assez grande ET assez rectangulaire pour qu'une
// toiture en sheds tienne dedans : posee sur un plan en L, la trame deborderait
// dans le vide. Mesure sur les emprises industrielles : le seuil de 0,78 de
// remplissage en garde 3 sur 4.
const HALLE_MIN_AREA = 600;
const HALLE_MIN_FILL = 0.78;

// Un grand ensemble ne merite ses edicules que s'il a une vraie toiture : en
// dessous de 15 m, un immeuble de faubourg passerait pour une barre.
const ENSEMBLE_MIN_HEIGHT = 15;

/**
 * Famille de kit d'une emprise. Fonction pure, premier match gagnant, du signal
 * le plus fiable (tag de culte) au plus heuristique (zone industrielle).
 *
 * `frame` est passe en fonction et non en valeur : seule la branche des halles
 * a besoin du repere principal, or l'analyse en composantes principales tourne
 * sur 57 630 emprises au chargement. On ne la paie que pour les candidates.
 */
export function familyOf(b: FamilyInput, frame: () => Dims): Family {
  const kind = b.kind ?? "yes";
  const note = NOTABLE.get(b.id);

  // Le culte se lit sur le tag de batiment, ou sur la table de notabilite pour
  // les emprises tagees building=yes + religion (mosquees, temples).
  if (CULTE_KIND.test(kind) || note?.worship) return Family.Culte;

  if (kind === "train_station" && b.area >= 300) return Family.Gare;

  if ((HALLE_KIND.test(kind) || b.zone === "i") && b.area >= HALLE_MIN_AREA) {
    const f = frame();
    if (f.area / Math.max(f.w * f.d, 1) >= HALLE_MIN_FILL) return Family.Halle;
  }

  if (b.isBarre && b.height >= ENSEMBLE_MIN_HEIGHT && b.area >= 200) return Family.Ensemble;

  return Family.None;
}

/**
 * Hauteur du corps principal d'un lieu de culte. inferLevels est calee sur du
 * logement : elle sortait des nefs de 9 m sur des eglises de 1 500 m2. On la
 * remplace par une regle d'emprise, bornee aux deux bouts (une chapelle de
 * 60 m2 ne fait pas 15 m de haut, une eglise de quartier ne depasse pas 18 m au
 * gouttereau).
 */
export function culteHeight(area: number): number {
  return Math.max(7, Math.min(18, 9 + (Math.sqrt(area) - 12) * 0.55));
}
