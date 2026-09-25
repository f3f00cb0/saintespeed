import { useMemo } from "react";
import * as THREE from "three";
import type { EdgeHit, RoadGraph } from "../lib/graph";
import { elevation, roadY, surfaceY } from "../lib/elevation";

// Les ponts routiers vus du dessous.
//
// Sur un sol plat, un pont n'etait qu'une chaussee comme une autre. Avec le
// relief, son tablier passe jusqu'a 26 m au-dessus du fond du vallon (viaducs
// de la N88), et un ruban sans epaisseur ni appui y flottait dans le vide. On
// lui donne donc ce qu'on voit d'un pont depuis la rue d'en dessous : une
// poutre de rive de chaque cote, et des piles.
//
// Les piles ne se posent que la ou le tablier est a plus de PIER_MIN du sol,
// tous les PIER_STEP metres, et jamais sur une chaussee qui passe dessous : on
// les decale le long de l'ouvrage jusqu'a trouver un sol libre, ou on saute.

const BEAM = 1.1; // hauteur des poutres de rive, sous le tablier
const PIER_MIN = 3;
const PIER_STEP = 25;
const PIER_T = 1.6; // epaisseur de pile, le long de l'ouvrage
const DECK_SIDE = new THREE.Color(0x4a4c50);
const PIER = new THREE.Color(0x3e4044);

type Buf = { pos: number[]; col: number[] };

function quad(b: Buf, a: number[], c: number[], d: number[], e: number[], col: THREE.Color) {
  b.pos.push(...a, ...c, ...d, ...a, ...d, ...e);
  for (let k = 0; k < 6; k++) b.col.push(col.r, col.g, col.b);
}

/** Pave vertical d'axe (ux, uy) : longueur l, largeur w, de y0 a y1. */
function pillar(b: Buf, x: number, y: number, ux: number, uy: number, l: number, w: number, y0: number, y1: number) {
  const vx = -uy;
  const vy = ux;
  const c = (s: number, t: number) => [x + ux * s * l / 2 + vx * t * w / 2, y + uy * s * l / 2 + vy * t * w / 2];
  const pts = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % 4];
    quad(b, [ax, y0, -ay], [bx, y0, -by], [bx, y1, -by], [ax, y1, -ay], PIER);
  }
}

const probe: EdgeHit = { edge: null!, t: 0, x: 0, y: 0, dist: 0, tx: 0, ty: 0 };

export function Bridges({ graph }: { graph: RoadGraph }) {
  const geometry = useMemo(() => {
    if (!elevation.on) return null;
    const t0 = performance.now();
    const b: Buf = { pos: [], col: [] };
    let piers = 0;
    let skipped = 0;
    // abscisse cumulee par way : les piles se repartent sur tout l'ouvrage, pas
    // edge par edge, sinon deux piles se collent a chaque noeud
    const carry = new Map<number, number>();

    for (const e of graph.edges) {
      if (e.structure !== 1) continue;
      const nx = -e.dy * e.halfWidth;
      const ny = e.dx * e.halfWidth;
      const k = Math.max(1, Math.ceil(e.len / 8));
      for (let i = 0; i < k; i++) {
        const t0e = i / k;
        const t1e = (i + 1) / k;
        const ax = e.ax + (e.bx - e.ax) * t0e;
        const ay = e.ay + (e.by - e.ay) * t0e;
        const bx = e.ax + (e.bx - e.ax) * t1e;
        const by = e.ay + (e.by - e.ay) * t1e;
        const za = roadY(e.id, t0e);
        const zb = roadY(e.id, t1e);
        for (const s of [-1, 1]) {
          quad(
            b,
            [ax + nx * s, za - BEAM, -(ay + ny * s)],
            [bx + nx * s, zb - BEAM, -(by + ny * s)],
            [bx + nx * s, zb + 0.05, -(by + ny * s)],
            [ax + nx * s, za + 0.05, -(ay + ny * s)],
            DECK_SIDE,
          );
        }
        // sous-face : on la voit de la rue d'en dessous
        quad(
          b,
          [ax + nx, za - BEAM, -(ay + ny)],
          [bx + nx, zb - BEAM, -(by + ny)],
          [bx - nx, zb - BEAM, -(by - ny)],
          [ax - nx, za - BEAM, -(ay - ny)],
          DECK_SIDE,
        );
      }

      let c = carry.get(e.wayId) ?? PIER_STEP / 2;
      c += e.len;
      while (c >= PIER_STEP) {
        c -= PIER_STEP;
        const t = 1 - c / e.len;
        if (t < 0 || t > 1) continue;
        let placed = false;
        for (const shift of [0, 3, -3, 6, -6]) {
          const tt = t + shift / e.len;
          if (tt < 0 || tt > 1) continue;
          const x = e.ax + (e.bx - e.ax) * tt;
          const y = e.ay + (e.by - e.ay) * tt;
          const deck = roadY(e.id, tt);
          const ground = surfaceY(x, y);
          if (deck - ground < PIER_MIN) break; // tablier bas : culee, pas de pile
          // une chaussee au sol passe ici : on glisse le long de l'ouvrage
          const under = graph.nearestEdgeInto(x, y, probe, 20, true);
          if (under && under.dist < under.edge.halfWidth + PIER_T) continue;
          pillar(b, x, y, e.dx, e.dy, PIER_T, e.halfWidth * 1.2, ground - 0.5, deck - BEAM);
          piers++;
          placed = true;
          break;
        }
        if (!placed) skipped++;
      }
      carry.set(e.wayId, c);
    }

    if (!b.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    console.log(
      `ponts routiers: ${piers} piles (${skipped} sautees : tablier bas ou chaussee dessous), ` +
        `${Math.round(b.pos.length / 9)} tris, ${Math.round(performance.now() - t0)} ms`,
    );
    return g;
  }, [graph]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}
