import type { RoadGraph } from "./graph";
import { CIRCUIT, type Checkpoint } from "../state/store";
import { resetCar } from "./car";

// Les points du circuit sont donnes en lat/lon puis colles au reseau, ce qui
// garantit qu'un portique tombe toujours sur du vrai bitume.
export function makeCheckpoints(g: RoadGraph): Checkpoint[] {
  const out: Checkpoint[] = [];
  CIRCUIT.forEach((c, i) => {
    const hit = g.snapLonLat(c.lon, c.lat);
    if (!hit) {
      console.warn("checkpoint hors reseau:", c.label);
      return;
    }
    out.push({
      id: i,
      label: c.label,
      lon: c.lon,
      lat: c.lat,
      x: hit.x,
      y: hit.y,
      tx: hit.tx,
      ty: hit.ty,
      width: hit.edge.width,
      radius: Math.max(20, hit.edge.halfWidth + 12),
      road: hit.edge.name || hit.edge.type,
    });
  });
  return out;
}

// Pose la voiture sur un checkpoint, nez dans la direction du suivant.
export function spawnAt(g: RoadGraph, cps: Checkpoint[], index: number) {
  const cp = cps[index];
  if (!cp) return;
  const next = cps[(index + 1) % cps.length];
  const dx = next.x - cp.x;
  const dy = next.y - cp.y;
  // on garde l'axe de la route, oriente vers le checkpoint suivant
  const sign = cp.tx * dx + cp.ty * dy >= 0 ? 1 : -1;
  const heading = Math.atan2(cp.ty * sign, cp.tx * sign);
  const hit = g.nearestAligned(cp.x, cp.y, cp.tx * sign, cp.ty * sign, 40);
  resetCar(cp.x, cp.y, heading, hit ? hit.edge.id : -1);
}
