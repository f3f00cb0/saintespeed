// Voies ferrees, et surtout ce qu'elles portent : le viaduc.
//
// La ville est plate dans le jeu, volontairement : aucun relief de terrain n'est
// modelise. Mais un viaduc n'est pas du relief, c'est un OUVRAGE, et il en
// traverse le centre. La gare Carnot, mise en service en 1980, est une gare
// AERIENNE posee dessus : sans le viaduc elle ne peut qu'etre ecrasee au sol.
//
// Mesure sur la ville entiere (npm run fetch-osm -- rail) : 244 troncons,
// 79 459 m de voie, dont 2 175 m EN L'AIR, et 1 418 m de cette voie aerienne
// passent a moins de 600 m de la gare Carnot. Le trace reel passe a 1,8 m du
// centre des quais, avec un azimut de 8,0 degres contre 7,8 mesures sur les
// auvents de quai cartographies : les deux sources se recoupent.
//
// Ce module reste pur : pas de three.js. Le rendu est dans src/scene/Viaduct.tsx.

import type { Projector } from "./project";

export type RailLine = {
  id: number;
  /** Polyligne lon/lat. */
  points: [number, number][];
  /** En pont, ou sur un layer positif : la voie est en l'air. */
  elevated: boolean;
  name?: string;
};

/** Hauteur du tablier, en metres. */
export const DECK_HEIGHT = 9.5;

/** Epaisseur du tablier. */
export const DECK_THICKNESS = 1.1;

/** Largeur du tablier courant (double voie). */
export const DECK_WIDTH = 11;

/**
 * Longueur de la rampe d'about. Une extremite de viaduc qui n'est raccordee a
 * aucun autre troncon aerien ne doit pas s'arreter en l'air : elle redescend en
 * remblai. C'est la reponse au vrai defaut visuel d'un pont pose sur une ville
 * plate, et ca ne coute aucun relief de terrain.
 */
export const RAMP = 22;

export type RailPoint = { x: number; y: number; z: number };

/** Polyligne projetee, avec le profil en long deja calcule. */
export type FlatRail = {
  id: number;
  points: RailPoint[];
  elevated: boolean;
  name?: string;
};

export async function loadRail(): Promise<RailLine[]> {
  try {
    const res = await fetch("/sainte-rail.json");
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.lines)) return [];
    return data.lines.map((l: any) => ({
      id: l.i,
      points: l.g,
      elevated: Boolean(l.b) || (l.l ?? 0) > 0,
      name: l.n,
    }));
  } catch (err) {
    console.warn("voies ferrees indisponibles", err);
    return [];
  }
}

const key = (x: number, y: number) => `${Math.round(x / 3)}:${Math.round(y / 3)}`;

/**
 * Projette les troncons aeriens et leur donne un profil en long : le tablier est
 * a DECK_HEIGHT partout, sauf aux extremites LIBRES, ou il redescend sur RAMP
 * metres. Une extremite est libre quand aucun autre troncon aerien ne s'y
 * raccorde, ce qui se lit sur les extremites partagees a 3 m pres.
 */
export function prepareRail(lines: RailLine[], proj: Projector): FlatRail[] {
  const elevated = lines.filter((l) => l.elevated && l.points.length >= 2);

  // Extremites partagees : un about raccorde ne redescend pas.
  const ends = new Map<string, number>();
  for (const l of elevated) {
    for (const p of [l.points[0], l.points[l.points.length - 1]]) {
      const q = proj.project(p[0], p[1]);
      const k = key(q.x, q.y);
      ends.set(k, (ends.get(k) ?? 0) + 1);
    }
  }

  const out: FlatRail[] = [];
  for (const l of elevated) {
    const xy = l.points.map((p) => proj.project(p[0], p[1]));

    // abscisse curviligne
    const s: number[] = [0];
    for (let i = 1; i < xy.length; i++) {
      s.push(s[i - 1] + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y));
    }
    const total = s[s.length - 1];
    if (total < 4) continue;

    const freeStart = (ends.get(key(xy[0].x, xy[0].y)) ?? 0) < 2;
    const freeEnd = (ends.get(key(xy[xy.length - 1].x, xy[xy.length - 1].y)) ?? 0) < 2;

    const points = xy.map((p, i) => {
      let z = DECK_HEIGHT;
      if (freeStart) z = Math.min(z, DECK_THICKNESS + (DECK_HEIGHT - DECK_THICKNESS) * Math.min(1, s[i] / RAMP));
      if (freeEnd) {
        z = Math.min(z, DECK_THICKNESS + (DECK_HEIGHT - DECK_THICKNESS) * Math.min(1, (total - s[i]) / RAMP));
      }
      return { x: p.x, y: p.y, z };
    });
    out.push({ id: l.id, points, elevated: true, name: l.name });
  }
  return out;
}

/** Longueur cumulee, pour la telemetrie. */
export function railLength(lines: FlatRail[]): number {
  let m = 0;
  for (const l of lines) {
    for (let i = 1; i < l.points.length; i++) {
      m += Math.hypot(l.points[i].x - l.points[i - 1].x, l.points[i].y - l.points[i - 1].y);
    }
  }
  return m;
}
