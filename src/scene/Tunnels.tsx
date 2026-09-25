import { useMemo } from "react";
import * as THREE from "three";
import type { RoadGraph } from "../lib/graph";
import { elevation, inTube, roadY, terrainY, tubeCeiling } from "../lib/elevation";

// Les tubes des tunnels profonds (voir classifyTunnels dans elevation.ts).
//
// Sans eux, la voiture qui entrait sous la colline roulait dans la masse du
// terrain : la camera voyait l'envers du sol, un ecran noir. Un tube, c'est deux
// piedroits, une voute plate a TUBE_H, une rangee d'eclairages orange au
// plafond (sodium, comme sous la N88) et, a chaque entree, une tete en beton
// qui monte jusqu'au flanc de la colline.

const WALL = new THREE.Color(0x55575b);
const CEIL = new THREE.Color(0x3a3c40);
const HEAD = new THREE.Color(0x6a6b6d);
// HDR, hors tone mapping : les plafonniers passent le seuil du bloom
const LIGHT = new THREE.Color(2.4, 1.3, 0.45);
const MARGIN = 1.2; // trottoir technique de chaque cote de la chaussee

type Buf = { pos: number[]; col: number[] };

function quad(b: Buf, a: number[], c: number[], d: number[], e: number[], col: THREE.Color) {
  b.pos.push(...a, ...c, ...d, ...a, ...d, ...e);
  for (let k = 0; k < 6; k++) b.col.push(col.r, col.g, col.b);
}

export function Tunnels({ graph }: { graph: RoadGraph }) {
  const built = useMemo(() => {
    if (!elevation.on) return null;
    const solid: Buf = { pos: [], col: [] };
    const glow: Buf = { pos: [], col: [] };
    let metres = 0;
    let heads = 0;

    // Tete de tunnel au point (x, y, z) de l'edge e, face vers `dir` (+1 : la
    // bouche regarde vers b, -1 : vers a). Mur au-dessus de l'ouverture jusqu'au
    // flanc de la colline, et deux joues jusqu'au sol de part et d'autre.
    const head = (e: (typeof graph.edges)[number], x: number, y: number, z: number, ceil: number, dir: number) => {
      const hw = e.halfWidth + MARGIN;
      const top = Math.max(z + ceil + 1.5, terrainY(x, y) + 1);
      const w = hw + 3;
      const px = -e.dy * w;
      const py = e.dx * w;
      const ox = x + e.dx * dir * 0.3;
      const oy = y + e.dy * dir * 0.3;
      quad(solid, [ox + px, z + ceil, -(oy + py)], [ox - px, z + ceil, -(oy - py)], [ox - px, top, -(oy - py)], [ox + px, top, -(oy + py)], HEAD);
      for (const s of [-1, 1]) {
        const jx = ox + -e.dy * hw * s;
        const jy = oy + e.dx * hw * s;
        const kx = ox + -e.dy * w * s;
        const ky = oy + e.dx * w * s;
        quad(solid, [jx, z - 0.3, -jy], [kx, z - 0.3, -ky], [kx, top, -ky], [jx, z + ceil, -jy], HEAD);
      }
      heads++;
    };

    // Un troncon de 8 m est un tube si le terrain le couvre en son milieu.
    const pieces = (e: (typeof graph.edges)[number]) => Math.max(1, Math.ceil(e.len / 8));
    const pieceTube = (e: (typeof graph.edges)[number], i: number) =>
      e.structure === 2 && inTube(e.id, (i + 0.5) / pieces(e));
    // Le troncon voisin, de l'autre cote d'un noeud, sur le tunnel qui continue.
    const beyond = (e: (typeof graph.edges)[number], nodeId: number) => {
      const node = graph.nodes.get(nodeId)!;
      for (const id of node.edges) {
        if (id === e.id) continue;
        const o = graph.edges[id];
        if (o.structure !== 2) continue;
        return pieceTube(o, o.a === nodeId ? 0 : pieces(o) - 1);
      }
      return false;
    };

    for (const e of graph.edges) {
      if (e.structure !== 2) continue;
      const k = pieces(e);
      const hw = e.halfWidth + MARGIN;
      const nx = -e.dy * hw;
      const ny = e.dx * hw;
      for (let i = 0; i < k; i++) {
        if (!pieceTube(e, i)) continue;
        const t0 = i / k;
        const t1 = (i + 1) / k;
        metres += e.len / k;
        const ax = e.ax + (e.bx - e.ax) * t0;
        const ay = e.ay + (e.by - e.ay) * t0;
        const bx = e.ax + (e.bx - e.ax) * t1;
        const by = e.ay + (e.by - e.ay) * t1;
        const za = roadY(e.id, t0);
        const zb = roadY(e.id, t1);
        // voute sous la couverture du point : haute sous la colline, basse
        // dans une tranchee couverte
        const ca = za + tubeCeiling(e.id, t0);
        const cb = zb + tubeCeiling(e.id, t1);
        for (const s of [-1, 1]) {
          quad(
            solid,
            [ax + nx * s, za - 0.3, -(ay + ny * s)],
            [bx + nx * s, zb - 0.3, -(by + ny * s)],
            [bx + nx * s, cb, -(by + ny * s)],
            [ax + nx * s, ca, -(ay + ny * s)],
            WALL,
          );
        }
        quad(
          solid,
          [ax + nx, ca, -(ay + ny)],
          [bx + nx, cb, -(by + ny)],
          [bx - nx, cb, -(by - ny)],
          [ax - nx, ca, -(ay - ny)],
          CEIL,
        );
        // plafonnier au milieu du troncon
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const mz = (ca + cb) / 2 - 0.05;
        const lx = e.dx * 0.9;
        const ly = e.dy * 0.9;
        const wx = -e.dy * 0.35;
        const wy = e.dx * 0.35;
        quad(
          glow,
          [mx - lx + wx, mz, -(my - ly + wy)],
          [mx + lx + wx, mz, -(my + ly + wy)],
          [mx + lx - wx, mz, -(my + ly - wy)],
          [mx - lx - wx, mz, -(my - ly - wy)],
          LIGHT,
        );
        // tetes : la ou le troncon voisin n'est pas un tube
        const prevTube = i > 0 ? pieceTube(e, i - 1) : beyond(e, e.a);
        const nextTube = i < k - 1 ? pieceTube(e, i + 1) : beyond(e, e.b);
        if (!prevTube) head(e, ax, ay, za, ca - za, -1);
        if (!nextTube) head(e, bx, by, zb, cb - zb, 1);
      }
    }

    const toGeo = (b: Buf, normals: boolean) => {
      if (!b.pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      if (normals) g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    };
    console.log(`tunnels: ${Math.round(metres)} m de tube, ${heads} tetes`);
    return { solid: toGeo(solid, true), glow: toGeo(glow, false) };
  }, [graph]);

  if (!built) return null;
  return (
    <group>
      {built.solid && (
        <mesh geometry={built.solid}>
          <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
        </mesh>
      )}
      {built.glow && (
        <mesh geometry={built.glow}>
          <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
