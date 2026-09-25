import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { car } from "../lib/car";
import { editView } from "../lib/editView";
import { elevation, surfaceY } from "../lib/elevation";
import type { EdgeHit } from "../lib/graph";
import { Lod, TILE, planStreaming, type TileRef } from "../lib/streaming";
import { useStore } from "../state/store";
import type { FlatArea } from "../lib/features";
import { areaLook, paintedOnTerrain } from "./Ground";

// Le terrain : la cuvette elle-meme, entre les objets poses au sol.
//
// Il remplace le plan sombre d'avant, qui ne pouvait etre qu'a une altitude.
// Il suit le sol de la ville (surfaceY : les chaussees, puis le terrain au-dela
// de leurs bords) et passe SINK metres dessous : il ne fait que boucher les
// vides entre les places, les trottoirs et les pieds d'immeubles, il ne recouvre
// jamais une chaussee. Entre deux sommets de sa grille, le sol reel peut
// s'ecarter de sa corde ; a 6 m de maille on reste sous les 30 cm.
//
// Meme streaming que les batiments (lib/streaming.ts) : une grille par tuile de
// 240 m, plus fine pres du joueur. Chaque tuile porte une jupe verticale sur
// son pourtour, qui bouche les fentes entre deux tuiles de maille differente.

// Sous les surfaces au sol, qui commencent a AREA_BASE = -0,30 m : a 30 cm le
// terrain aurait scintille avec les plus basses.
const SINK = 0.6;
const SKIRT = 4;
const CELL: Record<Lod, number> = { [Lod.Full]: 6, [Lod.Reduced]: 12, [Lod.Silhouette]: 30, [Lod.None]: 60 };
const COLOR = 0x191a10; // la teinte du sol nocturne d'avant, un rien plus claire
const PAINT_CELL = 64;

/**
 * Peinture des grandes surfaces naturelles sur le terrain (voir PAINTED_KINDS
 * dans Ground.tsx) : un index en grille de leurs triangles, et la couleur de
 * la surface qui contient un point. Les bords se fondent sur une maille de
 * terrain, 6 m pres du joueur : pour de l'herbe et de la foret, c'est le bon
 * flou.
 */
type Painter = (x: number, y: number) => number;

function makePainter(areas: FlatArea[] | null): Painter {
  const flat: Painter = () => COLOR;
  if (!areas) return flat;
  const tris: { ax: number; ay: number; bx: number; by: number; cx: number; cy: number; color: number; z: number }[] = [];
  const grid = new Map<string, number[]>();
  for (const a of areas) {
    if (!paintedOnTerrain(a)) continue;
    const { color, z } = areaLook(a);
    const p = a.pos;
    for (let i = 0; i + 8 < p.length; i += 9) {
      // pos est en repere three.js : z = -nord
      const t = { ax: p[i], ay: -p[i + 2], bx: p[i + 3], by: -p[i + 5], cx: p[i + 6], cy: -p[i + 8], color, z };
      const idx = tris.length;
      tris.push(t);
      const x0 = Math.floor(Math.min(t.ax, t.bx, t.cx) / PAINT_CELL);
      const x1 = Math.floor(Math.max(t.ax, t.bx, t.cx) / PAINT_CELL);
      const y0 = Math.floor(Math.min(t.ay, t.by, t.cy) / PAINT_CELL);
      const y1 = Math.floor(Math.max(t.ay, t.by, t.cy) / PAINT_CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const k = gx + ":" + gy;
          let b = grid.get(k);
          if (!b) grid.set(k, (b = []));
          b.push(idx);
        }
      }
    }
  }
  if (!tris.length) return flat;
  const side = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  return (x, y) => {
    const b = grid.get(Math.floor(x / PAINT_CELL) + ":" + Math.floor(y / PAINT_CELL));
    if (!b) return COLOR;
    let best = COLOR;
    let bestZ = -Infinity;
    for (const i of b) {
      const t = tris[i];
      const d1 = side(x, y, t.ax, t.ay, t.bx, t.by);
      const d2 = side(x, y, t.bx, t.by, t.cx, t.cy);
      const d3 = side(x, y, t.cx, t.cy, t.ax, t.ay);
      const inside = (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
      // en cas de recouvrement, la surface de rang le plus haut l'emporte,
      // comme dans l'empilement des couches au sol
      if (inside && t.z > bestZ) {
        bestZ = t.z;
        best = t.color;
      }
    }
    return best;
  };
}
// ~15 ms la tuile pleine avec l'enveloppe basse : deux par tick de streaming
const BUDGET = 2;
const STREAM_HZ = 6;

const scratch = new THREE.Color();
const probe: EdgeHit = { edge: null!, t: 0, x: 0, y: 0, dist: 0, tx: 0, ty: 0 };

/**
 * Altitude d'un sommet de terrain. Un triangle interpole entre ses trois
 * sommets : sur une chaussee qui descend dans un vallon, la corde entre deux
 * sommets passait au-dessus du bitume. Mesure le long des routes : 0,3 % des
 * points perces a 6 m de maille, 3,6 % a 12 m, 13 % a 30 m, soit des taches de
 * terrain sombre sur les rues des qu'on les voit d'un peu loin. Pres d'une
 * chaussee, le sommet prend donc le MINIMUM du sol sur sa demi-maille alentour :
 * aucun point de chaussee n'est plus perce, a aucune maille. Loin des routes,
 * rien ne change, les crêtes lointaines restent justes.
 */
function vertexY(x: number, y: number, step: number): number {
  const base = surfaceY(x, y);
  const near = elevation.graph?.nearestEdgeInto(x, y, probe, step + 16, true);
  if (!near || near.dist - near.edge.halfWidth > step + 8) return base;
  let m = base;
  const h = step / 2;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i || j) m = Math.min(m, surfaceY(x + i * h, y + j * h));
    }
  }
  return m;
}

function buildTile(tx: number, ty: number, lod: Lod, paint: Painter): THREE.BufferGeometry {
  const n = Math.round(TILE / CELL[lod]);
  const step = TILE / n;
  const x0 = tx * TILE;
  const y0 = ty * TILE;
  const side = n + 1;
  // grille + une rangee de jupe sur chaque bord
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * step;
      const y = y0 + j * step;
      pos.push(x, vertexY(x, y, step) - SINK, -y);
      scratch.setHex(paint(x, y));
      col.push(scratch.r, scratch.g, scratch.b);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // sens trigo vu de dessus, dans le repere three.js (z = -nord)
      idx.push(a, b, d, a, d, c);
    }
  }
  // jupe : on recopie le pourtour SKIRT metres plus bas et on referme
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(i);
  for (let j = 0; j < n; j++) ring.push(j * side + n);
  for (let i = n; i > 0; i--) ring.push(n * side + i);
  for (let j = n; j > 0; j--) ring.push(j * side);
  const base = pos.length / 3;
  for (const v of ring) {
    pos.push(pos[v * 3], pos[v * 3 + 1] - SKIRT, pos[v * 3 + 2]);
    col.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
  }
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const a2 = base + k;
    const b2 = base + ((k + 1) % ring.length);
    idx.push(a, a2, b, b, a2, b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

type Resident = { lod: Lod; geometry: THREE.BufferGeometry };

export function Terrain({ areas }: { areas: FlatArea[] | null }) {
  // Toutes les tuiles couvertes par le reseau : c'est la ou l'on roule.
  const refs = useMemo(() => {
    const g = elevation.graph;
    if (!g) return [] as TileRef[];
    const b = g.bounds;
    const out: TileRef[] = [];
    for (let tx = Math.floor(b.minx / TILE); tx <= Math.floor(b.maxx / TILE); tx++) {
      for (let ty = Math.floor(b.miny / TILE); ty <= Math.floor(b.maxy / TILE); ty++) out.push({ tx, ty });
    }
    return out;
  }, []);
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    [],
  );
  const paint = useMemo(() => makePainter(areas), [areas]);
  const resident = useRef(new Map<number, Resident>());
  const pending = useRef<THREE.BufferGeometry[]>([]);
  const [, bump] = useState(0);
  const acc = useRef(0);

  useEffect(() => () => material.dispose(), [material]);
  // Les surfaces arrivent apres le reseau : les tuiles deja construites sans
  // leur peinture sont jetees et refaites.
  useEffect(() => {
    const held = resident.current;
    const queued = pending.current;
    return () => {
      for (const t of held.values()) t.geometry.dispose();
      for (const g of queued) g.dispose();
      held.clear();
      queued.length = 0;
    };
  }, [paint]);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 1 / STREAM_HZ) return;
    acc.current = 0;
    // meme differe d'un tick que les batiments avant de liberer
    for (const g of pending.current) g.dispose();
    pending.current.length = 0;

    const cur = new Map<number, Lod>();
    for (const [k, t] of resident.current) cur.set(k, t.lod);
    const editing = useStore.getState().mode === "edit";
    const px = editing ? editView.x : car.x;
    const py = editing ? editView.y : car.y;
    const vx = editing ? 0 : Math.cos(car.heading) * car.speed;
    const vy = editing ? 0 : Math.sin(car.heading) * car.speed;
    const plan = planStreaming(refs, px, py, vx, vy, cur);

    let changed = false;
    for (const item of plan.load.slice(0, BUDGET)) {
      const old = resident.current.get(item.key);
      resident.current.set(item.key, { lod: item.lod, geometry: buildTile(item.tx, item.ty, item.lod, paint) });
      if (old) pending.current.push(old.geometry);
      changed = true;
    }
    for (const key of plan.drop) {
      const t = resident.current.get(key);
      if (!t) continue;
      pending.current.push(t.geometry);
      resident.current.delete(key);
      changed = true;
    }
    if (changed) bump((v) => v + 1);
  });

  return (
    <group>
      {[...resident.current.entries()].map(([key, t]) => (
        <mesh key={key} geometry={t.geometry} material={material} />
      ))}
    </group>
  );
}

