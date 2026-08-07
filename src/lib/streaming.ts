// Politique de streaming par anneaux de distance.
//
// A l'echelle de la ville entiere, 55 049 batiments font 2,00 M de triangles et
// 247 Mo de tampons GPU. Le frustum culling ne change rien a ce chiffre : une
// geometrie cullee reste residente. C'est la memoire qui bloque, pas les draw
// calls, dont le batching par archetype s'occupe deja.
//
// On ne construit donc que les tuiles proches, a un niveau de detail decroissant
// avec la distance, et on libere les autres. Mesure le long des vrais axes :
// 114 tuiles residentes en mediane, 137 au pire, soit 4 121 batiments en mediane
// et 13 218 au pire au lieu de 55 049. Environ 11 Mo de tampons au lieu de 247.
//
// Ce module est volontairement pur : aucune dependance a three.js ni au DOM. La
// politique est ce qui a le plus de risque de bug subtil (clignotement aux
// frontieres, tuiles jamais liberees), et c'est exactement ce qui se teste dans
// Node le long du trace reel.

/** Cote d'une tuile, en metres projetes. */
export const TILE = 240;

export const enum Lod {
  Full = 0, // plein detail : fenetres, socle commercant, coiffe
  Reduced = 1, // sans socle, coiffe CONSERVEE
  Silhouette = 2, // une boite par batiment
  None = 3, // dechargee
}

export const LOD_NAMES = ["plein", "reduit", "silhouette", "decharge"];

// Seuils d'ENTREE : distance sous laquelle on monte a ce niveau de detail.
const IN = [300, 700, 1400];
// Seuils de SORTIE : distance au dela de laquelle on en redescend. L'ecart avec
// IN est la zone morte qui empeche une tuile de basculer en boucle quand le
// joueur longe une frontiere. Sans elle, une tuile a 300 m pile se reconstruit
// et se libere a chaque tick.
const OUT = [350, 780, 1550];

// La distance max de rendu (1400 m) est calee sur le brouillard : a cette
// distance fogExp2 a 0,0009 laisse passer environ 20 % de la couleur d'origine,
// donc une tuile qui apparait ou disparait est deja noyee dans le bleu
// d'horizon. C'est ce qui evite de voir le chargement.

/**
 * Niveau de detail vise pour une tuile, connaissant celui qu'elle a deja.
 * L'hysteresis se lit ici : on compare a OUT quand on est deja au moins aussi
 * detaille, a IN sinon.
 */
export function desiredLod(dist: number, current: Lod): Lod {
  for (let lod = 0; lod < 3; lod++) {
    const threshold = current <= lod ? OUT[lod] : IN[lod];
    if (dist <= threshold) return lod as Lod;
  }
  return Lod.None;
}

/** Distance d'un point au bord le plus proche d'une tuile, 0 s'il est dedans. */
export function tileDistance(tx: number, ty: number, px: number, py: number): number {
  const x0 = tx * TILE;
  const y0 = ty * TILE;
  const dx = Math.max(x0 - px, 0, px - (x0 + TILE));
  const dy = Math.max(y0 - py, 0, py - (y0 + TILE));
  return Math.hypot(dx, dy);
}

/** Clef entiere d'une tuile. Les coordonnees tiennent largement dans 16 bits. */
export function tileKey(tx: number, ty: number): number {
  return (tx + 32768) * 65536 + (ty + 32768);
}

// A vitesse voiture, viser la position courante fait apparaitre les tuiles
// devant le joueur au moment ou il les atteint. On vise donc un point avance le
// long du vecteur vitesse : tout ce qui est devant monte en detail plus tot,
// tout ce qui est derriere redescend plus tot, ce qui est exactement le budget
// qu'on veut.
const LEAD_SECONDS = 3;
const LEAD_MAX = 260; // metres, pour ne pas viser hors de la ville a pleine vitesse

export type TileRef = { tx: number; ty: number };

export type StreamPlan = {
  /** tuiles a construire ou a reconstruire a un autre niveau, les plus proches d'abord */
  load: { key: number; tx: number; ty: number; lod: Lod; dist: number }[];
  /** tuiles a liberer */
  drop: number[];
  /** compte par niveau, pour la telemetrie */
  counts: [number, number, number];
};

/**
 * Compare l'etat resident a l'etat voulu et renvoie le differentiel. Fonction
 * pure : meme entree, meme sortie, aucun effet de bord. C'est l'appelant qui
 * decide combien d'elements de `load` il traite par frame.
 */
export function planStreaming(
  tiles: TileRef[],
  px: number,
  py: number,
  vx: number,
  vy: number,
  current: Map<number, Lod>,
): StreamPlan {
  const speed = Math.hypot(vx, vy);
  const lead = Math.min(speed * LEAD_SECONDS, LEAD_MAX);
  const ax = speed > 0.1 ? px + (vx / speed) * lead : px;
  const ay = speed > 0.1 ? py + (vy / speed) * lead : py;

  const load: StreamPlan["load"] = [];
  const wanted = new Set<number>();
  const counts: [number, number, number] = [0, 0, 0];

  for (const t of tiles) {
    const key = tileKey(t.tx, t.ty);
    const cur = current.get(key) ?? Lod.None;
    const lod = desiredLod(tileDistance(t.tx, t.ty, ax, ay), cur);
    if (lod === Lod.None) continue;
    wanted.add(key);
    counts[lod]++;
    if (lod !== cur) {
      load.push({ key, tx: t.tx, ty: t.ty, lod, dist: tileDistance(t.tx, t.ty, px, py) });
    }
  }

  // Le plus proche du joueur d'abord : si le budget par frame ne suffit pas,
  // c'est ce qu'on a sous le nez qui doit arriver en premier.
  load.sort((a, b) => a.dist - b.dist);

  const drop: number[] = [];
  for (const key of current.keys()) if (!wanted.has(key)) drop.push(key);

  return { load, drop, counts };
}
