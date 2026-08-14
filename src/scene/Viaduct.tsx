import { useMemo } from "react";
import * as THREE from "three";
import { DECK_HEIGHT, DECK_THICKNESS, DECK_WIDTH, railLength, type FlatRail, type RoadProbe } from "../lib/rail";
import type { FlatBuilding } from "../lib/buildings";

// Le viaduc : tablier continu le long du trace ferroviaire reel, sur ses piles.
//
// Il est construit une fois, hors streaming, comme les reperes : 2 175 m de voie
// aerienne sur toute la ville ne pesent que quelques milliers de triangles, et
// un ouvrage qui apparait par tuiles se verrait de loin.
//
// Trois regles tiennent la credibilite, et elles sont mesurees, pas devinees :
//   - aucune pile DANS un batiment. Le trace passe au-dessus de quelques
//     emprises ; y planter un poteau donnerait un pilier qui traverse un toit.
//   - aucune pile SUR une chaussee. Signale depuis le jeu, boulevard Alfred de
//     Musset et rue Rouget de Lisle : les piles se plantaient au milieu de la
//     route. Un viaduc franchit une rue, ses appuis sont sur les cotes. Quand
//     l'appui theorique tombe sur la chaussee, on le decale le long de
//     l'ouvrage jusqu'a trouver un sol libre, et a defaut on saute la travee.
//   - pas de pile sous une rampe d'about : en dessous de 4 m le tablier est un
//     remblai, il ne repose plus sur des poteaux.

const PIER_SPACING = 14; // metres entre deux piles
const PIER_W = 2.4;
const PIER_D = 3.2;
const PIER_MIN_HEIGHT = 4;

const DECK_TOP: [number, number, number] = [0.34, 0.35, 0.37];
const DECK_SIDE: [number, number, number] = [0.27, 0.28, 0.3];
const BALLAST: [number, number, number] = [0.19, 0.18, 0.17];
const PIER: [number, number, number] = [0.3, 0.31, 0.33];

/** Grille de 60 m sur les emprises, pour tester une pile sans balayer la ville. */
function buildingGrid(buildings: FlatBuilding[]) {
  const cell = 60;
  const grid = new Map<string, FlatBuilding[]>();
  for (const b of buildings) {
    const k = `${Math.floor(b.cx / cell)}:${Math.floor(b.cy / cell)}`;
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(b);
  }
  return (x: number, y: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const b of grid.get(`${gx + i}:${gy + j}`) ?? []) {
          // point dans polygone, sur le contour projete
          let inside = false;
          const r = b.ring;
          for (let p = 0, q = r.length - 1; p < r.length; q = p++) {
            if (
              r[p].y > y !== r[q].y > y &&
              x < ((r[q].x - r[p].x) * (y - r[p].y)) / (r[q].y - r[p].y) + r[p].x
            ) {
              inside = !inside;
            }
          }
          if (inside) return true;
        }
      }
    }
    return false;
  };
}

type Buf = { pos: number[]; col: number[] };

function quad(
  b: Buf,
  p0: number[], p1: number[], p2: number[], p3: number[],
  c: [number, number, number],
) {
  b.pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
  for (let i = 0; i < 6; i++) b.col.push(c[0], c[1], c[2]);
}

function box(b: Buf, cx: number, cy: number, w: number, d: number, z0: number, z1: number, c: [number, number, number]) {
  const hw = w / 2, hd = d / 2;
  const A = [cx - hw, cy - hd], B = [cx + hw, cy - hd], C = [cx + hw, cy + hd], D = [cx - hw, cy + hd];
  const P = (p: number[], z: number) => [p[0], z, -p[1]];
  quad(b, P(A, z0), P(B, z0), P(B, z1), P(A, z1), c);
  quad(b, P(B, z0), P(C, z0), P(C, z1), P(B, z1), c);
  quad(b, P(C, z0), P(D, z0), P(D, z1), P(C, z1), c);
  quad(b, P(D, z0), P(A, z0), P(A, z1), P(D, z1), c);
  quad(b, P(A, z1), P(B, z1), P(C, z1), P(D, z1), c);
}

export function Viaduct({
  rail,
  buildings,
  onRoad,
}: {
  rail: FlatRail[];
  buildings: FlatBuilding[];
  onRoad: RoadProbe | null;
}) {
  const geometry = useMemo(() => {
    const t0 = performance.now();
    const buf: Buf = { pos: [], col: [] };
    const inBuilding = buildingGrid(buildings);
    const blocked = (x: number, y: number) => inBuilding(x, y) || (onRoad ? onRoad(x, y) : false);
    let piers = 0;
    let skipped = 0;
    let shifted = 0;

    for (const line of rail) {
      const pts = line.points;
      let carry = PIER_SPACING / 2;

      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.2) continue;
        const nx = -dy / len, ny = dx / len; // normale horizontale
        const hw = DECK_WIDTH / 2;

        const corner = (p: typeof a, s: number, z: number) => [p.x + nx * hw * s, z, -(p.y + ny * hw * s)];

        // dessus du tablier
        quad(
          buf,
          corner(a, -1, a.z), corner(b, -1, b.z), corner(b, 1, b.z), corner(a, 1, a.z),
          DECK_TOP,
        );
        // bande de ballast, plus sombre, au milieu
        const bw = DECK_WIDTH * 0.55 / 2;
        const bal = (p: typeof a, s: number) => [p.x + nx * bw * s, p.z + 0.12, -(p.y + ny * bw * s)];
        quad(buf, bal(a, -1), bal(b, -1), bal(b, 1), bal(a, 1), BALLAST);
        // les deux joues
        for (const s of [-1, 1] as const) {
          quad(
            buf,
            corner(a, s, a.z - DECK_THICKNESS), corner(b, s, b.z - DECK_THICKNESS),
            corner(b, s, b.z), corner(a, s, a.z),
            DECK_SIDE,
          );
        }

        // les piles, espacees le long de l'ouvrage
        carry += len;
        while (carry >= PIER_SPACING) {
          carry -= PIER_SPACING;
          const t = 1 - carry / len;
          if (t < 0 || t > 1) continue;
          const px = a.x + dx * t;
          const py = a.y + dy * t;
          const pz = a.z + (b.z - a.z) * t;
          if (pz - DECK_THICKNESS < PIER_MIN_HEIGHT) continue; // remblai, pas de pile
          // On cherche un sol libre en glissant le long de l'ouvrage, de part
          // et d'autre de l'appui theorique.
          let ox = px, oy = py, ok = !blocked(px, py), moved = 0;
          if (!ok) {
            for (const d of [2, -2, 4, -4, 6, -6]) {
              const t2 = t + d / len;
              if (t2 < 0 || t2 > 1) continue;
              const cx = a.x + dx * t2, cy = a.y + dy * t2;
              if (!blocked(cx, cy)) { ox = cx; oy = cy; ok = true; moved = d; break; }
            }
          }
          if (!ok) { skipped++; continue; }
          if (moved) shifted++;
          const oz = a.z + (b.z - a.z) * (t + moved / len);
          box(buf, ox, oy, PIER_W, PIER_D, 0, oz - DECK_THICKNESS, PIER);
          piers++;
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(buf.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    console.log(
      `viaduc: ${rail.length} troncons aeriens, ${Math.round(railLength(rail))} m, ` +
        `${piers} piles (${shifted} decalees, ${skipped} sautees : batiment ou chaussee), ` +
        `${Math.round(buf.pos.length / 9)} tris, ${Math.round(performance.now() - t0)} ms`,
    );
    return g;
  }, [rail, buildings, onRoad]);

  if (!rail.length) return null;
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

export { DECK_HEIGHT };
