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

export type CarInput = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
};

export function createCar(): CarState {
  return {
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
}

export const car: CarState = createCar();
export const input: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

const frozen: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

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
const followHit: EdgeHit = { edge: null!, t: 0, x: 0, y: 0, dist: 0, tx: 0, ty: 0 };

export function resetCar(x: number, y: number, heading: number, edgeId = -1, c: CarState = car) {
  c.x = x;
  c.y = y;
  c.heading = heading;
  c.speed = 0;
  c.steer = 0;
  c.edgeId = edgeId;
  c.offroad = false;
  c.lateral = 0;
}

// Suit le reseau : on reste sur l'edge courant tant qu'on est dessus, on
// enchaine sur le plus aligne au carrefour, et on retombe sur la recherche
// spatiale si on a vraiment decroche.
function follow(g: RoadGraph, c: CarState): EdgeHit | null {
  const hx = Math.cos(c.heading);
  const hy = Math.sin(c.heading);
  // direction de deplacement reelle (inversee en marche arriere)
  const s = c.speed < -0.1 ? -1 : 1;
  const mx = hx * s;
  const my = hy * s;

  if (c.edgeId >= 0) {
    let e = g.edges[c.edgeId];
    g.projectInto(e, c.x, c.y, followHit);

    if (followHit.t <= 1e-4 || followHit.t >= 1 - 1e-4) {
      const nodeId = followHit.t >= 0.5 ? e.b : e.a;
      const next = g.nextEdgeAt(nodeId, mx, my, e.id);
      if (next) {
        e = next;
        g.projectInto(e, c.x, c.y, followHit);
      }
    }
    // On ne garde l'edge courant que tant qu'on roule vraiment dessus. Une
    // tolerance large collait la voiture a une rue qu'elle avait quittee, et
    // le rappel la faisait tourner en rond autour.
    if (followHit.dist <= e.halfWidth + GRIP_MARGIN) {
      c.edgeId = e.id;
      return followHit;
    }
  }

  const hit =
    g.nearestAlignedInto(c.x, c.y, mx, my, followHit, 80) ??
    g.nearestEdgeInto(c.x, c.y, followHit);
  if (hit) c.edgeId = hit.edge.id;
  return hit;
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function stepCar(g: RoadGraph, dt: number, c: CarState = car, inp: CarInput = input) {
  // --- moteur ------------------------------------------------------------
  const fade = 1 - Math.max(0, c.speed) / MAX_SPEED; // l'accel se tasse en haut
  c.speed += inp.throttle * ACCEL * Math.max(0.05, fade) * dt;
  c.speed -= inp.brake * BRAKE * dt;

  // frein moteur / trainee
  const drag = (ROLL_DRAG + Math.abs(c.speed) * AIR_DRAG * Math.abs(c.speed) * 0.5) * dt;
  if (c.speed > 0) c.speed = Math.max(0, c.speed - drag);
  else if (c.speed < 0) c.speed = Math.min(0, c.speed + drag);

  if (inp.handbrake) c.speed *= Math.max(0, 1 - 2.6 * dt);
  c.speed = Math.max(-MAX_REVERSE, Math.min(MAX_SPEED, c.speed));

  // --- direction ---------------------------------------------------------
  const k = 1 - Math.exp(-STEER_RATE * dt);
  c.steer += (inp.steer - c.steer) * k;

  const v = Math.abs(c.speed);
  const authority = Math.min(1, v / 4); // a l'arret on ne pivote pas sur place
  const yaw = (YAW_BASE / (1 + v * YAW_FALLOFF)) * authority * (inp.handbrake ? 1.5 : 1);
  c.heading += c.steer * yaw * dt * (c.speed < 0 ? -1 : 1);

  // --- deplacement -------------------------------------------------------
  c.x += Math.cos(c.heading) * c.speed * dt;
  c.y += Math.sin(c.heading) * c.speed * dt;

  // --- contrainte reseau : rappel doux vers la chaussee -------------------
  const hit = follow(g, c);
  if (!hit) {
    c.offroad = true;
    return;
  }

  c.t = hit.t;
  c.lateral = hit.dist;
  c.roadType = hit.edge.type;
  c.roadName = hit.edge.name || "";

  const limit = hit.edge.halfWidth + GRIP_MARGIN;
  if (hit.dist > limit) {
    const over = hit.dist - limit;
    c.offroad = true;

    const inv = 1 / Math.max(hit.dist, 1e-6);
    const nx = (hit.x - c.x) * inv;
    const ny = (hit.y - c.y) * inv;
    const pull = Math.min(over * PULL_GAIN, PULL_MAX) * dt;
    c.x += nx * pull;
    c.y += ny * pull;

    // bas-cote : ca freine
    c.speed *= Math.max(0, 1 - Math.min(0.9, over * 0.06) * OFFROAD_DRAG * dt);

    // quand on part loin, on recale doucement le cap dans l'axe de la route
    if (over > 3) {
      const sign = Math.cos(c.heading) * hit.tx + Math.sin(c.heading) * hit.ty >= 0 ? 1 : -1;
      const target = Math.atan2(hit.ty * sign, hit.tx * sign);
      c.heading += wrapAngle(target - c.heading) * Math.min(1, over * 0.08) * 1.8 * dt;
    }
  } else {
    c.offroad = false;
  }
}

export function stepCarFrozen(g: RoadGraph, dt: number, c: CarState = car) {
  stepCar(g, dt, c, frozen);
}
