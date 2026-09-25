// Altitude en jeu : ou est le sol, en y three.js, sous un point du plan.
//
// Un singleton comme `car` : lu chaque frame par la voiture, la camera, les
// voitures du salon, les portiques et les traces. Sans relief (`?plat` dans
// l'URL, ou grille absente), tout vaut 0 et le jeu est la ville plate d'avant.
//
// Repere vertical : y = altitude - z0. z0 est l'altitude de la chaussee au
// depart de la course : les coordonnees restent petites la ou l'on roule.

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

/**
 * Relief actif par defaut. `?plat` dans l'URL rend la ville plate d'avant, pour
 * comparer ou sur une machine qui peinerait.
 */
export function reliefWanted(): boolean {
  try {
    return !new URLSearchParams(location.search).has("plat");
  } catch {
    return true;
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

// --- le sol de la ville -------------------------------------------------------
//
// Tout ce qui est pose au sol (terrain, places, trottoirs, arbres, lampadaires,
// pieds des batiments) lit son altitude ici, et une seule fonction garantit que
// tout s'emboite. Sur une chaussee c'est son profil en long ; au-dela du bord,
// on rejoint le terrain sur BLEND metres. Le profil etant a 0,32 m du terrain
// au p99, la transition est douce, mais sans elle le trottoir d'une rue en
// remblai flottait ou s'enfoncait de 30 cm le long de la bordure.
//
// Les ponts et les tunnels ne comptent pas : sous un tablier, le sol est le
// fond du vallon, pas le tablier.

/** Distance au bord de chaussee sur laquelle le sol rejoint le terrain, en m. */
export const BLEND = 8;
const surfaceProbe: EdgeHit = { edge: null!, t: 0, x: 0, y: 0, dist: 0, tx: 0, ty: 0 };

/** y three.js du sol de la ville sous un point. 0 sans relief. */
export function surfaceY(x: number, y: number): number {
  if (!elevation.on) return 0;
  const terrain = terrainY(x, y);
  const hit = elevation.graph!.nearestEdgeInto(x, y, surfaceProbe, 7 + BLEND, true);
  if (!hit) return terrain;
  const road = roadY(hit.edge.id, hit.t);
  const d = hit.dist - hit.edge.halfWidth;
  if (d <= 0) return road;
  if (d >= BLEND) return terrain;
  const f = d / BLEND;
  const s = f * f * (3 - 2 * f); // smoothstep : ni cassure au bord, ni au bout
  return road + (terrain - road) * s;
}
