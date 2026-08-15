// Ce qu'OSM sait de la voirie elle-meme : de quel cote est le trottoir, et ou
// sont les passages pietons.
//
// Mesure sur la bbox de travail (npm run fetch-osm -- voirie) :
//   1 440 rues portent un tag trottoir, dont 917 des deux cotes, 229 a droite,
//   89 a gauche, et 205 qui disent EXPLICITEMENT qu'il n'y en a pas ;
//   4 374 passages pietons en noeud, dont 3 959 marques au sol, plus 389
//   cartographies en ligne, qui portent en plus leur orientation.
//
// Le tag ne couvre que 25 % du reseau, mais il apporte ce qu'aucune deduction
// geometrique ne donne : le COTE. Les 75 % restants tombent sur la regle
// mesuree de src/lib/sidewalks.ts.
//
// Cache local uniquement : comme le decor, ce n'est pas vital. Sans le fichier,
// tout le reseau passe par la regle geometrique et le jeu tourne comme avant.
// Donnees OpenStreetMap sous ODbL.

import type { Projector } from "./project";

/** Bitmask : 1 = trottoir a gauche du sens du way, 2 = a droite, 0 = aucun. */
export type SidewalkSide = number;

export type Crossing = {
  x: number;
  y: number;
  /** Marque au sol (zebre) : c'est la seule distinction qui se voit. */
  marked: boolean;
  /** Direction de la traversee si OSM la cartographie en ligne, sinon null. */
  dir: { x: number; y: number } | null;
  /** Longueur de la ligne cartographiee, en metres, sinon 0. */
  len: number;
};

export type Voirie = {
  sidewalks: Map<number, SidewalkSide>;
  crossings: Crossing[];
};

type RawVoirie = {
  sidewalks: Record<string, number>;
  crossings: [number, number, number][];
  crossWays: { g: [number, number][]; m: number }[];
};

export async function loadVoirie(): Promise<RawVoirie | null> {
  try {
    const res = await fetch("/sainte-voirie.json");
    if (!res.ok) return null;
    return (await res.json()) as RawVoirie;
  } catch {
    return null;
  }
}

export function prepareVoirie(raw: RawVoirie | null, proj: Projector): Voirie {
  const sidewalks = new Map<number, SidewalkSide>();
  const crossings: Crossing[] = [];
  if (!raw) return { sidewalks, crossings };

  for (const [id, code] of Object.entries(raw.sidewalks)) sidewalks.set(Number(id), code);

  // Les lignes d'abord : elles portent l'orientation de la traversee, donc le
  // sens des bandes du zebre. Un noeud ne donne que la position, et il faudra
  // prendre la perpendiculaire a la rue.
  for (const c of raw.crossWays ?? []) {
    if (c.g.length < 2) continue;
    const a = proj.project(c.g[0][0], c.g[0][1]);
    const b = proj.project(c.g[c.g.length - 1][0], c.g[c.g.length - 1][1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    crossings.push({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      marked: c.m === 1,
      dir: { x: dx / len, y: dy / len },
      len,
    });
  }

  for (const [lon, lat, marked] of raw.crossings ?? []) {
    const p = proj.project(lon, lat);
    crossings.push({ x: p.x, y: p.y, marked: marked === 1, dir: null, len: 0 });
  }

  return { sidewalks, crossings };
}
