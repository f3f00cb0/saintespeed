// Altitude en jeu : ou est le sol, en y three.js, sous un point du plan.
//
// Un singleton comme `car` : lu chaque frame par la voiture, la camera, les
// voitures du salon, les portiques et les traces. Tant que le relief n'est pas
// branche (drapeau `?relief` ou grille absente), tout vaut 0 et le jeu reste
// exactement celui d'avant.
//
// Repere vertical : y = altitude - z0. z0 est l'altitude de la chaussee au
// depart de la course, pour que le decor encore plat (sol, batiments, etape
// suivante) tombe juste la ou l'on commence a rouler.

import type { EdgeHit, RoadGraph } from "./graph";
import type { Relief } from "./relief";
import type { RoadProfile } from "./roadProfile";

export const elevation = {
  on: false,
  z0: 0,
  graph: null as RoadGraph | null,
  relief: null as Relief | null,
  profile: null as RoadProfile | null,
};

export function setElevation(graph: RoadGraph, relief: Relief, profile: RoadProfile, z0: number) {
  elevation.graph = graph;
  elevation.relief = relief;
  elevation.profile = profile;
  elevation.z0 = z0;
  elevation.on = true;
}

/** Relief demande par l'URL : `?relief`. Etape de mise au point, voir le README. */
export function reliefWanted(): boolean {
  try {
    return new URLSearchParams(location.search).has("relief");
  } catch {
    return false;
  }
}

/** y three.js de la chaussee en un point d'un edge. */
export function roadY(edgeId: number, t: number): number {
  const p = elevation.profile;
  return p ? p.z(edgeId, t) - elevation.z0 : 0;
}

/** Pente de la chaussee le long d'un edge, de a vers b. */
export function roadGrade(edgeId: number, t: number): number {
  const p = elevation.profile;
  return p ? p.grade(edgeId, t) : 0;
}

/** y three.js du terrain nu, hors chaussee. */
export function terrainY(x: number, y: number): number {
  const r = elevation.relief;
  return r ? r.at(x, y) - elevation.z0 : 0;
}

const probe: EdgeHit = { edge: null!, t: 0, x: 0, y: 0, dist: 0, tx: 0, ty: 0 };

/**
 * y three.js du sol sous un point : la chaussee si le point est sur une route
 * (a un demi-gabarit pres), le terrain sinon. Le cap, quand on l'a, departage
 * un pont et la rue qu'il enjambe, comme pour la voiture.
 */
export function groundY(x: number, y: number, hx?: number, hy?: number): number {
  if (!elevation.on) return 0;
  const g = elevation.graph!;
  const hit =
    hx !== undefined && hy !== undefined
      ? g.nearestAlignedInto(x, y, hx, hy, probe, 30)
      : g.nearestEdgeInto(x, y, probe, 30);
  if (hit && hit.dist <= hit.edge.halfWidth + 3) return roadY(hit.edge.id, hit.t);
  return terrainY(x, y);
}
