// Geometrie des reperes : volumes parametriques poses sur l'emprise reelle.
//
// Un repere reste une emprise OSM (ou une position synthetique pour le stade),
// mais sa SILHOUETTE est reprisee a la main : tour-beffroi, fleche, chevalement,
// voute, cuvette de stade. Chaque kit est une liste de volumes definis dans le
// repere local du batiment (x = axe principal, y = travers, z = hauteur), puis
// transformes par l'ancre (position projetee + orientation).
//
// Les murs "facade" utilisent EXACTEMENT la meme texture que les batiments
// courants (UV en metres), pour qu'un pavillon d'hotel de ville lise avec la
// meme trame de fenetres que le centre. Les volumes pleins (toits, voutes,
// chevalement) et les elements lumineux (horloge, projecteurs, croix) vont dans
// des tampons separes. Voir src/lib/landmarks.ts pour les kits, et
// src/scene/Landmarks.tsx pour le rendu.

import * as THREE from "three";
import { TILE_V } from "./facades";
import type { Painted } from "./facadeTextures";
import { liftRigidGeometry } from "./elev";

export type Buf = { pos: number[]; norm: number[]; uv: number[]; col: number[] };
export const newBuf = (): Buf => ({ pos: [], norm: [], uv: [], col: [] });

/** Tampons d'un repere, separes par materiau. */
export type Emit = { walls: Buf; roofs: Buf; glow: Buf };
export const newEmit = (): Emit => ({ walls: newBuf(), roofs: newBuf(), glow: newBuf() });

// Le repere local d'une emprise vit dans son propre module, sans dependance :
// buildings.ts en a besoin sans tirer three.js ni les facades. Re-exporte ici
// pour que les kits n'aient qu'un seul point d'entree.
import type { Anchor } from "./frame";
export { frameOf } from "./frame";
export type { Anchor, Dims, Frame } from "./frame";

/** Teinte appliquee aux volumes. */
export type Tint = { r: number; g: number; b: number };

// --- transformation locale -> monde ----------------------------------------
// Le repere local a x le long de l'axe principal du batiment, y en travers. On
// le tourne de anchor.rot puis on le translate. three.js : (x, z, -y).

function toWorld(a: Anchor, lx: number, ly: number): [number, number] {
  const c = Math.cos(a.rot);
  const s = Math.sin(a.rot);
  return [a.x + lx * c - ly * s, a.y + lx * s + ly * c];
}

function rotDir(a: Anchor, nx: number, ny: number): [number, number] {
  const c = Math.cos(a.rot);
  const s = Math.sin(a.rot);
  return [nx * c - ny * s, nx * s + ny * c];
}

/** Pousse un quad (2 triangles) dans un tampon. 4 coins dans le sens trigo. */
function quad(
  b: Buf,
  p0: number[], p1: number[], p2: number[], p3: number[],
  n: number[],
  uv: [number, number][],
  col: Tint,
) {
  b.pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
  for (let i = 0; i < 6; i++) b.norm.push(...n);
  b.uv.push(...uv[0], ...uv[1], ...uv[2], ...uv[0], ...uv[2], ...uv[3]);
  for (let i = 0; i < 6; i++) b.col.push(col.r, col.g, col.b);
}

// --- primitives -------------------------------------------------------------

export type BoxOpts = {
  x: number; y: number; // centre local
  w: number; d: number; // largeur (axe x local), profondeur (axe y local)
  h: number;
  base?: number; // altitude du bas
  skin?: "facade" | "plain";
  tint: Tint;
  roofTint?: Tint; // defaut = tint
};

/** Boite : 4 murs + coiffe plate. Murs en facade (fenetres) ou pleins.
 *  `tex` n'est requis que si skin === "facade". */
export function addBox(e: Emit, a: Anchor, tex: Painted | null, o: BoxOpts) {
  const base = o.base ?? 0;
  const top = base + o.h;
  const hw = o.w / 2;
  const hd = o.d / 2;
  const plain = o.skin === "plain";
  const buf = plain ? e.roofs : e.walls;
  const roofTint = o.roofTint ?? o.tint;

  // coins locaux du rectangle, sens trigo vu de dessus
  const cs: [number, number][] = [
    [o.x - hw, o.y - hd],
    [o.x + hw, o.y - hd],
    [o.x + hw, o.y + hd],
    [o.x - hw, o.y + hd],
  ];
  // aretes : (i, j), normale locale exterieure
  const edges: [number, number, number, number][] = [
    [0, 1, 0, -1],
    [1, 2, 1, 0],
    [2, 3, 0, 1],
    [3, 0, -1, 0],
  ];

  for (const [i, j, lnx, lny] of edges) {
    const [ax, ay] = cs[i];
    const [bx, by] = cs[j];
    const [wax, way] = toWorld(a, ax, ay);
    const [wbx, wby] = toWorld(a, bx, by);
    const [wnx, wny] = rotDir(a, lnx, lny);
    const n = [wnx, 0, -wny];
    const len = Math.hypot(bx - ax, by - ay);

    let uv: [number, number][];
    if (plain || !tex) {
      uv = [[0, 0], [0, 0], [0, 0], [0, 0]];
    } else {
      const u1 = len / tex.tileU;
      const v1 = top / TILE_V;
      const v0 = base / TILE_V;
      uv = [[0, v0], [u1, v0], [u1, v1], [0, v1]];
    }
    quad(
      buf,
      [wax, base, -way], [wbx, base, -wby], [wbx, top, -wby], [wax, top, -way],
      n, uv, o.tint,
    );
  }

  // coiffe plate
  const c0 = toWorld(a, cs[0][0], cs[0][1]);
  const c1 = toWorld(a, cs[1][0], cs[1][1]);
  const c2 = toWorld(a, cs[2][0], cs[2][1]);
  const c3 = toWorld(a, cs[3][0], cs[3][1]);
  const uv0: [number, number] = [0, 0];
  quad(
    e.roofs,
    [c0[0], top, -c0[1]], [c1[0], top, -c1[1]], [c2[0], top, -c2[1]], [c3[0], top, -c3[1]],
    [0, 1, 0], [uv0, uv0, uv0, uv0], roofTint,
  );
}

export type GableOpts = {
  x: number; y: number;
  w: number; d: number; // w le long de l'axe (faite), d = portee des pentes
  wallH: number; // hauteur des murs gouttereaux
  ridgeH: number; // hauteur totale au faite (>= wallH)
  base?: number;
  tint: Tint;
  wallSkin?: "facade" | "plain";
};

/** Boite a pignons : murs + deux rampants, pignons triangulaires. */
export function addGable(e: Emit, a: Anchor, tex: Painted | null, o: GableOpts) {
  const base = o.base ?? 0;
  const wallTop = base + o.wallH;
  const ridge = base + o.ridgeH;
  const hw = o.w / 2;
  const hd = o.d / 2;
  const plainWalls = o.wallSkin === "plain";
  const wallBuf = plainWalls ? e.roofs : e.walls;

  // 4 coins de base + 2 points de faite (aux deux bouts de l'axe)
  const b0 = toWorld(a, o.x - hw, o.y - hd);
  const b1 = toWorld(a, o.x + hw, o.y - hd);
  const b2 = toWorld(a, o.x + hw, o.y + hd);
  const b3 = toWorld(a, o.x - hw, o.y + hd);
  const r0 = toWorld(a, o.x - hw, o.y);
  const r1 = toWorld(a, o.x + hw, o.y);

  const B0 = [b0[0], base, -b0[1]], B1 = [b1[0], base, -b1[1]], B2 = [b2[0], base, -b2[1]], B3 = [b3[0], base, -b3[1]];
  const T0 = [b0[0], wallTop, -b0[1]], T1 = [b1[0], wallTop, -b1[1]], T2 = [b2[0], wallTop, -b2[1]], T3 = [b3[0], wallTop, -b3[1]];
  const R0 = [r0[0], ridge, -r0[1]], R1 = [r1[0], ridge, -r1[1]];

  // deux murs gouttereaux (faces longues, normales +/- y local)
  const gableUV: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  // mur -y : b0->b1
  {
    const [nx, ny] = rotDir(a, 0, -1);
    const len = o.w;
    const uv: [number, number][] = plainWalls || !tex
      ? gableUV
      : [[0, base / TILE_V], [len / tex.tileU, base / TILE_V], [len / tex.tileU, wallTop / TILE_V], [0, wallTop / TILE_V]];
    quad(wallBuf, B0, B1, T1, T0, [nx, 0, -ny], uv, o.tint);
  }
  // mur +y : b2->b3
  {
    const [nx, ny] = rotDir(a, 0, 1);
    const len = o.w;
    const uv: [number, number][] = plainWalls || !tex
      ? gableUV
      : [[0, base / TILE_V], [len / tex.tileU, base / TILE_V], [len / tex.tileU, wallTop / TILE_V], [0, wallTop / TILE_V]];
    quad(wallBuf, B2, B3, T3, T2, [nx, 0, -ny], uv, o.tint);
  }

  // rampants (toiture) : faces inclinees le long de l'axe
  // pentes : normale calculee du profil
  const run = hd; // demi-portee horizontale
  const rise = ridge - wallTop;
  const nl = Math.hypot(run, rise) || 1;
  {
    // rampant -y
    const [dx, dy] = rotDir(a, 0, -1);
    const n = [dx * (rise / nl), rise === 0 ? 0 : run / nl, -dy * (rise / nl)];
    // correction : normale = composante horizontale (vers -y) + composante verticale
    const [hnx, hny] = rotDir(a, 0, -1);
    const nn = [hnx * (rise / nl), run / nl, -hny * (rise / nl)];
    void n;
    quad(e.roofs, T0, T1, R1, R0, nn, [gableUV[0], gableUV[0], gableUV[0], gableUV[0]], o.tint);
  }
  {
    const [hnx, hny] = rotDir(a, 0, 1);
    const nn = [hnx * (rise / nl), run / nl, -hny * (rise / nl)];
    quad(e.roofs, T2, T3, R0, R1, nn, [gableUV[0], gableUV[0], gableUV[0], gableUV[0]], o.tint);
  }

  // deux pignons triangulaires (bouts)
  {
    const [nx, ny] = rotDir(a, -1, 0);
    const tri = (A: number[], B: number[], C: number[]) => {
      e.roofs.pos.push(...A, ...B, ...C);
      for (let i = 0; i < 3; i++) e.roofs.norm.push(nx, 0, -ny);
      e.roofs.uv.push(0, 0, 0, 0, 0, 0);
      for (let i = 0; i < 3; i++) e.roofs.col.push(o.tint.r, o.tint.g, o.tint.b);
    };
    tri(T0, R0, T3);
  }
  {
    const [nx, ny] = rotDir(a, 1, 0);
    const tri = (A: number[], B: number[], C: number[]) => {
      e.roofs.pos.push(...A, ...B, ...C);
      for (let i = 0; i < 3; i++) e.roofs.norm.push(nx, 0, -ny);
      e.roofs.uv.push(0, 0, 0, 0, 0, 0);
      for (let i = 0; i < 3; i++) e.roofs.col.push(o.tint.r, o.tint.g, o.tint.b);
    };
    tri(T1, T2, R1);
  }
}

export type CylOpts = {
  x: number; y: number;
  r: number; // rayon bas
  rTop?: number; // rayon haut (0 = cone)
  h: number;
  base?: number;
  segments?: number;
  tint: Tint;
  cap?: boolean;
};

/** Cylindre ou cone, plein (tour, fleche, campanile). */
export function addCylinder(e: Emit, a: Anchor, o: CylOpts) {
  const base = o.base ?? 0;
  const top = base + o.h;
  const rT = o.rTop ?? o.r;
  const seg = o.segments ?? 12;

  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2;
    const t1 = ((i + 1) / seg) * Math.PI * 2;
    const bm0 = toWorld(a, o.x + Math.cos(t0) * o.r, o.y + Math.sin(t0) * o.r);
    const bm1 = toWorld(a, o.x + Math.cos(t1) * o.r, o.y + Math.sin(t1) * o.r);
    const tp0 = toWorld(a, o.x + Math.cos(t0) * rT, o.y + Math.sin(t0) * rT);
    const tp1 = toWorld(a, o.x + Math.cos(t1) * rT, o.y + Math.sin(t1) * rT);

    // normale ~ radiale (approx correcte pour cylindre; ok pour cone)
    const midT = (t0 + t1) / 2;
    const [nx, ny] = rotDir(a, Math.cos(midT), Math.sin(midT));
    const slant = Math.hypot(o.r - rT, o.h) || 1;
    const n = [nx * (o.h / slant), (o.r - rT) / slant, -ny * (o.h / slant)];

    if (rT < 0.01) {
      // cone : un triangle
      e.roofs.pos.push(bm0[0], base, -bm0[1], bm1[0], base, -bm1[1], tp0[0], top, -tp0[1]);
      for (let k = 0; k < 3; k++) e.roofs.norm.push(...n);
      e.roofs.uv.push(0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 3; k++) e.roofs.col.push(o.tint.r, o.tint.g, o.tint.b);
    } else {
      quad(
        e.roofs,
        [bm0[0], base, -bm0[1]], [bm1[0], base, -bm1[1]], [tp1[0], top, -tp1[1]], [tp0[0], top, -tp0[1]],
        n, [[0, 0], [0, 0], [0, 0], [0, 0]], o.tint,
      );
    }
  }

  if (o.cap !== false && rT > 0.01) {
    // disque superieur
    const c = toWorld(a, o.x, o.y);
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2;
      const t1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = toWorld(a, o.x + Math.cos(t0) * rT, o.y + Math.sin(t0) * rT);
      const p1 = toWorld(a, o.x + Math.cos(t1) * rT, o.y + Math.sin(t1) * rT);
      e.roofs.pos.push(c[0], top, -c[1], p0[0], top, -p0[1], p1[0], top, -p1[1]);
      for (let k = 0; k < 3; k++) e.roofs.norm.push(0, 1, 0);
      e.roofs.uv.push(0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 3; k++) e.roofs.col.push(o.tint.r, o.tint.g, o.tint.b);
    }
  }
}

export type DomeOpts = {
  x: number; y: number; r: number; base?: number; tint: Tint; bands?: number;
};

/** Demi-sphere (campanile, petit dome). */
export function addDome(e: Emit, a: Anchor, o: DomeOpts) {
  const base = o.base ?? 0;
  const seg = 14;
  const bands = o.bands ?? 6;
  for (let b = 0; b < bands; b++) {
    const p0 = (b / bands) * (Math.PI / 2);
    const p1 = ((b + 1) / bands) * (Math.PI / 2);
    const r0 = Math.cos(p0) * o.r, y0 = Math.sin(p0) * o.r;
    const r1 = Math.cos(p1) * o.r, y1 = Math.sin(p1) * o.r;
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2;
      const t1 = ((i + 1) / seg) * Math.PI * 2;
      const q00 = toWorld(a, o.x + Math.cos(t0) * r0, o.y + Math.sin(t0) * r0);
      const q01 = toWorld(a, o.x + Math.cos(t1) * r0, o.y + Math.sin(t1) * r0);
      const q10 = toWorld(a, o.x + Math.cos(t0) * r1, o.y + Math.sin(t0) * r1);
      const q11 = toWorld(a, o.x + Math.cos(t1) * r1, o.y + Math.sin(t1) * r1);
      const midT = (t0 + t1) / 2;
      const midP = (p0 + p1) / 2;
      const [nx, ny] = rotDir(a, Math.cos(midT) * Math.cos(midP), Math.sin(midT) * Math.cos(midP));
      const n = [nx, Math.sin(midP), -ny];
      quad(
        e.roofs,
        [q00[0], base + y0, -q00[1]], [q01[0], base + y0, -q01[1]],
        [q11[0], base + y1, -q11[1]], [q10[0], base + y1, -q10[1]],
        n, [[0, 0], [0, 0], [0, 0], [0, 0]], o.tint,
      );
    }
  }
}

export type DiscOpts = {
  x: number; y: number; z: number; r: number;
  facing?: "x+" | "x-" | "y+" | "y-" | "up";
  color: [number, number, number];
};

/** Disque lumineux (cadran d'horloge, molette). */
export function addDisc(e: Emit, a: Anchor, o: DiscOpts) {
  const seg = 20;
  const c = toWorld(a, o.x, o.y);
  const facing = o.facing ?? "up";
  let n: number[];
  let plane: (t: number, rr: number) => number[];
  if (facing === "up") {
    n = [0, 1, 0];
    plane = (t, rr) => {
      const p = toWorld(a, o.x + Math.cos(t) * rr, o.y + Math.sin(t) * rr);
      return [p[0], o.z, -p[1]];
    };
  } else {
    const dir = facing === "x+" ? [1, 0] : facing === "x-" ? [-1, 0] : facing === "y+" ? [0, 1] : [0, -1];
    const [wnx, wny] = rotDir(a, dir[0], dir[1]);
    n = [wnx, 0, -wny];
    // plan vertical : deux vecteurs dans le plan = verticale + tangent
    const tangent = rotDir(a, -dir[1], dir[0]);
    plane = (t, rr) => {
      const cx = c[0] + tangent[0] * Math.cos(t) * rr;
      const cy = c[1] + tangent[1] * Math.cos(t) * rr;
      const zz = o.z + Math.sin(t) * rr;
      return [cx + wnx * 0.05, zz, -(cy + wny * 0.05)];
    };
  }
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2;
    const t1 = ((i + 1) / seg) * Math.PI * 2;
    e.glow.pos.push(...plane(0, 0), ...plane(t0, o.r), ...plane(t1, o.r));
    for (let k = 0; k < 3; k++) e.glow.norm.push(...n);
    e.glow.uv.push(0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 3; k++) e.glow.col.push(...o.color);
  }
}

export type BoxGlowOpts = { x: number; y: number; w: number; d: number; h: number; base?: number; color: [number, number, number] };

/** Boite pleinement lumineuse (bandeau de projecteurs). */
export function addGlowBox(e: Emit, a: Anchor, o: BoxGlowOpts) {
  const base = o.base ?? 0;
  const top = base + o.h;
  const hw = o.w / 2, hd = o.d / 2;
  const cs: [number, number][] = [
    [o.x - hw, o.y - hd], [o.x + hw, o.y - hd], [o.x + hw, o.y + hd], [o.x - hw, o.y + hd],
  ];
  const edges: [number, number, number, number][] = [
    [0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0],
  ];
  for (const [i, j, lnx, lny] of edges) {
    const [ax, ay] = cs[i];
    const [bx, by] = cs[j];
    const wa = toWorld(a, ax, ay);
    const wb = toWorld(a, bx, by);
    const [nx, ny] = rotDir(a, lnx, lny);
    quad(
      e.glow,
      [wa[0], base, -wa[1]], [wb[0], base, -wb[1]], [wb[0], top, -wb[1]], [wa[0], top, -wa[1]],
      [nx, 0, -ny], [[0, 0], [0, 0], [0, 0], [0, 0]],
      { r: o.color[0], g: o.color[1], b: o.color[2] },
    );
  }
  // dessus
  const c0 = toWorld(a, cs[0][0], cs[0][1]);
  const c1 = toWorld(a, cs[1][0], cs[1][1]);
  const c2 = toWorld(a, cs[2][0], cs[2][1]);
  const c3 = toWorld(a, cs[3][0], cs[3][1]);
  quad(
    e.glow,
    [c0[0], top, -c0[1]], [c1[0], top, -c1[1]], [c2[0], top, -c2[1]], [c3[0], top, -c3[1]],
    [0, 1, 0], [[0, 0], [0, 0], [0, 0], [0, 0]],
    { r: o.color[0], g: o.color[1], b: o.color[2] },
  );
}

export type VaultOpts = {
  x: number; y: number;
  w: number; // longueur le long de l'axe local x
  d: number; // portee transversale
  h: number; // fleche (montee)
  base?: number;
  tint: Tint;
  seg?: number;
};

/** Voute en berceau (demi-ellipse extrudee le long de l'axe) : toiture du Zenith. */
export function addVault(e: Emit, a: Anchor, o: VaultOpts) {
  const base = o.base ?? 0;
  const seg = o.seg ?? 14;
  const hw = o.w / 2;
  const uv0: [number, number] = [0, 0];

  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI;
    const t1 = ((i + 1) / seg) * Math.PI;
    const y0 = Math.cos(t0) * (o.d / 2), z0 = Math.sin(t0) * o.h;
    const y1 = Math.cos(t1) * (o.d / 2), z1 = Math.sin(t1) * o.h;
    const p00 = toWorld(a, o.x - hw, o.y + y0);
    const p10 = toWorld(a, o.x + hw, o.y + y0);
    const p11 = toWorld(a, o.x + hw, o.y + y1);
    const p01 = toWorld(a, o.x - hw, o.y + y1);

    const midT = (t0 + t1) / 2;
    const horiz = Math.abs(Math.cos(midT));
    const vert = Math.sin(midT);
    const nlen = Math.hypot(horiz, vert) || 1;
    const [hnx, hny] = rotDir(a, 0, Math.cos(midT) >= 0 ? 1 : -1);
    const n = [hnx * (horiz / nlen), vert / nlen, -hny * (horiz / nlen)];

    quad(
      e.roofs,
      [p00[0], base + z0, -p00[1]], [p10[0], base + z0, -p10[1]],
      [p11[0], base + z1, -p11[1]], [p01[0], base + z1, -p01[1]],
      n, [uv0, uv0, uv0, uv0], o.tint,
    );
  }

  // deux demi-disques de pignon aux extremites
  for (const sx of [-1, 1]) {
    const cx = o.x + sx * hw;
    const c = toWorld(a, cx, o.y);
    const [nx, ny] = rotDir(a, sx, 0);
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI;
      const t1 = ((i + 1) / seg) * Math.PI;
      const p0 = toWorld(a, cx, o.y + Math.cos(t0) * (o.d / 2));
      const p1 = toWorld(a, cx, o.y + Math.cos(t1) * (o.d / 2));
      e.roofs.pos.push(
        c[0], base, -c[1],
        p0[0], base + Math.sin(t0) * o.h, -p0[1],
        p1[0], base + Math.sin(t1) * o.h, -p1[1],
      );
      for (let k = 0; k < 3; k++) e.roofs.norm.push(nx, 0, -ny);
      e.roofs.uv.push(0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 3; k++) e.roofs.col.push(o.tint.r, o.tint.g, o.tint.b);
    }
  }
}

export type CrossOpts = { x: number; y: number; z: number; h: number; color: [number, number, number] };

/** Croix lumineuse (cathedrale). */
export function addCross(e: Emit, a: Anchor, o: CrossOpts) {
  const th = Math.max(0.35, o.h * 0.12);
  addGlowBox(e, a, { x: o.x, y: o.y, w: th, d: th, h: o.h, base: o.z, color: o.color });
  addGlowBox(e, a, {
    x: o.x, y: o.y, w: o.h * 0.55, d: th, h: th, base: o.z + o.h * 0.62, color: o.color,
  });
}

export type ArchGlowOpts = {
  x: number; // centre de l'arche (repere local)
  y: number;
  base: number; // altitude du bas de l'ouverture
  w: number; // largeur
  hRect: number; // hauteur droite sous le plein cintre
  color: [number, number, number];
  /** Axe perpendiculaire a la facade ("y" = facade face au parvis). Defaut "y". */
  axis?: "x" | "y";
  /** Sens de la normale exterieure le long de l'axe. Defaut -1. */
  sign?: -1 | 1;
  offset?: number; // decalage hors du mur (z-fighting)
};

/** Ouverture voutee lumineuse (rectangle + plein cintre) sur un mur de facade. */
export function addArchGlow(e: Emit, a: Anchor, o: ArchGlowOpts) {
  const axis = o.axis ?? "y";
  const sign = o.sign ?? -1;
  const off = o.offset ?? 0.35;
  const r = o.w / 2;
  const zSpr = o.base + o.hRect; // naissance du cintre

  // contour de l'ouverture (coordonnee horizontale, z), rectangle + demi-cercle
  const prof: [number, number][] = [];
  prof.push([-r, o.base]);
  prof.push([-r, zSpr]);
  const seg = 10;
  for (let i = 0; i <= seg; i++) {
    const t = Math.PI - (i / seg) * Math.PI; // de gauche a droite
    prof.push([Math.cos(t) * r, zSpr + Math.sin(t) * r]);
  }
  prof.push([r, zSpr]);
  prof.push([r, o.base]);

  // position du plan le long de l'axe, poussee vers l'exterieur
  const plane = (axis === "y" ? o.y : o.x) + sign * off;
  const toPt = (h: number, z: number): number[] => {
    const w = axis === "y" ? toWorld(a, o.x + h, plane) : toWorld(a, plane, o.y + h);
    return [w[0], z, -w[1]];
  };
  const [nx, ny] = axis === "y" ? rotDir(a, 0, sign) : rotDir(a, sign, 0);
  const n = [nx, 0, -ny];

  // eventail depuis le centre bas de l'ouverture
  const fc = toPt(0, o.base);
  for (let i = 0; i < prof.length - 1; i++) {
    const p0 = toPt(prof[i][0], prof[i][1]);
    const p1 = toPt(prof[i + 1][0], prof[i + 1][1]);
    e.glow.pos.push(fc[0], fc[1], fc[2], p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
    for (let k = 0; k < 3; k++) e.glow.norm.push(...n);
    e.glow.uv.push(0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 3; k++) e.glow.col.push(...o.color);
  }
}

export type StairsOpts = {
  x: number; // centre le long de la facade
  yFacade: number; // y local de la facade (haut du perron)
  w: number; // largeur du perron
  depth: number; // saillie totale vers le parvis (local -y)
  height: number; // monte totale
  steps: number;
  tint: Tint;
};

/** Perron monumental : empilement de marches pleines, plus larges en bas. */
export function addStairs(e: Emit, a: Anchor, o: StairsOpts) {
  const stepH = o.height / o.steps;
  const stepD = o.depth / o.steps;
  for (let i = 0; i < o.steps; i++) {
    const base = i * stepH;
    const outerY = o.yFacade - o.depth + i * stepD; // bord exterieur de la marche i
    const d = o.yFacade - outerY;
    addBox(e, a, null, {
      x: o.x,
      y: outerY + d / 2,
      w: o.w,
      d,
      h: o.height - base,
      base,
      skin: "plain",
      tint: o.tint,
      roofTint: o.tint,
    });
  }
}

export type HippedOpts = {
  x: number; y: number;
  w: number; // longueur, le long de l'axe x local
  d: number; // portee transversale
  rise: number; // hauteur du faite au-dessus de la base
  base: number;
  tint: Tint;
  /** Debord de toiture, en metres. */
  eaves?: number;
};

/**
 * Toiture a croupes : deux longs pans trapezoidaux et deux croupes
 * triangulaires. C'est la couverture des batiments industriels stephanois et de
 * bon nombre d'emprises taguees roof:shape=hipped, que le rendu courant ne sait
 * pas distinguer d'un toit a deux pentes.
 *
 * Le faite est raccourci de la demi-portee a chaque bout, ce qui donne des
 * croupes a 45 degres en plan, la regle courante.
 */
export function addHipped(e: Emit, a: Anchor, o: HippedOpts) {
  const eaves = o.eaves ?? 0.4;
  const hw = o.w / 2 + eaves;
  const hd = o.d / 2 + eaves;
  const ridgeHalf = Math.max(0.5, hw - hd); // croupes a 45 degres
  const z0 = o.base;
  const z1 = o.base + o.rise;
  const uv0: [number, number] = [0, 0];
  const uvs: [number, number][] = [uv0, uv0, uv0, uv0];

  const P = (lx: number, ly: number, z: number) => {
    const w = toWorld(a, o.x + lx, o.y + ly);
    return [w[0], z, -w[1]];
  };
  const A = P(-hw, -hd, z0), B = P(hw, -hd, z0), C = P(hw, hd, z0), D = P(-hw, hd, z0);
  const R0 = P(-ridgeHalf, 0, z1), R1 = P(ridgeHalf, 0, z1);

  const slant = Math.hypot(hd, o.rise) || 1;
  for (const sy of [-1, 1] as const) {
    const [nx, ny] = rotDir(a, 0, sy);
    const n = [nx * (o.rise / slant), hd / slant, -ny * (o.rise / slant)];
    if (sy < 0) quad(e.roofs, A, B, R1, R0, n, uvs, o.tint);
    else quad(e.roofs, C, D, R0, R1, n, uvs, o.tint);
  }
  const slantX = Math.hypot(hw - ridgeHalf, o.rise) || 1;
  for (const sx of [-1, 1] as const) {
    const [nx, ny] = rotDir(a, sx, 0);
    const n = [nx * (o.rise / slantX), (hw - ridgeHalf) / slantX, -ny * (o.rise / slantX)];
    const tri = (p0: number[], p1: number[], p2: number[]) => {
      e.roofs.pos.push(...p0, ...p1, ...p2);
      for (let k = 0; k < 3; k++) e.roofs.norm.push(...n);
      e.roofs.uv.push(0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 3; k++) e.roofs.col.push(o.tint.r, o.tint.g, o.tint.b);
    };
    if (sx < 0) tri(D, A, R0);
    else tri(B, C, R1);
  }
}

export type SawtoothOpts = {
  x: number; y: number;
  w: number; // longueur sur laquelle les travees se repetent (axe x local)
  d: number; // portee transversale d'un shed
  base: number; // altitude de l'egout
  rise: number; // hauteur de la verriere verticale
  bays: number;
  tint: Tint;
  glass: [number, number, number];
  /**
   * Ou envoyer les verrieres. Par defaut le tampon lumineux ; au loin il est
   * abandonne, et une verriere manquante laisserait la toiture ajouree, donc
   * on les bascule en volume plein.
   */
  glassTo?: "glow" | "roofs";
};

/**
 * Toiture en sheds : la couverture des halles manufacturieres stephanoises.
 * Chaque travee est un rampant qui descend de `rise` puis une verriere
 * verticale qui remonte, orientee au nord dans la realite. Ici la verriere
 * regarde toujours le -x local : l'orientation vraie demanderait de tourner le
 * repere par batiment, et de nuit c'est la trame de bandes lumineuses qui
 * porte la lecture, pas son azimut.
 */
export function addSawtooth(e: Emit, a: Anchor, o: SawtoothOpts) {
  const bw = o.w / o.bays;
  const hd = o.d / 2;
  const uv0: [number, number] = [0, 0];
  const uvs: [number, number][] = [uv0, uv0, uv0, uv0];

  // normale du rampant : descend vers +x
  const slant = Math.hypot(o.rise, bw) || 1;
  const [rx, ry] = rotDir(a, 1, 0);
  const nSlope = [rx * (o.rise / slant), bw / slant, -ry * (o.rise / slant)];
  const [gx, gy] = rotDir(a, -1, 0);
  const nGlass = [gx, 0, -gy];

  for (let i = 0; i < o.bays; i++) {
    const x0 = o.x - o.w / 2 + i * bw;
    const x1 = x0 + bw;
    const top = o.base + o.rise;

    const a0 = toWorld(a, x0, o.y - hd);
    const a1 = toWorld(a, x1, o.y - hd);
    const b1 = toWorld(a, x1, o.y + hd);
    const b0 = toWorld(a, x0, o.y + hd);

    // rampant : haut en x0, bas en x1
    quad(
      e.roofs,
      [a0[0], top, -a0[1]], [a1[0], o.base, -a1[1]],
      [b1[0], o.base, -b1[1]], [b0[0], top, -b0[1]],
      nSlope, uvs, o.tint,
    );

    // verriere verticale au nu de la travee
    quad(
      o.glassTo === "roofs" ? e.roofs : e.glow,
      [a0[0], o.base, -a0[1]], [a0[0], top, -a0[1]],
      [b0[0], top, -b0[1]], [b0[0], o.base, -b0[1]],
      nGlass, uvs,
      { r: o.glass[0], g: o.glass[1], b: o.glass[2] },
    );

    // deux triangles de rive pour fermer le profil en dents de scie
    for (const sy of [-1, 1] as const) {
      const [nx, ny] = rotDir(a, 0, sy);
      const p0 = toWorld(a, x0, o.y + sy * hd);
      const p1 = toWorld(a, x1, o.y + sy * hd);
      e.roofs.pos.push(
        p0[0], o.base, -p0[1],
        p0[0], top, -p0[1],
        p1[0], o.base, -p1[1],
      );
      for (let k = 0; k < 3; k++) e.roofs.norm.push(nx, 0, -ny);
      e.roofs.uv.push(0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 3; k++) e.roofs.col.push(o.tint.r, o.tint.g, o.tint.b);
    }
  }
}

/** Construit une BufferGeometry a partir d'un tampon (avec ou sans UV). */
export function toGeometry(b: Buf, withUv: boolean): THREE.BufferGeometry | null {
  if (!b.pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
  if (withUv) g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  liftRigidGeometry(g);
  return g;
}
