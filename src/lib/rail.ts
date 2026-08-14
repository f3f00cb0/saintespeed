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
import { specFor, type Way } from "./osm";

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
 * Longueur de la rampe d'about. Une extremite de corridor aerien ne doit pas
 * s'arreter en l'air : elle redescend en remblai. Allongee de 22 a 45 m apres
 * mesure : a 22 m la pente etait telle que le tablier plongeait a 1,1 m juste
 * au-dessus des chaussees qu'il croisait.
 */
export const RAMP = 45;

/** Altitude du tablier au pied d'une rampe. */
export const EMBANK_MIN = 1.2;

/**
 * Tirant d'air minimal au-dessus d'une chaussee. Mesure du defaut qui a impose
 * cette regle : 171 points de tablier passaient sous 5,5 m au-dessus d'une rue,
 * dont une bonne part a 1,1 m. Un viaduc ne se pose pas sur la route.
 */
export const ROAD_CLEARANCE = 5.6;

/**
 * Un troncon NON tague bridge qui relie deux abouts aeriens et reste court est
 * un remblai entre deux travees : dans une ville sans relief, il fait partie de
 * l'ouvrage. Mesure : 16 troncons relient deux abouts aeriens, 6 font moins de
 * 150 m pour 592 m cumules ; au-dela ce sont de vraies sections a niveau.
 */
export const GAP_MAX = 150;

/** Pas de reechantillonnage du trace, en metres. */
const STEP = 8;

/** Teste si un point est sur une chaussee. Fourni par l'appelant. */
export type RoadProbe = (x: number, y: number) => boolean;

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

const key = (x: number, y: number) => `${Math.round(x)}:${Math.round(y)}`;

/** Longueur d'une polyligne projetee. */
function polyLength(pts: { x: number; y: number }[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return m;
}

/** Reechantillonne une polyligne a pas constant, extremites conservees. */
function resample(pts: { x: number; y: number }[], step: number): { x: number; y: number }[] {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    let t = (step - carry) / len;
    while (t <= 1) {
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      t += step / len;
    }
    carry = (carry + len) % step;
    out.push(b);
  }
  return out;
}

/**
 * Projette le corridor aerien et lui donne un profil en long.
 *
 * Trois regles, chacune imposee par une mesure de terrain :
 *
 *   1. Les trous courts entre deux travees sont AVALES : un troncon non tague
 *      bridge qui relie deux abouts aeriens et fait moins de GAP_MAX est un
 *      remblai, donc une partie de l'ouvrage. Sans ca le viaduc s'interrompait
 *      la ou, sur le terrain, il y a un pont.
 *   2. Une extremite ne redescend que si la ligne s'y arrete VRAIMENT, c'est-a-
 *      dire si aucune autre voie ferree ne s'y raccorde. La version precedente
 *      comparait les abouts aeriens entre eux et concluait a tort : les 82
 *      abouts en rampe avaient tous une voie a moins de 12 m.
 *   3. Le tablier garde ROAD_CLEARANCE au-dessus de toute chaussee. Le profil
 *      est l'enveloppe superieure des contraintes, propagee a la pente de
 *      rampe : il remonte donc avant une rue et ne redescend qu'apres.
 */
export function prepareRail(lines: RailLine[], proj: Projector, onRoad?: RoadProbe): FlatRail[] {
  type W = { line: RailLine; pts: { x: number; y: number }[]; elevated: boolean; len: number };
  const ways: W[] = lines
    .filter((l) => l.points.length >= 2)
    .map((l) => {
      const pts = l.points.map((p) => proj.project(p[0], p[1]));
      return { line: l, pts, elevated: l.elevated, len: polyLength(pts) };
    });

  // 1. avaler les remblais courts entre deux travees
  const endsOf = (w: W) => [w.pts[0], w.pts[w.pts.length - 1]];
  const elevatedEnds = new Set<string>();
  for (const w of ways) if (w.elevated) for (const p of endsOf(w)) elevatedEnds.add(key(p.x, p.y));
  for (const w of ways) {
    if (w.elevated || w.len > GAP_MAX) continue;
    const [a, b] = endsOf(w);
    if (elevatedEnds.has(key(a.x, a.y)) && elevatedEnds.has(key(b.x, b.y))) w.elevated = true;
  }

  // 2. abouts reellement libres : aucune autre voie, aerienne ou non, ne s'y
  //    raccorde
  const allEnds = new Map<string, number>();
  for (const w of ways) for (const p of endsOf(w)) allEnds.set(key(p.x, p.y), (allEnds.get(key(p.x, p.y)) ?? 0) + 1);

  const slope = (DECK_HEIGHT - EMBANK_MIN) / RAMP;
  const out: FlatRail[] = [];

  for (const w of ways) {
    if (!w.elevated || w.len < 4) continue;
    const pts = resample(w.pts, STEP);
    const s: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const total = s[s.length - 1];
    const freeStart = (allEnds.get(key(w.pts[0].x, w.pts[0].y)) ?? 0) < 2;
    const last = w.pts[w.pts.length - 1];
    const freeEnd = (allEnds.get(key(last.x, last.y)) ?? 0) < 2;

    // profil de base : plein niveau, sauf rampe vers un about libre
    const base = pts.map((_, i) => {
      let z = DECK_HEIGHT;
      if (freeStart) z = Math.min(z, EMBANK_MIN + slope * s[i]);
      if (freeEnd) z = Math.min(z, EMBANK_MIN + slope * (total - s[i]));
      return z;
    });

    // enveloppe : au-dessus d'une chaussee, le tablier ne descend pas sous
    // ROAD_CLEARANCE, et la contrainte se propage a la pente de rampe
    const z = base.slice();
    if (onRoad) {
      const need = pts.map((p) => (onRoad(p.x, p.y) ? ROAD_CLEARANCE : 0));
      for (let i = 0; i < pts.length; i++) {
        let m = z[i];
        for (let j = 0; j < pts.length; j++) {
          if (need[j] <= 0) continue;
          const v = need[j] - slope * Math.abs(s[i] - s[j]);
          if (v > m) m = v;
        }
        z[i] = Math.min(DECK_HEIGHT, m);
      }
    }

    out.push({
      id: w.line.id,
      points: pts.map((p, i) => ({ x: p.x, y: p.y, z: z[i] })),
      elevated: true,
      name: w.line.name,
    });
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

/**
 * Sonde de chaussee : vrai si le point tombe sur une voie carrossable, largeur
 * de la classe comprise. Grille de 40 m pour ne pas balayer les 39 161 segments
 * du reseau a chaque test.
 *
 * Elle sert deux fois : a garder le tirant d'air du tablier au-dessus des rues,
 * et a ne pas planter de pile au milieu d'une chaussee.
 */
export function makeRoadProbe(ways: Way[], proj: Projector, margin = 1.5): RoadProbe {
  const CELL = 40;
  type Seg = { ax: number; ay: number; bx: number; by: number; hw: number };
  const grid = new Map<string, Seg[]>();
  const put = (x: number, y: number, seg: Seg) => {
    const k = `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(seg);
  };
  for (const w of ways) {
    const hw = specFor(w.type).w / 2 + margin;
    for (let i = 1; i < w.pts.length; i++) {
      const a = proj.project(w.pts[i - 1][0], w.pts[i - 1][1]);
      const b = proj.project(w.pts[i][0], w.pts[i][1]);
      const seg: Seg = { ax: a.x, ay: a.y, bx: b.x, by: b.y, hw };
      // le segment est inscrit dans toutes les cases qu'il traverse
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CELL));
      for (let k = 0; k <= steps; k++) {
        put(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps, seg);
      }
    }
  }
  return (x: number, y: number) => {
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const s of grid.get(`${gx + i}:${gy + j}`) ?? []) {
          const vx = s.bx - s.ax, vy = s.by - s.ay;
          const L2 = vx * vx + vy * vy || 1;
          let t = ((x - s.ax) * vx + (y - s.ay) * vy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (Math.hypot(x - (s.ax + t * vx), y - (s.ay + t * vy)) <= s.hw) return true;
        }
      }
    }
    return false;
  };
}
