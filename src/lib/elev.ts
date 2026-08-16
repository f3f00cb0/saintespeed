// MNT baké (IGN RGE ALTI). Sans fichier, tout reste a z = 0 : le jeu plat.
//
// zAt est en metres AU-DESSUS du minimum de la grille, pour que le centre-ville
// ne vive pas a y = 500. Le proto deplace les sommets a la construction, la
// physique reste 2D, avec un petit facteur de pente arcade.
//
// Pas de three.js : ce module est lu par buildings.ts (index des murs) et par
// le rendu.

export type ElevPlace = {
  lon: number;
  lat: number;
  x: number;
  y: number;
  z: number;
  heading?: number;
};

export type ElevMeta = {
  lon0: number;
  lat0: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  zMin: number;
  zMax: number;
  q: number;
  eternite?: { bottom: ElevPlace; top: ElevPlace; len: number; rise: number; gradeMean: number; gradeMax: number };
};

type Grid = ElevMeta & { z: Uint16Array };

let grid: Grid | null = null;

export function elevReady(): boolean {
  return grid != null;
}

export function elevMeta(): ElevMeta | null {
  return grid;
}

export function eterniteSpawn(): ElevPlace | null {
  return grid?.eternite?.bottom ?? null;
}

function sampleRaw(ix: number, iy: number): number {
  if (!grid) return 0;
  const x = Math.max(0, Math.min(grid.nx - 1, ix));
  const y = Math.max(0, Math.min(grid.ny - 1, iy));
  return grid.z[y * grid.nx + x] * grid.q;
}

/** Altitude de jeu (0 = point le plus bas de la grille). */
export function zAt(x: number, y: number): number {
  if (!grid) return 0;
  const u = (x - grid.x0) / grid.dx;
  const v = (y - grid.y0) / grid.dy;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const tx = u - x0;
  const ty = v - y0;
  const z00 = sampleRaw(x0, y0);
  const z10 = sampleRaw(x0 + 1, y0);
  const z01 = sampleRaw(x0, y0 + 1);
  const z11 = sampleRaw(x0 + 1, y0 + 1);
  return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty;
}

/** Pente signee dans la direction (hx, hy) normalisee, en m/m. */
export function gradeAt(x: number, y: number, hx: number, hy: number, ahead = 6): number {
  const z0 = zAt(x, y);
  const z1 = zAt(x + hx * ahead, y + hy * ahead);
  return (z1 - z0) / ahead;
}

export function pitchAt(x: number, y: number, heading: number): number {
  return Math.atan(gradeAt(x, y, Math.cos(heading), Math.sin(heading)));
}

/** Ajoute un delta Y a partir de `start` (index dans le tampon plat). */
export function addY(pos: number[] | Float32Array, dy: number, start = 0): void {
  if (!dy) return;
  for (let i = start + 1; i < pos.length; i += 3) pos[i] += dy;
}

/** Ajoute z(x, -z_three) a chaque sommet Y. Rubans, sols, clotures. */
export function liftPositions(pos: number[] | Float32Array): void {
  if (!grid) return;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i + 1] += zAt(pos[i], -pos[i + 2]);
  }
}

type GeoLike = {
  getAttribute(name: string): { array: ArrayLike<number>; needsUpdate: boolean } | undefined;
  computeBoundingSphere(): void;
};

export function liftGeometry<T extends GeoLike>(g: T | null | undefined): T | null {
  if (!g || !grid) return g ?? null;
  const attr = g.getAttribute("position");
  if (!attr) return g;
  liftPositions(attr.array as Float32Array);
  attr.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/**
 * Un seul z, celui du centroide. C'est ce qui garde les murs d'aplomb et les
 * toits plats : draper sommet par sommet transforme chaque immeuble en coin
 * de savon.
 */
export function liftRigidGeometry<T extends GeoLike>(g: T | null | undefined): T | null {
  if (!g || !grid) return g ?? null;
  const attr = g.getAttribute("position");
  if (!attr) return g;
  const pos = attr.array as Float32Array;
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < pos.length; i += 3) {
    sx += pos[i];
    sz += pos[i + 2];
    n++;
  }
  if (!n) return g;
  addY(pos, zAt(sx / n, -sz / n));
  attr.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/**
 * Subdivise les grands triangles puis drape. Un parc earcute en 3 sommets sur
 * 80 m de pente coupe la colline ; a 12 m la corde reste sous la chaussee.
 */
export function drapeTriangles(src: ArrayLike<number>, maxEdge = 12): Float32Array {
  if (!grid) return src instanceof Float32Array ? src : Float32Array.from(src);
  const out: number[] = [];
  const max2 = maxEdge * maxEdge;

  const emit = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    out.push(ax, ay + zAt(ax, -az), az, bx, by + zAt(bx, -bz), bz, cx, cy + zAt(cx, -cz), cz);
  };

  const split = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    depth: number,
  ) => {
    const ab = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
    const bc = (cx - bx) * (cx - bx) + (cz - bz) * (cz - bz);
    const ca = (ax - cx) * (ax - cx) + (az - cz) * (az - cz);
    if (Math.max(ab, bc, ca) <= max2 || depth <= 0) {
      emit(ax, ay, az, bx, by, bz, cx, cy, cz);
      return;
    }
    const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
    const nx = (bx + cx) * 0.5, ny = (by + cy) * 0.5, nz = (bz + cz) * 0.5;
    const px = (cx + ax) * 0.5, py = (cy + ay) * 0.5, pz = (cz + az) * 0.5;
    split(ax, ay, az, mx, my, mz, px, py, pz, depth - 1);
    split(bx, by, bz, nx, ny, nz, mx, my, mz, depth - 1);
    split(cx, cy, cz, px, py, pz, nx, ny, nz, depth - 1);
    split(mx, my, mz, nx, ny, nz, px, py, pz, depth - 1);
  };

  for (let i = 0; i + 8 < src.length; i += 9) {
    split(
      src[i]!, src[i + 1]!, src[i + 2]!,
      src[i + 3]!, src[i + 4]!, src[i + 5]!,
      src[i + 6]!, src[i + 7]!, src[i + 8]!,
      7,
    );
  }
  return new Float32Array(out);
}

export async function loadElev(): Promise<boolean> {
  try {
    const metaRes = await fetch("/sainte-elev.json");
    if (!metaRes.ok) return false;
    const meta: ElevMeta = await metaRes.json();
    const binRes = await fetch("/sainte-elev.bin");
    if (!binRes.ok) return false;
    const buf = new Uint16Array(await binRes.arrayBuffer());
    if (buf.length !== meta.nx * meta.ny) {
      console.warn(`MNT: ${buf.length} echantillons, attendu ${meta.nx * meta.ny}`);
      return false;
    }
    grid = { ...meta, z: buf };
    console.log(
      `relief: IGN ${meta.nx}×${meta.ny} pas ${meta.dx} m, ` +
        `Δ ${(meta.zMax - meta.zMin).toFixed(0)} m` +
        (meta.eternite
          ? `, Eternite ${(meta.eternite.gradeMean * 100).toFixed(1)} % sur ${Math.round(meta.eternite.len)} m`
          : ""),
    );
    return true;
  } catch (err) {
    console.warn("MNT absent", err);
    return false;
  }
}
