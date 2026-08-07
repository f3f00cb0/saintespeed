// Voiture arcade contrainte au reseau routier.
// Integration a la main, pas de moteur physique. Le fun avant le realisme.

import type { EdgeHit, RoadGraph } from "./graph";

export type CarState = {
  x: number;
  y: number;
  heading: number; // radians, 0 = est, sens trigo
  speed: number; // m/s, negatif en marche arriere
  steer: number; // -1..1 lisse
  edgeId: number; // edge suivi actuellement
  t: number; // position sur cet edge
  lateral: number; // ecart au centre de la chaussee
  offroad: boolean;
  roadName: string;
  roadType: string;
};

export const car: CarState = {
  x: 0,
  y: 0,
  heading: 0,
  speed: 0,
  steer: 0,
  edgeId: -1,
  t: 0,
  lateral: 0,
  offroad: false,
  roadName: "",
  roadType: "",
};

export const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };

// --- reglages arcade -------------------------------------------------------
const MAX_SPEED = 56; // ~200 km/h
const MAX_REVERSE = 11;
const ACCEL = 17;
const BRAKE = 38;
const ROLL_DRAG = 0.6; // frottement constant
// trainee quadratique : c'est elle qui fixe la vitesse de pointe reelle,
// calee pour plafonner vers 180 km/h sur un boulevard degage
const AIR_DRAG = 0.001;
const STEER_RATE = 9; // vitesse de reponse du volant
const YAW_BASE = 2.7; // rad/s a l'arret theorique
const YAW_FALLOFF = 0.058; // le braquage se ferme avec la vitesse
const GRIP_MARGIN = 2.0; // metres toleres au dela du bord du ruban
const PULL_GAIN = 5; // force du rappel vers la chaussee
const PULL_MAX = 25; // m/s max de rappel, evite le teleport
const OFFROAD_DRAG = 3.2;

export function resetCar(x: number, y: number, heading: number, edgeId = -1) {
  car.x = x;
  car.y = y;
  car.heading = heading;
  car.speed = 0;
  car.steer = 0;
  car.edgeId = edgeId;
  car.offroad = false;
  car.lateral = 0;
}

// Suit le reseau : on reste sur l'edge courant tant qu'on est dessus, on
// enchaine sur le plus aligne au carrefour, et on retombe sur la recherche
// spatiale si on a vraiment decroche.
function follow(g: RoadGraph): EdgeHit | null {
  const hx = Math.cos(car.heading);
  const hy = Math.sin(car.heading);
  // direction de deplacement reelle (inversee en marche arriere)
  const s = car.speed < -0.1 ? -1 : 1;
  const mx = hx * s;
  const my = hy * s;

  if (car.edgeId >= 0) {
    let e = g.edges[car.edgeId];
    let hit = g.project(e, car.x, car.y);

    if (hit.t <= 1e-4 || hit.t >= 1 - 1e-4) {
      const nodeId = hit.t >= 0.5 ? e.b : e.a;
      const next = g.nextEdgeAt(nodeId, mx, my, e.id);
      if (next) {
        e = next;
        hit = g.project(e, car.x, car.y);
      }
    }
    // On ne garde l'edge courant que tant qu'on roule vraiment dessus. Une
    // tolerance large collait la voiture a une rue qu'elle avait quittee, et
    // le rappel la faisait tourner en rond autour.
    if (hit.dist <= e.halfWidth + GRIP_MARGIN) {
      car.edgeId = e.id;
      return hit;
    }
  }

  const hit = g.nearestAligned(car.x, car.y, mx, my, 80) ?? g.nearestEdge(car.x, car.y);
  if (hit) car.edgeId = hit.edge.id;
  return hit;
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function stepCar(g: RoadGraph, dt: number) {
  // --- moteur ------------------------------------------------------------
  const fade = 1 - Math.max(0, car.speed) / MAX_SPEED; // l'accel se tasse en haut
  car.speed += input.throttle * ACCEL * Math.max(0.05, fade) * dt;
  car.speed -= input.brake * BRAKE * dt;

  // frein moteur / trainee
  const drag = (ROLL_DRAG + Math.abs(car.speed) * AIR_DRAG * Math.abs(car.speed) * 0.5) * dt;
  if (car.speed > 0) car.speed = Math.max(0, car.speed - drag);
  else if (car.speed < 0) car.speed = Math.min(0, car.speed + drag);

  if (input.handbrake) car.speed *= Math.max(0, 1 - 2.6 * dt);
  car.speed = Math.max(-MAX_REVERSE, Math.min(MAX_SPEED, car.speed));

  // --- direction ---------------------------------------------------------
  const k = 1 - Math.exp(-STEER_RATE * dt);
  car.steer += (input.steer - car.steer) * k;

  const v = Math.abs(car.speed);
  const authority = Math.min(1, v / 4); // a l'arret on ne pivote pas sur place
  const yaw = (YAW_BASE / (1 + v * YAW_FALLOFF)) * authority * (input.handbrake ? 1.5 : 1);
  car.heading += car.steer * yaw * dt * (car.speed < 0 ? -1 : 1);

  // --- deplacement -------------------------------------------------------
  car.x += Math.cos(car.heading) * car.speed * dt;
  car.y += Math.sin(car.heading) * car.speed * dt;

  // --- contrainte reseau : rappel doux vers la chaussee -------------------
  const hit = follow(g);
  if (!hit) {
    car.offroad = true;
    return;
  }

  car.t = hit.t;
  car.lateral = hit.dist;
  car.roadType = hit.edge.type;
  car.roadName = hit.edge.name || "";

  const limit = hit.edge.halfWidth + GRIP_MARGIN;
  if (hit.dist > limit) {
    const over = hit.dist - limit;
    car.offroad = true;

    const inv = 1 / Math.max(hit.dist, 1e-6);
    const nx = (hit.x - car.x) * inv;
    const ny = (hit.y - car.y) * inv;
    const pull = Math.min(over * PULL_GAIN, PULL_MAX) * dt;
    car.x += nx * pull;
    car.y += ny * pull;

    // bas-cote : ca freine
    car.speed *= Math.max(0, 1 - Math.min(0.9, over * 0.06) * OFFROAD_DRAG * dt);

    // quand on part loin, on recale doucement le cap dans l'axe de la route
    if (over > 3) {
      const sign = Math.cos(car.heading) * hit.tx + Math.sin(car.heading) * hit.ty >= 0 ? 1 : -1;
      const target = Math.atan2(hit.ty * sign, hit.tx * sign);
      car.heading += wrapAngle(target - car.heading) * Math.min(1, over * 0.08) * 1.8 * dt;
    }
  } else {
    car.offroad = false;
  }
}
