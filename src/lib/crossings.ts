// Passages pietons, poses sur les traversees reellement relevees dans OSM.
//
// Rien n'est devine ici, ni la position ni l'existence : c'est la seule couche
// de marquage du jeu qui ne soit pas une convention de dessin. Saint-Etienne en
// cartographie 4 762, dont 4 178 marques au sol, ce qui est enorme pour une
// donnee benevole et rend la couche possible.
//
// Ce que la mesure a etabli avant d'ecrire ce fichier :
//
//   - 2 386 passages marques tombent sur une chaussee qu'on dessine, dans la
//     boite jouable. Les autres sont hors boite (1 499), sans route a moins de
//     25 m (37), ou a plus d'une demi-chaussee de tout axe (256) : ceux-la sont
//     sur des cheminements pietons que le jeu ne rend pas.
//   - Leur position est celle d'un NOEUD DE LA CHAUSSEE : distance mediane a
//     l'axe de 0,0 m. Il n'y a donc rien a projeter, seulement a orienter.
//   - L'ORIENTATION se derive de la rue, et OSM le confirme : sur les 81
//     passages qui sont cartographies en ligne et non en point, l'angle entre
//     la ligne relevee et la tangente de la rue vaut 87 degres en mediane et
//     90 au p90. La perpendiculaire a la chaussee est donc la bonne regle,
//     verifiee sur la donnee plutot que supposee.
//
// La forme vient du reglement francais (IISR, article 113-1) : des bandes
// blanches PARALLELES A L'AXE de la chaussee, larges de 0,50 m, espacees de
// 0,50 a 0,80 m. C'est ce qui fait qu'un conducteur voit des barres pointees
// vers lui et non des barres en travers.
//
// Ce qui n'est pas source, et qui est donc annonce : la LONGUEUR du passage,
// c'est-a-dire la place qu'il prend le long de la rue. OSM ne la porte pas. Le
// reglement pose un plancher de 2,50 m ; on le garde sur les petites rues et on
// elargit sur les axes, ou un passage est toujours plus genereux.

import type { RoadGraph } from "./graph";
import { LAYER_STEP, specFor } from "./osm";
import type { Crossing } from "./voirie";

/** Largeur d'une bande, en metres. Reglementaire. */
const BAND = 0.5;

/** Pas d'une bande a la suivante : 0,50 de bande plus 0,60 de vide. */
const PITCH = 1.1;

/** Marge laissee au bord de la chaussee, pour ne pas mordre la bordure. */
const EDGE_GAP = 0.35;

/** Longueur du passage le long de la rue. Non sourcee : plancher reglementaire. */
const LENGTH = 2.5;

/** Sur ces classes, un passage est plus genereux. */
const WIDE = new Set(["primary", "secondary", "tertiary", "trunk", "trunk_link", "primary_link", "secondary_link"]);
const WIDE_LENGTH = 4;

/** Au dessus du ruban de sa classe, et au dessus de l'axe discontinu (+0,02). */
const LIFT = 0.03;

/**
 * Deux passages du meme troncon a moins de ce pas sont le meme passage vu deux
 * fois : OSM le cartographie souvent en noeud ET en ligne. Mesure : 356 points
 * marques ont un voisin a moins de 6 m. Le regroupement se fait par troncon et
 * par position le long de l'axe, jamais par simple distance, sinon les quatre
 * traversees d'un carrefour fusionneraient en une.
 */
const MERGE_STEP = 4;

/** Un passage retenu, deja resolu sur sa chaussee. */
type Placed = {
  x: number;
  y: number;
  /** tangente de la rue */
  tx: number;
  ty: number;
  half: number;
  h: number;
  length: number;
};

export type CrossingMesh = {
  pos: Float32Array;
  stats: {
    marked: number;
    posed: number;
    outsideArea: number;
    noRoad: number;
    offRoad: number;
    merged: number;
    bands: number;
    triangles: number;
    ms: number;
  };
};

export function buildCrossings(
  crossings: Crossing[],
  graph: RoadGraph,
  centre: { x: number; y: number },
  area = Infinity,
): CrossingMesh {
  const t0 = Date.now();
  const placed: Placed[] = [];
  const seen = new Set<string>();
  let marked = 0;
  let outsideArea = 0;
  let noRoad = 0;
  let offRoad = 0;
  let merged = 0;

  for (const c of crossings) {
    // Un passage non marque n'a rien de peint au sol : il n'y a rien a dessiner.
    if (!c.marked) continue;
    marked++;
    if (Math.abs(c.x - centre.x) > area || Math.abs(c.y - centre.y) > area) {
      outsideArea++;
      continue;
    }
    const hit = graph.nearestEdge(c.x, c.y, 25);
    if (!hit) {
      noRoad++;
      continue;
    }
    // Au dela de la demi-chaussee elargie, le passage est sur un cheminement
    // pieton que le jeu ne rend pas : le poser sur la rue la plus proche
    // inventerait une traversee la ou il n'y en a pas.
    if (hit.dist > hit.edge.halfWidth + 1.5) {
      offRoad++;
      continue;
    }
    const key = hit.edge.id + ":" + Math.round((hit.t * hit.edge.len) / MERGE_STEP);
    if (seen.has(key)) {
      merged++;
      continue;
    }
    seen.add(key);

    const spec = specFor(hit.edge.type);
    placed.push({
      // on se recale sur l'axe : la traversee prend toute la chaussee
      x: hit.x,
      y: hit.y,
      tx: hit.tx,
      ty: hit.ty,
      half: hit.edge.halfWidth,
      h: spec.z * LAYER_STEP + LIFT,
      length: WIDE.has(hit.edge.type) ? WIDE_LENGTH : LENGTH,
    });
  }

  const pos: number[] = [];
  let bands = 0;
  for (const p of placed) {
    const nx = -p.ty;
    const ny = p.tx;
    const usable = p.half * 2 - EDGE_GAP * 2;
    if (usable < BAND) continue;
    const n = Math.max(1, Math.floor((usable + (PITCH - BAND)) / PITCH));
    // les bandes sont centrees sur l'axe, pas alignees sur un bord
    const span = n * BAND + (n - 1) * (PITCH - BAND);
    let off = -span / 2;
    const halfLen = p.length / 2;
    for (let i = 0; i < n; i++) {
      const a = off;
      const b = off + BAND;
      off += PITCH;
      bands++;
      // coins du rectangle : largeur en travers (a..b), longueur le long de l'axe
      const c0x = p.x + nx * a - p.tx * halfLen;
      const c0y = p.y + ny * a - p.ty * halfLen;
      const c1x = p.x + nx * b - p.tx * halfLen;
      const c1y = p.y + ny * b - p.ty * halfLen;
      const c2x = p.x + nx * b + p.tx * halfLen;
      const c2y = p.y + ny * b + p.ty * halfLen;
      const c3x = p.x + nx * a + p.tx * halfLen;
      const c3y = p.y + ny * a + p.ty * halfLen;
      pos.push(
        c0x, p.h, -c0y, c1x, p.h, -c1y, c2x, p.h, -c2y,
        c0x, p.h, -c0y, c2x, p.h, -c2y, c3x, p.h, -c3y,
      );
    }
  }

  return {
    pos: new Float32Array(pos),
    stats: {
      marked,
      posed: placed.length,
      outsideArea,
      noRoad,
      offRoad,
      merged,
      bands,
      triangles: pos.length / 9,
      ms: Date.now() - t0,
    },
  };
}
