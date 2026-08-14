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

  return {
    x: cx, y: cy, rot,
    w: maxx - minx, d: maxy - miny,
    area, height, minx, maxx, miny, maxy,
  };
}
