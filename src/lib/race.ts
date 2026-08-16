import type { EdgeHit, RoadGraph } from "./graph";
import type { Track } from "./track";
import { resetCar } from "./car";
import { eterniteSpawn } from "./elev";

export type Checkpoint = {
  id: number;
  label: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  tx: number; // tangente de la route sur laquelle il est pose
  ty: number;
  width: number;
  radius: number;
  road: string;
};

export function checkpointFromHit(hit: EdgeHit, id: number, label?: string): Checkpoint {
  return {
    id,
    label: label || hit.edge.name || hit.edge.type || `CP ${id + 1}`,
    lon: 0,
    lat: 0,
    x: hit.x,
    y: hit.y,
    tx: hit.tx,
    ty: hit.ty,
    width: hit.edge.width,
    radius: Math.max(20, hit.edge.halfWidth + 12),
    road: hit.edge.name || hit.edge.type,
  };
}

// Les points du tracé sont donnés en lat/lon puis collés au réseau, ce qui
// garantit qu'un portique tombe toujours sur du vrai bitume.
export function makeCheckpoints(g: RoadGraph, track: Track): Checkpoint[] {
  const out: Checkpoint[] = [];
  track.checkpoints.forEach((c, i) => {
    const hit = g.snapLonLat(c.lon, c.lat);
    if (!hit) {
      console.warn("checkpoint hors réseau:", c.label);
      return;
    }
    const cp = checkpointFromHit(hit, i, c.label);
    const ll = g.proj.unproject(hit.x, hit.y);
    cp.lon = ll.lon;
    cp.lat = ll.lat;
    out.push(cp);
  });
  return out;
}

export function snapCheckpoint(g: RoadGraph, x: number, y: number, radius = 80): Checkpoint | null {
  const hit = g.nearestEdge(x, y, radius);
  if (!hit) return null;
  const cp = checkpointFromHit(hit, 0);
  const ll = g.proj.unproject(hit.x, hit.y);
  cp.lon = ll.lon;
  cp.lat = ll.lat;
  return cp;
}

export function trackFromCheckpoints(id: string, name: string, cps: Checkpoint[]): Track {
  return {
    id,
    name,
    checkpoints: cps.map((c) => ({ lon: c.lon, lat: c.lat, label: c.label })),
  };
}

export function trackLength(cps: { x: number; y: number }[]): number {
  if (cps.length < 2) return 0;
  let d = 0;
  for (let i = 0; i < cps.length; i++) {
    const a = cps[i];
    const b = cps[(i + 1) % cps.length];
    d += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return d;
}

// Pose la voiture sur un checkpoint, nez dans la direction du suivant.
export function spawnAt(g: RoadGraph, cps: Checkpoint[], index: number) {
  const cp = cps[index];
  if (!cp) return;
  const next = cps[(index + 1) % cps.length] ?? cp;
  const dx = next.x - cp.x;
  const dy = next.y - cp.y;
  // on garde l'axe de la route, oriente vers le checkpoint suivant
  const sign = cp.tx * dx + cp.ty * dy >= 0 ? 1 : -1;
  const heading = Math.atan2(cp.ty * sign, cp.tx * sign);
  const hit = g.nearestAligned(cp.x, cp.y, cp.tx * sign, cp.ty * sign, 40);
  resetCar(cp.x, cp.y, heading, hit ? hit.edge.id : -1);
}

/** Bas de la rue de l'Eternite, nez vers le haut. Proto relief. */
export function spawnEternite(g: RoadGraph): boolean {
  const p = eterniteSpawn();
  if (!p) return false;
  const hx = Math.cos(p.heading ?? 0);
  const hy = Math.sin(p.heading ?? 0);
  const hit = g.nearestAligned(p.x, p.y, hx, hy, 50) ?? g.nearestEdge(p.x, p.y, 50);
  if (!hit) return false;
  // coller le cap a l'axe OSM, signe = vers la crete
  const along = hit.tx * hx + hit.ty * hy >= 0 ? 1 : -1;
  const heading = Math.atan2(hit.ty * along, hit.tx * along);
  resetCar(hit.x, hit.y, heading, hit.edge.id);
  return true;
}
