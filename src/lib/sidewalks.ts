// Trottoirs, bordures et caniveaux, construits comme l'ESPACE NEGATIF de la
// chaussee.
//
// La version precedente posait deux bandes par rue, decoupees au carrefour et
// rabotees par des rayons lances vers les facades. Elle rendait mal, et pour des
// raisons de structure, pas de reglage :
//   - chaque bande etait etroite et s'arretait loin de la facade, laissant entre
//     les deux un vide sombre qui se lisait comme un trou dans la ville ;
//   - les bandes de rues differentes se chevauchaient ou se manquaient au coin,
//     et les raccords d'angle ne rattrapaient qu'une partie des cas ;
//   - la bordure etait un angle vif la ou une vraie bordure tourne en arrondi.
//
// Ici on travaille en surfaces, avec des operations booleennes (Clipper) :
//
//   chaussee  C = union des rubans de chaussee, puis FERMETURE de rayon
//                 KERB_R (dilatation puis erosion) : les angles rentrants des
//                 carrefours s'arrondissent, comme une bordure posee.
//   zone      Z = pour chaque rue qui a un trottoir, une bande de chaque cote
//                 autorise par OSM (tag sidewalk), large de la cible de sa
//                 classe ; plus une bande elargie qui ne vaut que pres d'une
//                 facade, pour que le trottoir aille jusqu'au mur quand le mur
//                 est proche, sans inonder un parc quand il ne l'est pas.
//   trottoir  S = Z - C - batiments.
//
// Les angles se raccordent tout seuls (les bandes de deux rues se recouvrent au
// coin et l'union les fond), rien ne chevauche la chaussee par construction, et
// rien n'entre dans une emprise. Sur S on derive la pierre de bordure (la bande
// de S contre C), le caniveau (la bande de C contre S), et les faces verticales
// de bordure (le contour de S).
//
// Le calcul se fait par tuiles de TILE metres, a la demande autour du joueur
// (src/scene/Sidewalks.tsx), sur une fenetre elargie de MARGIN pour que les
// operations voient les rues voisines, puis le resultat est coupe au bord exact
// de la tuile. Ce module est pur (ni three.js ni DOM) : le harnais
// `npm run voirie` le rejoue dans Node.

import ClipperLib from "clipper-lib";
import earcut from "earcut";
import type { RoadGraph } from "./graph";
import { specFor, LAYER_STEP, type Way } from "./osm";
import type { Projector } from "./project";

/** Cote d'une tuile de trottoirs, en metres. */
export const TILE = 200;
const MARGIN = 40;

/**
 * Largeur cible par classe, en metres, du bord de chaussee au bord exterieur.
 * Absente = pas de trottoir. Calee sur le plancher reglementaire de 1,40 m de
 * cheminement libre (arrete du 15 janvier 2007), elargi avec la classe de voie :
 * OSM ne porte pas la largeur du trottoir a Saint-Etienne.
 */
const WIDTH: Record<string, number> = {
  primary: 4.0,
  secondary: 3.5,
  tertiary: 3.0,
  unclassified: 2.6,
  residential: 2.4,
  living_street: 2.0,
};

/**
 * Au dela de la cible, le trottoir va jusqu'a la facade si elle est a moins de
 * REACH metres : c'est ce qui supprime le vide sombre entre la bande et le mur.
 */
const REACH = 5.0;

/** Rayon des bordures aux carrefours (fermeture de la chaussee). */
const KERB_R = 2.2;

/** Largeur vue de la pierre de bordure, dessus. */
const KERB_TOP = 0.18;

/** Largeur du caniveau, cote chaussee. */
const GUTTER = 0.34;

/** Vue de bordure, en metres : une bordure T2 fait 14 cm. */
export const CURB = 0.14;

/** Surface en dessous de laquelle un morceau de trottoir est un eclat, pas un trottoir. */
const MIN_AREA = 1.5;

// Clipper travaille en entiers : on passe au centimetre.
const K = 100;

const C = ClipperLib;
type Path = ClipperLib.IntPoint[];
type Paths = Path[];

// --- index -------------------------------------------------------------------------

type WayRec = { half: number; pts: { x: number; y: number }[]; minx: number; miny: number; maxx: number; maxy: number; want: number; sides: number };
type BldRec = { ring: { x: number; y: number }[]; minx: number; miny: number; maxx: number; maxy: number };

export type SidewalkWorld = {
  ways: WayRec[];
  buildings: BldRec[];
  wayGrid: Map<string, number[]>;
  bldGrid: Map<string, number[]>;
  graph: RoadGraph;
};

const CELL = 100;
const cellKey = (cx: number, cy: number) => cx + ":" + cy;

function index<T extends { minx: number; miny: number; maxx: number; maxy: number }>(items: T[]) {
  const g = new Map<string, number[]>();
  items.forEach((it, i) => {
    for (let cx = Math.floor(it.minx / CELL); cx <= Math.floor(it.maxx / CELL); cx++) {
      for (let cy = Math.floor(it.miny / CELL); cy <= Math.floor(it.maxy / CELL); cy++) {
        const k = cellKey(cx, cy);
        let b = g.get(k);
        if (!b) g.set(k, (b = []));
        b.push(i);
      }
    }
  });
  return g;
}

function query(grid: Map<string, number[]>, x0: number, y0: number, x1: number, y1: number): number[] {
  const seen = new Set<number>();
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
      for (const i of grid.get(cellKey(cx, cy)) ?? []) seen.add(i);
    }
  }
  return [...seen];
}

/**
 * Prepare les index une fois pour toutes.
 *
 * @param sides cote du trottoir releve dans OSM, par id de way : 1 = gauche du
 *   sens du way, 2 = droite, 3 = les deux, 0 = aucun. Le tag prime sur la regle
 *   par classe, parce qu'il vient du terrain.
 */
export function prepareSidewalks(
  ways: Way[],
  proj: Projector,
  graph: RoadGraph,
  buildings: { ring: { x: number; y: number }[] }[],
  sides: Map<number, number> | null,
): SidewalkWorld {
  const W: WayRec[] = [];
  for (const w of ways) {
    const pts = w.pts.map((p) => proj.project(p[0], p[1]));
    if (pts.length < 2) continue;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of pts) {
      minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
      maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
    }
    const want = WIDTH[w.type] ?? 0;
    const tag = sides?.get(w.id);
    W.push({
      half: specFor(w.type).w / 2,
      pts,
      minx, miny, maxx, maxy,
      want,
      sides: want ? (tag === undefined ? 3 : tag) : 0,
    });
  }
  const B: BldRec[] = [];
  for (const b of buildings) {
    if (b.ring.length < 3) continue;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of b.ring) {
      minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
      maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
    }
    B.push({ ring: b.ring, minx, miny, maxx, maxy });
  }
  return { ways: W, buildings: B, wayGrid: index(W), bldGrid: index(B), graph };
}

// --- operations ------------------------------------------------------------------

const ip = (x: number, y: number): ClipperLib.IntPoint => ({ X: Math.round(x * K), Y: Math.round(y * K) });

function offset(paths: Paths, delta: number, join: ClipperLib.JoinType, end: ClipperLib.EndType): Paths {
  const co = new C.ClipperOffset(2, 0.25 * K);
  co.AddPaths(paths, join, end);
  const out: Paths = [];
  co.Execute(out, delta * K);
  return out;
}

function bool(a: Paths, b: Paths, op: ClipperLib.ClipType): Paths {
  const c = new C.Clipper();
  c.AddPaths(a, C.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, C.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(op, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}

const union = (a: Paths, b: Paths = []) => bool(a, b, C.ClipType.ctUnion);
const minus = (a: Paths, b: Paths) => bool(a, b, C.ClipType.ctDifference);
const inter = (a: Paths, b: Paths) => bool(a, b, C.ClipType.ctIntersection);

/** Bande d'un seul cote d'une polyligne : de l'axe + d0 a l'axe + d1, a onglets. */
function sideStrip(pts: { x: number; y: number }[], side: 1 | -1, d0: number, d1: number): Path {
  const n = pts.length;
  const inner: ClipperLib.IntPoint[] = [];
  const outer: ClipperLib.IntPoint[] = [];
  for (let i = 0; i < n; i++) {
    // normale au sommet : bissectrice des deux segments, allongee pour que la
    // bande garde sa largeur dans le coude, plafonnee pour les angles aigus
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let n0x = 0, n0y = 0, n1x = 0, n1y = 0;
    if (i > 0) {
      const dx = pts[i].x - a.x, dy = pts[i].y - a.y, l = Math.hypot(dx, dy) || 1;
      n0x = -dy / l; n0y = dx / l;
    }
    if (i < n - 1) {
      const dx = b.x - pts[i].x, dy = b.y - pts[i].y, l = Math.hypot(dx, dy) || 1;
      n1x = -dy / l; n1y = dx / l;
    }
    if (i === 0) { n0x = n1x; n0y = n1y; }
    if (i === n - 1) { n1x = n0x; n1y = n0y; }
    let mx = n0x + n1x, my = n0y + n1y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
    const cos = mx * n1x + my * n1y;
    const stretch = Math.min(1 / Math.max(cos, 1e-3), 2);
    const p = pts[i];
    inner.push(ip(p.x + mx * d0 * stretch * side, p.y + my * d0 * stretch * side));
    outer.push(ip(p.x + mx * d1 * stretch * side, p.y + my * d1 * stretch * side));
  }
  return [...inner, ...outer.reverse()];
}

// --- tuile -------------------------------------------------------------------------

export type SidewalkTile = {
  /** Triangles de la dalle du trottoir, xyz. */
  paving: Float32Array;
  /** Coordonnees de texture de la dalle, en metres (u = x, v = y du plan). */
  pavingUv: Float32Array;
  /** Pierre de bordure, faces de bordure, caniveau, arrondis de chaussee : xyz et rgb. */
  trim: Float32Array;
  trimColor: Float32Array;
  /** Contours du trottoir en metres du plan, pour les plans et le harnais. */
  outlines: { x: number; y: number }[][];
  triangles: number;
  ms: number;
};

// teintes des elements de bordure (la dalle, elle, est texturee)
const KERB_COLOR: [number, number, number] = [0.6, 0.59, 0.55];
const FACE_COLOR: [number, number, number] = [0.42, 0.41, 0.38];
const GUTTER_COLOR: [number, number, number] = [0.2, 0.2, 0.19];
// les arrondis de carrefour ajoutes par la fermeture : ce sont de la chaussee,
// dans la teinte de l'asphalte des petites rues (Roads.tsx, nightTint)
const FILLET_COLOR: [number, number, number] = [0.19, 0.19, 0.17];

/** Hauteur de chaussee sous un point : la couche de la rue la plus proche. */
function roadHeight(graph: RoadGraph, x: number, y: number): number {
  const hit = graph.nearestEdge(x, y, 40);
  return hit ? specFor(hit.edge.type).z * LAYER_STEP : LAYER_STEP;
}

type Tri = { pos: number[]; col?: number[]; uv?: number[] };

/** Triangule des polygones Clipper (avec trous) a une hauteur donnee par sommet. */
function fill(paths: Paths, height: (x: number, y: number) => number, out: Tri, rgb?: [number, number, number]) {
  // Clipper rend des contours exterieurs et des trous a plat ; un PolyTree
  // redonne l'appartenance d'un trou a son contour
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const walk = (node: ClipperLib.PolyNode) => {
    for (const outer of node.Childs()) {
      const flat: number[] = [];
      const holes: number[] = [];
      for (const p of outer.Contour()) flat.push(p.X / K, p.Y / K);
      for (const h of outer.Childs()) {
        holes.push(flat.length / 2);
        for (const p of h.Contour()) flat.push(p.X / K, p.Y / K);
        walk(h); // des ilots dans les trous
      }
      const tris = earcut(flat, holes);
      const hs: number[] = [];
      for (let i = 0; i < flat.length; i += 2) hs.push(height(flat[i], flat[i + 1]));
      for (const t of tris) {
        const x = flat[t * 2];
        const y = flat[t * 2 + 1];
        out.pos.push(x, hs[t], -y);
        if (rgb && out.col) out.col.push(rgb[0], rgb[1], rgb[2]);
        if (out.uv) out.uv.push(x, y);
      }
    }
  };
  walk(tree);
}

/** Aire d'un contour Clipper, en m2 (signee). */
const areaM2 = (p: Path) => C.Clipper.Area(p) / (K * K);

export function buildSidewalkTile(world: SidewalkWorld, tx: number, ty: number): SidewalkTile {
  const t0 = Date.now();
  const x0 = tx * TILE, y0 = ty * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
  const ex0 = x0 - MARGIN, ey0 = y0 - MARGIN, ex1 = x1 + MARGIN, ey1 = y1 + MARGIN;

  // --- chaussee ---
  const byHalf = new Map<number, Paths>();
  const bands: Paths = [];
  const reachBands: Paths = [];
  for (const i of query(world.wayGrid, ex0, ey0, ex1, ey1)) {
    const w = world.ways[i];
    if (w.maxx < ex0 || w.minx > ex1 || w.maxy < ey0 || w.miny > ey1) continue;
    const path = w.pts.map((p) => ip(p.x, p.y));
    let g = byHalf.get(w.half);
    if (!g) byHalf.set(w.half, (g = []));
    g.push(path);
    if (!w.want) continue;
    for (const side of [1, -1] as const) {
      const bit = side === 1 ? 1 : 2;
      if (!(w.sides & bit)) continue;
      bands.push(sideStrip(w.pts, side, 0, w.half + w.want));
      reachBands.push(sideStrip(w.pts, side, 0, w.half + w.want + REACH));
    }
  }
  let road0: Paths = [];
  for (const [half, paths] of byHalf) {
    road0 = union(road0, offset(paths, half, C.JoinType.jtRound, C.EndType.etOpenRound));
  }
  // fermeture : les angles rentrants des carrefours deviennent des arrondis
  const road = offset(offset(road0, KERB_R, C.JoinType.jtRound, C.EndType.etClosedPolygon), -KERB_R, C.JoinType.jtRound, C.EndType.etClosedPolygon);

  // --- batiments ---
  const bld: Paths = [];
  for (const i of query(world.bldGrid, ex0, ey0, ex1, ey1)) {
    const b = world.buildings[i];
    if (b.maxx < ex0 || b.minx > ex1 || b.maxy < ey0 || b.miny > ey1) continue;
    bld.push(b.ring.map((p) => ip(p.x, p.y)));
  }
  const bldU = union(bld);
  const nearWalls = offset(bldU, REACH, C.JoinType.jtMiter, C.EndType.etClosedPolygon);

  // --- trottoir ---
  const zone = union(union(bands), inter(union(reachBands), nearWalls));
  let side = minus(minus(zone, road), bldU);
  // ouverture : les eclats plus fins que 30 cm disparaissent
  side = offset(offset(side, -0.15, C.JoinType.jtMiter, C.EndType.etClosedPolygon), 0.15, C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  side = side.filter((p) => Math.abs(areaM2(p)) >= MIN_AREA || areaM2(p) < 0);

  // --- coupe a la tuile ---
  const rect: Paths = [[ip(x0, y0), ip(x1, y0), ip(x1, y1), ip(x0, y1)]];
  const S = inter(side, rect);
  const roadGrow = offset(road, KERB_TOP, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const kerb = inter(S, roadGrow);
  const paving = minus(S, roadGrow);
  const gutter = inter(inter(road, offset(S, GUTTER, C.JoinType.jtRound, C.EndType.etClosedPolygon)), rect);
  const fillets = inter(minus(road, road0), rect);

  // --- maillages ---
  const h = (x: number, y: number) => roadHeight(world.graph, x, y);
  const top = (x: number, y: number) => h(x, y) + CURB;
  const pave: Tri = { pos: [], uv: [] };
  fill(paving, top, pave);
  const trim: Tri = { pos: [], col: [] };
  fill(kerb, (x, y) => top(x, y) + 0.004, trim, KERB_COLOR);
  fill(gutter, (x, y) => h(x, y) + 0.012, trim, GUTTER_COLOR);
  fill(fillets, (x, y) => h(x, y) + 0.006, trim, FILLET_COLOR);

  // faces verticales de bordure : tout le contour du trottoir, sauf les
  // coutures de tuile (le trottoir continue dans la voisine)
  const seam = (ax: number, ay: number, bx: number, by: number) =>
    (Math.abs(ax - bx) < 0.02 && (Math.abs(ax - x0) < 0.02 || Math.abs(ax - x1) < 0.02)) ||
    (Math.abs(ay - by) < 0.02 && (Math.abs(ay - y0) < 0.02 || Math.abs(ay - y1) < 0.02));
  const outlines: { x: number; y: number }[][] = [];
  for (const path of S) {
    const pts = path.map((p) => ({ x: p.X / K, y: p.Y / K }));
    outlines.push(pts);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (seam(a.x, a.y, b.x, b.y)) continue;
      const ta = top(a.x, a.y), tb = top(b.x, b.y);
      const ba = ta - CURB - 0.08, bb = tb - CURB - 0.08;
      trim.pos.push(a.x, ba, -a.y, b.x, bb, -b.y, b.x, tb, -b.y, a.x, ba, -a.y, b.x, tb, -b.y, a.x, ta, -a.y);
      for (let k = 0; k < 6; k++) trim.col!.push(...FACE_COLOR);
    }
  }

  return {
    paving: new Float32Array(pave.pos),
    pavingUv: new Float32Array(pave.uv!),
    trim: new Float32Array(trim.pos),
    trimColor: new Float32Array(trim.col!),
    outlines,
    triangles: (pave.pos.length + trim.pos.length) / 9,
    ms: Date.now() - t0,
  };
}

/** Toutes les tuiles d'une boite, pour le harnais et les plans. */
export function buildSidewalks(world: SidewalkWorld, x0: number, y0: number, x1: number, y1: number) {
  const tiles: SidewalkTile[] = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
      tiles.push(buildSidewalkTile(world, tx, ty));
    }
  }
  return tiles;
}
