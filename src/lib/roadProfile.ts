// Profil en long des chaussees : l'altitude de chaque route, le long de son axe.
//
// La voiture vit en 2D sur le graphe routier (car.ts), et un edge OSM est un
// segment droit entre deux points qui peuvent etre a 100 m l'un de l'autre.
// Donner une altitude aux seuls noeuds ferait couper les collines en ligne
// droite. On echantillonne donc chaque edge tous les SAMPLE metres, et c'est ce
// chapelet de points que l'on cale sur le relief.
//
// Trois regles :
//
// 1. Au sol, la chaussee suit le terrain (le RGE ALTI est un modele de terrain
//    nu : il porte les routes, les remblais et les tranchees).
// 2. Un pont ou un tunnel ne le suit pas. Un viaduc de la N88 qui suivrait le
//    terrain plongerait de 24 m au fond du vallon qu'il enjambe. Ses points
//    n'ont aucune attache au terrain : ils sont interpoles entre les points ou
//    l'ouvrage rejoint la voirie ordinaire, ses culees ou ses tetes de tunnel.
// 3. Tout est lisse ensemble. Le modele a 10 m garde un bruit de quelques
//    decimetres qui, a 150 km/h, se sent comme une tole ondulee. On minimise
//      somme w_i (z_i - terrain_i)^2  +  LAMBDA * somme (z_i - z_j)^2 / l_ij
//    sur tous les points relies, avec w = 0 sur les ouvrages. Les noeuds etant
//    partages entre les rues, un carrefour garde une seule altitude : pas de
//    marche entre deux chaussees qui se croisent.
//
// Pas de three.js : le module se teste dans Node sur le vrai reseau.

import type { RoadGraph } from "./graph";
import type { Relief } from "./relief";

/** Pas d'echantillonnage le long des edges, en metres. */
export const SAMPLE = 8;
/**
 * Raideur du lissage. Reglee sur le vrai reseau (voir le README) : assez pour
 * effacer la tole ondulee, pas assez pour raboter les dos d'ane des rues en
 * pente. En dessous de 2, le p99 de la courbure verticale restait au niveau du
 * terrain brut ; au dessus de 16, les sommets de cote s'arrondissaient de plus
 * d'un metre.
 */
export const LAMBDA = 6;
const SWEEPS = 80;
/**
 * Pente plafond. Les rues les plus raides de la ville font 20 a 21 % sur leur
 * longueur (rue Diderot, rue Valentin-Hauy) ; le plafond passe largement
 * au-dessus. Il ne vise que les artefacts : bretelles d'echangeur au bord d'un
 * talus ou d'une tranchee que la grille a 10 m etale, qui sortaient a 35-43 %
 * sur quelques dizaines de metres.
 */
export const MAX_GRADE = 0.3;
const LIMIT_SWEEPS = 40;

export type RoadProfile = {
  /** Altitude absolue (m) d'un point sur un edge, t dans [0, 1] de a vers b. */
  z(edgeId: number, t: number): number;
  /** Pente dz/ds le long de l'edge, de a vers b (sans unite). */
  grade(edgeId: number, t: number): number;
  /** Altitude absolue d'un noeud. */
  node(nodeId: number): number;
  stats: {
    samples: number;
    structures: number;
    /** ecart au terrain des points au sol : p50, p99 */
    fit: [number, number];
    ms: number;
  };
};

export function buildRoadProfile(g: RoadGraph, relief: Relief, lambda = LAMBDA): RoadProfile {
  const t0 = performance.now();
  const nNodes = g.nodes.size; // ids 0..n-1, attribues dans l'ordre par nodeAt

  // --- variables : les noeuds, puis les points interieurs de chaque edge ----
  const segs = new Int32Array(g.edges.length); // nombre de sous-segments par edge
  const first = new Int32Array(g.edges.length); // premier point interieur
  let n = nNodes;
  for (const e of g.edges) {
    const k = Math.max(1, Math.ceil(e.len / SAMPLE));
    segs[e.id] = k;
    first[e.id] = n;
    n += k - 1;
  }

  const terrain = new Float64Array(n);
  const w = new Float64Array(n);
  const z = new Float64Array(n);

  // Un noeud est attache au terrain des qu'une de ses rues l'est. Un noeud dont
  // toutes les rues sont des ouvrages est au milieu du pont ; il flotte.
  for (const node of g.nodes.values()) {
    terrain[node.id] = relief.at(node.x, node.y);
    let ground = node.edges.length === 1; // cul-de-sac : on l'accroche quand meme
    for (const id of node.edges) if (g.edges[id].structure === 0) ground = true;
    w[node.id] = ground ? 1 : 0;
  }
  let structures = 0;
  for (const e of g.edges) {
    if (e.structure) structures++;
    const k = segs[e.id];
    for (let i = 1; i < k; i++) {
      const v = first[e.id] + i - 1;
      const f = i / k;
      terrain[v] = relief.at(e.ax + (e.bx - e.ax) * f, e.ay + (e.by - e.ay) * f);
      w[v] = e.structure ? 0 : 1;
    }
  }

  // --- adjacence : chaque edge est une chaine a -> interieurs -> b ----------
  // CSR construit en deux passes, pour ne pas allouer un tableau par point.
  const deg = new Int32Array(n + 1);
  const chainVar = (e: number, i: number, k: number, a: number, b: number) =>
    i === 0 ? a : i === k ? b : first[e] + i - 1;
  for (const e of g.edges) {
    const k = segs[e.id];
    for (let i = 0; i < k; i++) {
      deg[chainVar(e.id, i, k, e.a, e.b)]++;
      deg[chainVar(e.id, i + 1, k, e.a, e.b)]++;
    }
  }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const nbr = new Int32Array(start[n]);
  const inv = new Float64Array(start[n]); // 1 / longueur du sous-segment
  const fill = start.slice(0, n);
  for (const e of g.edges) {
    const k = segs[e.id];
    const l = 1 / Math.max(0.05, e.len / k);
    for (let i = 0; i < k; i++) {
      const p = chainVar(e.id, i, k, e.a, e.b);
      const q = chainVar(e.id, i + 1, k, e.a, e.b);
      nbr[fill[p]] = q;
      inv[fill[p]++] = l;
      nbr[fill[q]] = p;
      inv[fill[q]++] = l;
    }
  }

  // --- depart : terrain au sol, interpolation lineaire sur les ouvrages -----
  // Gauss-Seidel seul mettrait des milliers de passes a tendre un viaduc de
  // 50 points entre ses culees. On part donc d'une interpolation par distance
  // aux culees, a travers l'ouvrage (Dijkstra depuis chaque culee), exacte sur
  // un tablier sans branche : z = (zA dB + zB dA) / (dA + dB).
  z.set(terrain);
  seedStructures(n, w, z, start, nbr, inv);

  // --- lissage --------------------------------------------------------------
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (let i = 0; i < n; i++) {
      let num = w[i] * terrain[i];
      let den = w[i];
      for (let j = start[i]; j < start[i + 1]; j++) {
        const c = lambda * inv[j];
        num += c * z[nbr[j]];
        den += c;
      }
      if (den > 0) z[i] = num / den;
    }
  }

  // --- plafond de pente --------------------------------------------------------
  // Relaxation par paires : quand deux points voisins depassent la pente
  // plafond, chacun fait la moitie du chemin. Converge en quelques passes, et
  // ne touche rien la ou la pente est deja raisonnable.
  for (let sweep = 0; sweep < LIMIT_SWEEPS; sweep++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      for (let j = start[i]; j < start[i + 1]; j++) {
        const k = nbr[j];
        if (k < i) continue;
        const d = z[k] - z[i];
        const max = MAX_GRADE / inv[j];
        const over = Math.abs(d) - max;
        if (over <= 1e-4) continue;
        const shift = (over / 2) * Math.sign(d);
        z[i] += shift;
        z[k] -= shift;
        moved++;
      }
    }
    if (!moved) break;
  }

  // ecart au terrain, sur les seuls points au sol
  const dev: number[] = [];
  for (let i = 0; i < n; i += 7) if (w[i] > 0) dev.push(Math.abs(z[i] - terrain[i]));
  dev.sort((a, b) => a - b);
  const q = (p: number) => (dev.length ? dev[Math.floor(p * (dev.length - 1))] : 0);

  const at = (edgeId: number, t: number): [number, number, number] => {
    const e = g.edges[edgeId];
    const k = segs[edgeId];
    const f = Math.min(k - 1e-9, Math.max(0, t * k));
    const i = Math.floor(f);
    const a = chainVar(edgeId, i, k, e.a, e.b);
    const b = chainVar(edgeId, i + 1, k, e.a, e.b);
    return [z[a], z[b], f - i];
  };

  return {
    z(edgeId, t) {
      const [za, zb, f] = at(edgeId, t);
      return za + (zb - za) * f;
    },
    grade(edgeId, t) {
      const [za, zb] = at(edgeId, t);
      const e = g.edges[edgeId];
      return (zb - za) / Math.max(0.05, e.len / segs[edgeId]);
    },
    node(nodeId) {
      return z[nodeId];
    },
    stats: {
      samples: n,
      structures,
      fit: [q(0.5), q(0.99)],
      ms: performance.now() - t0,
    },
  };
}

/** Pose les points des ouvrages (w = 0) par distance a leurs culees. */
function seedStructures(
  n: number,
  w: Float64Array,
  z: Float64Array,
  start: Int32Array,
  nbr: Int32Array,
  inv: Float64Array,
) {
  // Composantes d'ouvrage : points flottants relies entre eux. Leurs culees sont
  // les points au sol qui les touchent.
  const comp = new Int32Array(n).fill(-1);
  let c = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (w[s] > 0 || comp[s] >= 0) continue;
    const members: number[] = [];
    const anchors = new Set<number>();
    comp[s] = c;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      for (let j = start[i]; j < start[i + 1]; j++) {
        const k = nbr[j];
        if (w[k] > 0) anchors.add(k);
        else if (comp[k] < 0) {
          comp[k] = c;
          stack.push(k);
        }
      }
    }
    c++;
    if (!anchors.size) continue; // ouvrage isole : on garde le terrain

    // Dijkstra depuis chaque culee, a l'interieur de l'ouvrage. Les ouvrages
    // font quelques dizaines de points : un tas n'apporterait rien.
    const num = new Map<number, number>();
    const den = new Map<number, number>();
    for (const a of anchors) {
      const dist = new Map<number, number>([[a, 0]]);
      const open = [a];
      while (open.length) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (dist.get(open[k])! < dist.get(open[bi])!) bi = k;
        const i = open[bi];
        open[bi] = open[open.length - 1];
        open.pop();
        const di = dist.get(i)!;
        for (let j = start[i]; j < start[i + 1]; j++) {
          const k = nbr[j];
          if (w[k] > 0) continue; // on ne ressort pas de l'ouvrage
          const dk = di + 1 / inv[j];
          if (dk < (dist.get(k) ?? Infinity)) {
            if (!dist.has(k)) open.push(k);
            dist.set(k, dk);
          }
        }
      }
      for (const m of members) {
        const d = dist.get(m);
        if (d === undefined) continue;
        const wt = 1 / Math.max(0.5, d);
        num.set(m, (num.get(m) ?? 0) + wt * z[a]);
        den.set(m, (den.get(m) ?? 0) + wt);
      }
    }
    for (const m of members) {
      const d = den.get(m);
      if (d) z[m] = num.get(m)! / d;
    }
  }
}
