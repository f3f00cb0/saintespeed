import { useMemo } from "react";
import * as THREE from "three";
import {
  AREA_BASE,
  AREA_STEP,
  areaSpec,
  type FlatArea,
  type FlatPath,
} from "../lib/features";
import { CHARACTER_NAMES, characterSpec, type Character } from "../lib/places";

// Surfaces au sol : places pietonnes, parcs, parkings, eau.
//
// C'est la couche qui bouche les trous. Une place n'est pas une ligne, donc
// l'import "routes seules" la laissait en noir : Jean Moulin et l'Hotel de
// Ville etaient des cratieres au milieu de la ville. Ici chaque polygone OSM
// devient un mesh plat, triangule a la preparation (features.ts).
//
// Depuis la couche reconnaissance, les espaces ouverts ne sont plus peints par
// nature OSM mais par CARACTERE : mineral, jardin, parc. C'est ce qui separe
// trois places de loin, avant tout detail lisible, parce que c'est comme ca
// qu'un habitant a range sa memoire de la ville. Le reste (eau, parking,
// terrain de sport, cimetiere, foret) garde sa couleur de nature.
//
// Une geometrie fusionnee par groupe, donc une poignee de draw calls pour
// plusieurs milliers de polygones.

/** Les allees se posent juste au dessus de leur parc, sous la chaussee. */
const PATH_Z = 4.5;
const PATH_WIDTH = 2.2;

type Layer = {
  key: string;
  geometry: THREE.BufferGeometry;
  color: number;
  z: number;
};

function merge(areas: FlatArea[]): Layer[] {
  const buckets = new Map<string, { list: FlatArea[]; color: number; z: number }>();

  for (const a of areas) {
    // Un espace ouvert est peint par caractere, tout le reste par nature.
    const byChar = a.character !== null;
    const key = byChar ? `c${a.character}` : `k${a.kind}`;
    let b = buckets.get(key);
    if (!b) {
      const { color, z } = byChar
        ? (({ ground, z }) => ({ color: ground, z }))(characterSpec(a.character as Character))
        : (({ c, z }) => ({ color: c, z }))(areaSpec(a.kind));
      buckets.set(key, (b = { list: [], color, z }));
    }
    b.list.push(a);
  }

  const out: Layer[] = [];
  for (const [key, b] of buckets) {
    let n = 0;
    for (const a of b.list) n += a.pos.length;
    const pos = new Float32Array(n);
    let o = 0;
    for (const a of b.list) {
      pos.set(a.pos, o);
      o += a.pos.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.computeBoundingSphere();
    out.push({ key, geometry, color: b.color, z: b.z });
  }

  // le rang de dessin double la separation en hauteur : sur deux surfaces
  // quasi coplanaires, c'est lui qui tranche
  out.sort((a, b) => a.z - b.z);
  return out;
}

// Elargit une allee en ruban. Meme principe que les rues pietonnes.
function widenPath(pts: { x: number; y: number }[], half: number, y: number): number[] {
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    dx /= len;
    dy /= len;
    const nx = -dy * half;
    const ny = dx * half;
    pos.push(
      a.x + nx, y, -(a.y + ny), b.x + nx, y, -(b.y + ny), b.x - nx, y, -(b.y - ny),
      a.x + nx, y, -(a.y + ny), b.x - nx, y, -(b.y - ny), a.x - nx, y, -(a.y - ny),
    );
    // patch au sommet, sinon une encoche s'ouvre dans chaque angle
    const ex = dx * half;
    const ey = dy * half;
    pos.push(
      b.x - ex + nx, y, -(b.y - ey + ny), b.x + ex + nx, y, -(b.y + ey + ny),
      b.x + ex - nx, y, -(b.y + ey - ny),
      b.x - ex + nx, y, -(b.y - ey + ny), b.x + ex - nx, y, -(b.y + ey - ny),
      b.x - ex - nx, y, -(b.y - ey - ny),
    );
  }
  return pos;
}

// Gravier et terre contre beton : deux teintes suffisent, le detail exact de la
// surface ne survit pas a la distance. L'allee claire qui serpente sur la
// pelouse est une signature de parc.
const PATH_SOFT = 0x554d3e;
const PATH_HARD = 0x46433c;

function mergePaths(paths: FlatPath[]) {
  const soft: number[] = [];
  const hard: number[] = [];
  const y = AREA_BASE + PATH_Z * AREA_STEP;
  for (const p of paths) {
    const pos = widenPath(p.pts, PATH_WIDTH / 2, y);
    const dst = p.soft ? soft : hard;
    for (const v of pos) dst.push(v);
  }
  const out: Layer[] = [];
  for (const [key, pos, color] of [
    ["path-soft", soft, PATH_SOFT],
    ["path-hard", hard, PATH_HARD],
  ] as const) {
    if (!pos.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.computeBoundingSphere();
    out.push({ key, geometry, color, z: PATH_Z });
  }
  return out;
}

export function Ground({ areas, paths = [] }: { areas: FlatArea[]; paths?: FlatPath[] }) {
  const layers = useMemo(() => {
    const t0 = performance.now();
    const l = merge(areas).concat(mergePaths(paths));
    const tris = l.reduce((a, x) => a + x.geometry.attributes.position.count / 3, 0);

    const byChar = new Map<number, number>();
    for (const a of areas) if (a.character !== null) byChar.set(a.character, (byChar.get(a.character) || 0) + 1);

    console.log(
      `sols: ${areas.length} surfaces, ${l.length} couches, ${Math.round(tris / 1000)}k triangles, ` +
        `${Math.round(performance.now() - t0)} ms\n` +
        `  caracteres: ` +
        [...byChar]
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `${CHARACTER_NAMES[c]} ${n}`)
          .join(", ") +
        `, allees: ${paths.length}`,
    );
    return l;
  }, [areas, paths]);

  return (
    <group>
      {layers.map((l, i) => (
        <mesh key={l.key} geometry={l.geometry} renderOrder={-100 + i}>
          {/* basic, comme les routes : de nuit la teinte est deja calee, on ne
              veut pas qu'une place pietonne devienne la source de lumiere de la
              scene sous la hemisphereLight */}
          <meshBasicMaterial color={l.color} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
