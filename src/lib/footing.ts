// Le pied d'un batiment sur le relief : le sol sous chacun de ses angles, et
// son niveau de reference. Partage par Buildings.tsx (murs, silhouettes, kits
// de famille) et Landmarks.tsx (reperes), qui doivent tomber au meme niveau.
// Voir Buildings.tsx pour la regle : 0 local a mi-chemin entre le sol le plus
// bas et le plus haut, murs descendus a chaque angle.

import type { FlatBuilding } from "./buildings";
import { elevation, surfaceY } from "./elevation";
import { frameOf } from "./frame";

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
  f = { g, min, max, y0: b.landmark && elevation.on ? faceGround(b) : (min + max) / 2 };
  footings.set(b, f);
  return f;
}


/**
 * Sol devant la facade principale d'un repere. Ses hauteurs ont ete relevees
 * sur photo depuis la rue qu'il regarde : c'est donc de ce sol-la qu'elles se
 * comptent, pas du milieu de la pente. La Bourse du Travail le montre bien :
 * la BD TOPO mesure 18 m de denivele sous son emprise (525,9 a 543,8 m), sa
 * facade donnant en bas, sur le cours Victor-Hugo. Posee a mi-pente, son
 * peristyle flottait 8 m au-dessus de la rue.
 *
 * On echantillonne cinq points le long du cote `face` du repere local, 3 m en
 * avant, cote rue ou parvis.
 */
function faceGround(b: FlatBuilding): number {
  const lm = b.landmark!;
  const fr = frameOf(b.ring, b.height, lm.rot);
  const face = lm.face ?? "y-";
  const c = Math.cos(fr.rot);
  const s = Math.sin(fr.rot);
  let sum = 0;
  const N = 5;
  for (let k = 0; k < N; k++) {
    const t = (k + 0.5) / N;
    let lx: number;
    let ly: number;
    if (face === "y-" || face === "y+") {
      lx = fr.minx + (fr.maxx - fr.minx) * t;
      ly = face === "y-" ? fr.miny - 3 : fr.maxy + 3;
    } else {
      ly = fr.miny + (fr.maxy - fr.miny) * t;
      lx = face === "x-" ? fr.minx - 3 : fr.maxx + 3;
    }
    sum += surfaceY(fr.x + lx * c - ly * s, fr.y + lx * s + ly * c);
  }
  return sum / N;
}
