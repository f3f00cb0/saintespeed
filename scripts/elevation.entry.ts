// Rendu d'elevation : la partie qui a besoin des modules du jeu (TypeScript).
// Le lanceur est scripts/elevation.mjs, qui la compile a la volee.
//
// Vue orthographique de face, prise depuis le parvis (-y local du repere), donc
// exactement le point de vue des photos de reference/photos. Pas de three.js,
// pas de GPU : un tampon de pixels, un rasteriseur de triangles et l'algorithme
// du peintre. C'est volontaire, c'est ce qui permet de regarder un kit depuis un
// terminal, sans navigateur ni fenetre au premier plan.

import { readFileSync, writeFileSync } from "node:fs";
import { encode } from "jpeg-js";
import { makeProjector } from "../src/lib/project";
import { prepareBuildings, CITY_CENTRE, type Building } from "../src/lib/buildings";
import { frameOf } from "../src/lib/frame";
import { newEmit, type Buf } from "../src/lib/landmarkGeometry";
import { LANDMARK_KITS, SYNTHETIC_LANDMARKS } from "../src/lib/landmarks";
import { kitForPointKind } from "../src/lib/monuments";
import { POINT_KIND_NAMES } from "../src/lib/monumentPoints";
import { LANDMARKS } from "../src/lib/archetypes";

const W = 1280;
const HPX = 720;

const hexTint = (h: number) => ({
  r: ((h >> 16) & 255) / 255,
  g: ((h >> 8) & 255) / 255,
  b: (h & 255) / 255,
});

/** Les reperes qui ont un kit bespoke, pour `npm run elevation -- --list`. */
export function list(): { id: string; label: string }[] {
  return [
    ...[...LANDMARK_KITS.keys()].map((id) => ({ id: String(id), label: LANDMARKS.get(id)?.label ?? "?" })),
    ...SYNTHETIC_LANDMARKS.map((s) => ({ id: s.key, label: `${s.key} (sans emprise)` })),
    ...POINT_KIND_NAMES.map((n) => ({ id: `type:${n}`, label: `typologie ${n}` })),
  ];
}

/**
 * Elevation d'une TYPOLOGIE seule (type:croix, type:guerre...). Ces objets sont
 * poses par dizaines et fusionnes au rendu : les regarder un par un est le seul
 * moyen de verifier leur silhouette.
 */
export function renderKind(name: string, outPath: string): string {
  const kind = POINT_KIND_NAMES.indexOf(name);
  if (kind < 0) throw new Error(`typologie inconnue : ${name} (attendu ${POINT_KIND_NAMES.join(", ")})`);
  const kit = kitForPointKind(kind, 1);
  if (!kit) throw new Error(`pas de kit pour ${name}`);
  const f = { x: 0, y: 0, rot: 0, w: 0, d: 0, area: 0, height: 0, minx: 0, maxx: 0, miny: 0, maxy: 0 };
  const e = newEmit();
  kit(e, f, {} as any, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, f);
  return rasterize({ kit: e, base: newEmit(), f, view: 0, outPath, label: `typologie ${name}`, hull: null });
}

/**
 * Elevation d'un repere SANS emprise : kiosque, bassin, sculpture, stade. Il n'y
 * a pas de contour a extruder ni d'orientation a lire, seulement le kit. Le
 * cadrage se prend donc sur la geometrie produite.
 */
export function renderSynthetic(key: string, outPath: string): string {
  const syn = SYNTHETIC_LANDMARKS.find((s) => s.key === key);
  if (!syn) throw new Error(`repere synthetique inconnu : ${key}`);
  const f = { x: 0, y: 0, rot: syn.rot, w: 0, d: 0, area: 0, height: 0, minx: 0, maxx: 0, miny: 0, maxy: 0 };
  const e = newEmit();
  syn.build(e, f, { tileU: 18.6, patch: [0.5, 0.5] } as any, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, f);
  return rasterize({ kit: e, base: newEmit(), f, view: syn.rot, outPath, label: key, hull: null });
}

/**
 * Depuis quelle facade on regarde. Les kits ne posent pas tous leur facade
 * principale du meme cote : elle est mesuree emprise par emprise (voir
 * src/lib/landmarks.ts), donc le point de vue se choisit.
 */
export type Side = "y-" | "y+" | "x-" | "x+";
const EXTRA: Record<Side, number> = {
  "y-": 0,
  "y+": Math.PI,
  "x-": Math.PI / 2,
  "x+": -Math.PI / 2,
};

export function render(id: number, cachePath: string, outPath: string, side: Side = "y-"): string {
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  const raw: Building[] = cache.buildings.map((b: any) => ({
    id: b.i, ring: b.g, levels: b.l, height: b.h, kind: b.k, material: b.m,
    colour: b.c, roofShape: b.rs, name: b.n, zone: b.z, shop: b.s,
  }));
  const flat = prepareBuildings(raw, makeProjector(CITY_CENTRE.lon, CITY_CENTRE.lat));
  const b = flat.find((x) => x.id === id);
  if (!b) throw new Error(`emprise ${id} absente du cache`);
  const lm = LANDMARKS.get(id);
  const kit = LANDMARK_KITS.get(id);
  if (!lm || !kit) throw new Error(`${id} n'a pas de kit bespoke`);

  const f = frameOf(b.ring, b.height, lm.rot);
  const view = f.rot + EXTRA[side];
  const tint = hexTint(lm.wall ?? 0xcccccc);
  const roofTint = hexTint(lm.roof ?? 0x555555);

  const e = newEmit();
  // Les kits ne lisent de la texture que sa largeur de tuile : hors navigateur
  // on passe donc un substitut, il n'y a pas de canvas a peindre ici.
  kit(e, f, { tileU: 18.6, patch: [0.5, 0.5] } as any, tint, roofTint, f);

  // L'extrusion de l'emprise, que le kit ne dessine pas mais qui porte tout.
  // Positions en coordonnees MONDE, comme celles des kits. Un repere en
  // replaceBase n'en a pas : le jeu ne dessine que son kit, la montrer ici
  // ferait croire a un volume qui n'existe pas.
  const base = newEmit();
  if (!lm.replaceBase) {
    const n = b.ring.length;
    for (let i = 0; i < n; i++) {
      const p = b.ring[i];
      const q = b.ring[(i + 1) % n];
      const tri = (
        x1: number, z1: number, y1: number,
        x2: number, z2: number, y2: number,
        x3: number, z3: number, y3: number,
      ) => {
        base.walls.pos.push(x1, z1, -y1, x2, z2, -y2, x3, z3, -y3);
        for (let k = 0; k < 3; k++) {
          base.walls.norm.push(0, 0, -1);
          base.walls.col.push(tint.r * 0.86, tint.g * 0.86, tint.b * 0.86);
        }
      };
      tri(p.x, 0, p.y, q.x, 0, q.y, q.x, b.height, q.y);
      tri(p.x, 0, p.y, q.x, b.height, q.y, p.x, b.height, p.y);
    }
  }

  return rasterize({ kit: e, base, f, view, outPath, label: lm.label ?? String(id), hull: b.ring });
}

type RasterArgs = {
  kit: ReturnType<typeof newEmit>;
  base: ReturnType<typeof newEmit>;
  f: { x: number; y: number; rot: number; w: number; d: number; height: number };
  view: number;
  outPath: string;
  label: string;
  /** Contour, quand il y en a un : il donne le cadrage. Sinon on cadre sur la
   *  geometrie produite, ce qui est le cas des objets sans emprise. */
  hull: { x: number; y: number }[] | null;
};

function rasterize({ kit: e, base, f, view, outPath, label, hull }: RasterArgs): string {
  // --- rasterisation --------------------------------------------------------
  type Tri = { x: number[]; y: number[]; depth: number; col: [number, number, number]; shade: number };
  const tris: Tri[] = [];
  // Etendue horizontale vue depuis ce cote : sur le contour quand il existe,
  // sinon sur la geometrie elle-meme (objets sans emprise : kiosque, bassin,
  // sculpture, stade).
  const cv = Math.cos(view), sv = Math.sin(view);
  let vmin = Infinity, vmax = -Infinity;
  const seen = hull
    ? hull.map((p) => ({ x: p.x, y: p.y }))
    : [e.walls, e.roofs, e.glow].flatMap((buf) => {
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < buf.pos.length; i += 3) pts.push({ x: buf.pos[i], y: -buf.pos[i + 2] });
        return pts;
      });
  for (const p of seen) {
    const u = (p.x - f.x) * cv + (p.y - f.y) * sv;
    if (u < vmin) vmin = u;
    if (u > vmax) vmax = u;
  }
  if (!Number.isFinite(vmin) || vmax - vmin < 0.5) { vmin = -2; vmax = 2; }
  // La marge suit la taille de l'objet : un cadrage fixe de 6 m noyait une
  // croix de chemin de 1,5 m dans le vide.
  const pad = Math.max(1.2, (vmax - vmin) * 0.3);
  // L'echelle doit tenir la LARGEUR et la HAUTEUR : cadrer sur la seule largeur
  // coupait la croix de chemin, haute et etroite.
  let zmax = 0;
  for (const buf of [base.walls, e.walls, e.roofs, e.glow]) {
    for (let i = 1; i < buf.pos.length; i += 3) if (buf.pos[i] > zmax) zmax = buf.pos[i];
  }
  const scale = Math.min(W / (vmax - vmin + 2 * pad), (HPX - 90) / Math.max(zmax * 1.1, 1));
  const x0 = (vmin + vmax) / 2 - W / (2 * scale);
  const sx = (lx: number) => (lx - x0) * scale;
  const sy = (z: number) => HPX - 40 - z * scale;
  const c = cv;
  const s = sv;

  const collect = (buf: Buf, glow: boolean) => {
    for (let i = 0; i < buf.pos.length; i += 9) {
      const X: number[] = [], Y: number[] = [], D: number[] = [];
      for (let k = 0; k < 3; k++) {
        const wx = buf.pos[i + k * 3];
        const wz = buf.pos[i + k * 3 + 1];
        const wy = -buf.pos[i + k * 3 + 2];
        const dx = wx - f.x, dy = wy - f.y;
        X.push(sx(dx * c + dy * s));
        Y.push(sy(wz));
        D.push(-dx * s + dy * c);
      }
      const col: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) col[j] += buf.col[i + k * 3 + j] / 3;
      // Un peu de modele : la normale distingue une saillie d'un nu de mur.
      const nz = buf.norm.length ? -buf.norm[i + 2] : 1;
      const ny = buf.norm.length ? buf.norm[i + 1] : 0;
      const shade = glow ? 1 : 0.62 + 0.26 * Math.abs(nz) + 0.24 * Math.max(0, ny);
      tris.push({ x: X, y: Y, depth: Math.max(...D), col, shade });
    }
  };
  collect(base.walls, false);
  collect(e.walls, false);
  collect(e.roofs, false);
  collect(e.glow, true);
  tris.sort((p, q) => q.depth - p.depth); // peintre : le plus loin d'abord

  const img = new Uint8Array(W * HPX * 4);
  for (let i = 0; i < W * HPX; i++) {
    img[i * 4] = 14; img[i * 4 + 1] = 20; img[i * 4 + 2] = 34; img[i * 4 + 3] = 255;
  }
  for (let y = Math.round(sy(0)); y < HPX; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      img[o] = 26; img[o + 1] = 26; img[o + 2] = 30;
    }
  }

  for (const t of tris) {
    const minX = Math.max(0, Math.floor(Math.min(...t.x)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(...t.x)));
    const minY = Math.max(0, Math.floor(Math.min(...t.y)));
    const maxY = Math.min(HPX - 1, Math.ceil(Math.max(...t.y)));
    const [ax, bx, cx2] = t.x;
    const [ay, by, cy2] = t.y;
    const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
    if (Math.abs(den) < 1e-9) continue;
    // tone mapping grossier : sans lui le HDR des baies sature en aplat blanc
    const tone = (v: number) => Math.round(255 * Math.min(1, ((v * t.shade) / (1 + v * t.shade * 0.55)) * 1.35));
    const R = tone(t.col[0]), G = tone(t.col[1]), B = tone(t.col[2]);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / den;
        const l2 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / den;
        if (l1 < -0.002 || l2 < -0.002 || 1 - l1 - l2 < -0.002) continue;
        const o = (y * W + x) * 4;
        img[o] = R; img[o + 1] = G; img[o + 2] = B;
      }
    }
  }

  // Reperes d'echelle : une barre de 10 m et une silhouette de 1,70 m.
  const mark = (xm: number, zm: number, wm: number, hm: number, col: [number, number, number]) => {
    for (let y = Math.round(sy(zm + hm)); y <= Math.round(sy(zm)); y++) {
      for (let x = Math.round(sx(xm)); x <= Math.round(sx(xm + wm)); x++) {
        if (x < 0 || x >= W || y < 0 || y >= HPX) continue;
        const o = (y * W + x) * 4;
        img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
      }
    }
  };
  // Barre d'echelle : 10 m sur un batiment, 1 m sur un objet de trottoir, sinon
  // elle sort du cadre ou elle devient invisible.
  const bar = vmax - vmin > 20 ? 10 : 1;
  const left = x0 + 1 / scale;
  mark(left, 0, bar, 0.12 * (bar === 1 ? 0.3 : 1), [220, 180, 90]);
  mark(left + bar + 0.4, 0, bar === 1 ? 0.12 : 0.5, 1.7, [230, 230, 235]);

  writeFileSync(outPath, encode({ data: Buffer.from(img), width: W, height: HPX }, 88).data);
  return (
    `${label} : ${outPath}\n` +
    `  largeur vue ${(vmax - vmin).toFixed(1)} m, ` +
    `${Math.round(tris.length)} triangles, echelle ${scale.toFixed(1)} px/m`
  );
}
