// Repere local d'une emprise : ancre, orientation, dimensions.
//
// Module volontairement sans dependance : il est utilise a la fois par la
// preparation des emprises (buildings.ts) et par les primitives de geometrie
// (landmarkGeometry.ts, qui tire three.js et les facades). Le garder isole
// evite un cycle d'import buildings -> familles -> geometrie -> facades ->
// buildings, qui casse l'initialisation des constantes en ESM.

/** Ancre d'un repere : centre projete (metres) + orientation de l'axe principal. */
export type Anchor = { x: number; y: number; rot: number };

/**
 * Dimensions de l'emprise dans le repere local. `w` et `d` sont les etendues le
 * long des axes x (axe principal) et y ; les min/max donnent la position des
 * facades par rapport au centroide, pour poser perron, arcades ou clocher au
 * bon endroit.
 */
export type Dims = {
  w: number;
  d: number;
  area: number;
  height: number;
  minx: number;
  maxx: number;
  miny: number;
  maxy: number;
};

/** Ancre et dimensions d'une emprise : tout ce qu'un kit a besoin de savoir. */
export type Frame = Anchor & Dims;

/**
 * Repere local d'une emprise : centre, orientation, etendue et bbox locale.
 * L'orientation est l'axe principal (direction propre de plus grande valeur
 * propre), sauf si `rotOverride` est fourni (batiment quasi carre dont la
 * facade a un sens precis, ex. l'Hotel de Ville).
 *
 * L'origine est le CENTRE DE LA BBOX, et non le centroide du contour. La
 * difference n'est pas cosmetique : un kit compose une facade symetriquement
 * autour de x = 0, or le centroide d'une emprise reelle n'est presque jamais au
 * milieu de sa facade. Mesure sur les douze reperes bespoke, l'ecart va de 1,9 m
 * (Palais Mimard) a 19,1 m (Nouvelles Galeries) ; sur l'Hotel de Ville il valait
 * 2,4 m, assez pour que les deux passages voutes des ailes ne soient plus a la
 * meme distance des bords, sur un edifice neoclassique dont toute la composition
 * est axiale. Avec cette origine, minx vaut exactement -w/2 et maxx +w/2 : ecrire
 * x = 0 dans un kit, c'est ecrire "sur l'axe".
 */
export function frameOf(
  ring: { x: number; y: number }[],
  height: number,
  rotOverride?: number,
): Frame {
  const n = ring.length;
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  let rot: number;
  if (rotOverride !== undefined) {
    rot = rotOverride;
  } else {
    // covariance 2x2 des points centres
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of ring) {
      const dx = p.x - cx, dy = p.y - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  }
  const c = Math.cos(-rot), s = Math.sin(-rot);

  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const px = p.x - cx, py = p.y - cy;
    const rx = px * c - py * s, ry = px * s + py * c;
    if (rx < minx) minx = rx; if (rx > maxx) maxx = rx;
    if (ry < miny) miny = ry; if (ry > maxy) maxy = ry;
    area += p.x * q.y - q.x * p.y;
  }
  area = Math.abs(area / 2);

  // Recentrage sur la bbox : on deplace l'ancre du centroide vers le milieu de
  // l'etendue, en repassant l'offset local en coordonnees monde.
  const ox = (minx + maxx) / 2;
  const oy = (miny + maxy) / 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const w = maxx - minx;
  const d = maxy - miny;

  return {
    x: cx + ox * cr - oy * sr,
    y: cy + ox * sr + oy * cr,
    rot,
    w, d, area, height,
    minx: -w / 2, maxx: w / 2,
    miny: -d / 2, maxy: d / 2,
  };
}
