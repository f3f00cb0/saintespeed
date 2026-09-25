// Le pied d'un batiment sur le relief : le sol sous chacun de ses angles, et
// son niveau de reference. Partage par Buildings.tsx (murs, silhouettes, kits
// de famille) et Landmarks.tsx (reperes), qui doivent tomber au meme niveau.
// Voir Buildings.tsx pour la regle : 0 local a mi-chemin entre le sol le plus
// bas et le plus haut, murs descendus a chaque angle.

import type { FlatBuilding } from "./buildings";
import { elevation, surfaceY } from "./elevation";

/** Profondeur a laquelle les murs s'enfoncent sous le sol de leur angle, en m. */
export const SINK = 0.6;

export type Footing = { g: Float64Array; min: number; max: number; y0: number };
const footings = new WeakMap<FlatBuilding, Footing>();

/** Sol sous chaque angle d'une emprise, memoise : il ne change pas d'un LOD a l'autre. */
export function footingOf(b: FlatBuilding): Footing {
  let f = footings.get(b);
  if (f) return f;
  const g = new Float64Array(b.ring.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < b.ring.length; i++) {
    const v = elevation.on ? surfaceY(b.ring[i].x, b.ring[i].y) : 0;
    g[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  f = { g, min, max, y0: (min + max) / 2 };
  footings.set(b, f);
  return f;
}

