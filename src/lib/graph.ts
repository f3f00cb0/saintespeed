// Graphe routier navigable construit depuis les ways OSM.
// Noeuds dedupliques par position quantifiee, index spatial en grille maison.

import { makeProjector, type Projector } from "./project";
import { specFor, type Way } from "./osm";

export type GraphNode = {
  id: number;
  x: number;
  y: number;
  edges: number[]; // ids des edges incidents
};

export type GraphEdge = {
  id: number;
  a: number; // node id
  b: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dx: number; // direction a->b normalisee
  dy: number;
  len: number;
  type: string;
  width: number;
  halfWidth: number;
  wayId: number;
  name?: string;
};

export type EdgeHit = {
  edge: GraphEdge;
  t: number; // parametre sur le segment, dans [0,1]
  x: number; // point projete
  y: number;
  dist: number; // distance laterale au segment
  tx: number; // tangente (= direction de l'edge)
  ty: number;
};

// 0.1 m : deux points OSM identiques tombent forcement dans la meme case
const QUANT = 10;
// taille de cellule de l'index spatial
const CELL = 40;
const CELL_OFFSET = 32768;

function cellKey(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * 65536 + (cy + CELL_OFFSET);
}

export class RoadGraph {
  nodes = new Map<number, GraphNode>();
  edges: GraphEdge[] = [];
  proj: Projector;
  bounds = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };

  private grid = new Map<number, number[]>();
  private byPos = new Map<string, number>();
  private nextNode = 0;

  constructor(proj: Projector) {
    this.proj = proj;
  }

  nodeAt(x: number, y: number): GraphNode {
    const key = Math.round(x * QUANT) + ":" + Math.round(y * QUANT);
    const found = this.byPos.get(key);
    if (found !== undefined) return this.nodes.get(found)!;
    const n: GraphNode = { id: this.nextNode++, x, y, edges: [] };
    this.nodes.set(n.id, n);
    this.byPos.set(key, n.id);
    return n;
  }

  private index(e: GraphEdge) {
    // on depose l'edge dans toutes les cellules traversees
    const steps = Math.max(1, Math.ceil(e.len / (CELL * 0.5)));
    let last = -1;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const cx = Math.floor((e.ax + (e.bx - e.ax) * s) / CELL);
      const cy = Math.floor((e.ay + (e.by - e.ay) * s) / CELL);
      const k = cellKey(cx, cy);
      if (k === last) continue;
      last = k;
      let bucket = this.grid.get(k);
      if (!bucket) this.grid.set(k, (bucket = []));
      if (bucket[bucket.length - 1] !== e.id) bucket.push(e.id);
    }
  }

  addSegment(na: GraphNode, nb: GraphNode, way: Way) {
    const dx = nb.x - na.x;
    const dy = nb.y - na.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    const spec = specFor(way.type);
    const e: GraphEdge = {
      id: this.edges.length,
      a: na.id,
      b: nb.id,
      ax: na.x,
      ay: na.y,
      bx: nb.x,
      by: nb.y,
      dx: dx / len,
      dy: dy / len,
      len,
      type: way.type || "inconnu",
      width: spec.w,
      halfWidth: spec.w / 2,
      wayId: way.id,
      name: way.name,
    };
    this.edges.push(e);
    na.edges.push(e.id);
    nb.edges.push(e.id);
    this.index(e);
  }

  // --- requetes ----------------------------------------------------------

  // Projette un point sur un edge. t clampe dans [0,1].
  project(e: GraphEdge, x: number, y: number): EdgeHit {
    const vx = x - e.ax;
    const vy = y - e.ay;
    let t = (vx * e.dx + vy * e.dy) / e.len;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = e.ax + e.dx * e.len * t;
    const py = e.ay + e.dy * e.len * t;
    return { edge: e, t, x: px, y: py, dist: Math.hypot(x - px, y - py), tx: e.dx, ty: e.dy };
  }

  // Edges candidats dans un rayon donne, sans tri.
  near(x: number, y: number, radius: number): GraphEdge[] {
    const out: GraphEdge[] = [];
    const seen = new Set<number>();
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const r = Math.max(0, Math.ceil(radius / CELL));
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const bucket = this.grid.get(cellKey(cx + i, cy + j));
        if (!bucket) continue;
        for (const id of bucket) {
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(this.edges[id]);
        }
      }
    }
    return out;
  }

  // Segment le plus proche. Anneaux croissants, on s'arrete des qu'aucun
  // anneau plus lointain ne peut faire mieux.
  nearestEdge(x: number, y: number, maxRadius = 400): EdgeHit | null {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const maxRing = Math.ceil(maxRadius / CELL);
    let best: EdgeHit | null = null;
    const seen = new Set<number>();

    for (let r = 0; r <= maxRing; r++) {
      if (best && (r - 1) * CELL > best.dist) break;
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (r > 0 && Math.abs(i) !== r && Math.abs(j) !== r) continue; // anneau seul
          const bucket = this.grid.get(cellKey(cx + i, cy + j));
          if (!bucket) continue;
          for (const id of bucket) {
            if (seen.has(id)) continue;
            seen.add(id);
            const hit = this.project(this.edges[id], x, y);
            if (!best || hit.dist < best.dist) best = hit;
          }
        }
      }
    }
    return best;
  }

  // Comme nearestEdge, mais departage les candidats proches par l'alignement
  // avec le cap. C'est ce qui evite de se faire happer par une perpendiculaire
  // au milieu d'un carrefour.
  nearestAligned(x: number, y: number, hx: number, hy: number, radius = 60): EdgeHit | null {
    const cands = this.near(x, y, radius);
    if (!cands.length) return this.nearestEdge(x, y);

    let closest = Infinity;
    const hits: EdgeHit[] = [];
    for (const e of cands) {
      const hit = this.project(e, x, y);
      hits.push(hit);
      if (hit.dist < closest) closest = hit.dist;
    }

    const cut = closest + 20;
    let best: EdgeHit | null = null;
    let bestScore = Infinity;
    for (const hit of hits) {
      if (hit.dist > cut) continue;
      const align = Math.abs(hit.tx * hx + hit.ty * hy);
      const score = hit.dist - 25 * align;
      if (score < bestScore) {
        bestScore = score;
        best = hit;
      }
    }
    return best;
  }

  // A un noeud, l'edge sortant le plus aligne avec la direction donnee.
  // Retourne null si on ne peut que faire demi-tour.
  nextEdgeAt(nodeId: number, hx: number, hy: number, exclude = -1): GraphEdge | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    let best: GraphEdge | null = null;
    let bestDot = 0.05; // en dessous, c'est un demi-tour
    for (const id of node.edges) {
      if (id === exclude) continue;
      const e = this.edges[id];
      // direction en s'eloignant du noeud
      const sign = e.a === nodeId ? 1 : -1;
      const dot = sign * (e.dx * hx + e.dy * hy);
      if (dot > bestDot) {
        bestDot = dot;
        best = e;
      }
    }
    return best;
  }

  // Point du reseau le plus proche d'un lat/lon, pour poser les checkpoints.
  snapLonLat(lon: number, lat: number): EdgeHit | null {
    const p = this.proj.project(lon, lat);
    return this.nearestEdge(p.x, p.y, 800);
  }

  get stats() {
    return { nodes: this.nodes.size, edges: this.edges.length, cells: this.grid.size };
  }
}

export function buildGraph(ways: Way[]): RoadGraph {
  // barycentre pour caler la projection
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const w of ways) {
    for (const p of w.pts) {
      sx += p[0];
      sy += p[1];
      n++;
    }
  }
  const proj = makeProjector(sx / n, sy / n);
  const g = new RoadGraph(proj);

  for (const w of ways) {
    let prev: GraphNode | null = null;
    for (const [lon, lat] of w.pts) {
      const p = proj.project(lon, lat);
      const node = g.nodeAt(p.x, p.y);
      if (prev && prev.id !== node.id) g.addSegment(prev, node, w);
      prev = node;
      const b = g.bounds;
      if (p.x < b.minx) b.minx = p.x;
      if (p.x > b.maxx) b.maxx = p.x;
      if (p.y < b.miny) b.miny = p.y;
      if (p.y > b.maxy) b.maxy = p.y;
    }
  }
  return g;
}
