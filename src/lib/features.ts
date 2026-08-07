// Decor OSM : surfaces au sol, arbres, tram, mobilier.
//
// Sans ces couches, une place pietonne comme Jean Moulin ou l'Hotel de Ville
// n'est qu'un trou : on n'importait que les axes, donc la place elle-meme, qui
// n'est pas une ligne, n'existait pas. Tout ce qui est ici vient d'OSM, y
// compris la densification d'arbres, qui ne se fait que le long de features
// reelles (tree_row) et jamais au hasard.

import earcut from "earcut";
import type { Projector } from "./project";
import { characterFor, Character } from "./places";

export type AreaKind =
  | "pedestrian"
  | "park"
  | "grass"
  | "forest"
  | "pitch"
  | "cemetery"
  | "parking"
  | "water";

/** Un espace au sol, avec ce que les jointures hors ligne ont releve dessus. */
export type RawArea = {
  i: number;
  k: AreaKind;
  g: [number, number][];
  n?: string; // name
  s?: string; // surface
  lz?: string; // leisure
  sq?: number; // place=square
  nt?: number; // arbres dans le polygone
  fl?: number; // metres de cloture le long du perimetre
  np?: number; // allees a l'interieur
};

/** k : f grille, h haie, w mur. */
export type RawFence = { g: [number, number][]; k: "f" | "h" | "w" };
export type RawPath = { g: [number, number][]; s?: string };

export type RawFeatures = {
  areas: RawArea[];
  /** rues pietonnes : des lignes ouvertes, elargies en dalle au rendu */
  pedLines: { i: number; g: [number, number][]; n?: string; s?: string }[];
  trees: [number, number][];
  treeRows: { i: number; g: [number, number][] }[];
  tram: { i: number; g: [number, number][] }[];
  fountains: [number, number][];
  lamps: [number, number][];
  fences: RawFence[];
  paths: RawPath[];
};

const EMPTY: RawFeatures = {
  areas: [],
  pedLines: [],
  trees: [],
  treeRows: [],
  tram: [],
  fountains: [],
  lamps: [],
  fences: [],
  paths: [],
};

/** largeur d'une rue pietonne, en metres */
const PED_WIDTH = 9;

// --- materiaux des surfaces ------------------------------------------------
// Palette calee sur celle des routes (Roads.tsx) : de nuit tout est sombre et
// desature, la couleur ne sert qu'a distinguer les natures de sol. Une place
// dallee doit rester le point clair, c'est elle qui doit se lire.
export type AreaSpec = { c: number; z: number };

export const AREAS: Record<AreaKind, AreaSpec> = {
  pedestrian: { c: 0x4c4a41, z: 5 }, // dalle claire, au dessus du reste
  parking: { c: 0x26261f, z: 4 }, // bitume
  pitch: { c: 0x2b3a2a, z: 4 },
  cemetery: { c: 0x24291f, z: 2 },
  park: { c: 0x232d1e, z: 2 }, // vert desature
  grass: { c: 0x252f1f, z: 1 },
  forest: { c: 0x1d2619, z: 1 },
  water: { c: 0x111c2b, z: 3 },
};

// Le sol de base est a -0.4 et la premiere couche de route a 0.06 (LAYER_STEP).
// On loge donc les surfaces entre les deux : visibles, mais toujours sous la
// chaussee, qui doit rester lisible par dessus une place pietonne.
export const AREA_BASE = -0.3;
export const AREA_STEP = 0.03;

export function areaSpec(k: AreaKind): AreaSpec {
  return AREAS[k] ?? AREAS.grass;
}

export function areaHeight(k: AreaKind): number {
  return AREA_BASE + areaSpec(k).z * AREA_STEP;
}

// --- chargement ------------------------------------------------------------
// Cache local uniquement : le decor n'est pas vital, s'il manque le jeu tourne
// comme avant. Pas de secours Overpass au runtime, ce serait 5 Mo au demarrage.
export async function loadFeatures(): Promise<RawFeatures> {
  for (const url of ["/sainte-features.json", "/sainte-features.geojson"]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const f = parseFeatures(data);
      if (f.areas.length || f.trees.length) return f;
    } catch {
      // fichier absent ou illisible, on tente le suivant
    }
  }
  console.warn("decor absent, lance: npm run fetch-osm -- features");
  return EMPTY;
}

// Avale le format maison, du GeoJSON, ou du JSON Overpass brut.
export function parseFeatures(data: any): RawFeatures {
  if (!data) return EMPTY;
  if (Array.isArray(data.areas)) return { ...EMPTY, ...data };
  if (Array.isArray(data.elements)) return fromOverpass(data);
  if (Array.isArray(data.features)) return fromGeoJSON(data);
  return EMPTY;
}

function classify(t: any): AreaKind | null {
  if (!t) return null;
  if (t.natural === "water") return "water";
  if (t.highway === "pedestrian") return "pedestrian";
  if (t.highway === "footway" && t.area === "yes") return "pedestrian";
  if (t.amenity === "parking") return "parking";
  if (t.leisure === "pitch") return "pitch";
  if (t.leisure === "park" || t.leisure === "garden") return "park";
  if (t.landuse === "cemetery") return "cemetery";
  if (t.landuse === "forest") return "forest";
  if (t.landuse === "grass" || t.landuse === "meadow") return "grass";
  return null;
}

function isClosed(g: [number, number][]): boolean {
  if (g.length < 4) return false;
  const a = g[0];
  const b = g[g.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

function unclose(g: [number, number][]): [number, number][] {
  return isClosed(g) ? g.slice(0, -1) : g;
}

function blank(): RawFeatures {
  return {
    areas: [], pedLines: [], trees: [], treeRows: [], tram: [],
    fountains: [], lamps: [], fences: [], paths: [],
  };
}

function fromOverpass(data: any): RawFeatures {
  const out = blank();
  for (const el of data.elements) {
    const t = el.tags || {};
    if (el.type === "node") {
      const p: [number, number] = [el.lon, el.lat];
      if (t.natural === "tree") out.trees.push(p);
      else if (t.amenity === "fountain") out.fountains.push(p);
      else if (t.highway === "street_lamp") out.lamps.push(p);
      continue;
    }
    if (el.type !== "way" || !el.geometry) continue;
    const g = el.geometry.map((q: any) => [q.lon, q.lat] as [number, number]);
    if (t.railway === "tram") out.tram.push({ i: el.id, g });
    else if (t.natural === "tree_row") out.treeRows.push({ i: el.id, g });
    else if (!isClosed(g)) {
      if (t.highway === "pedestrian") out.pedLines.push({ i: el.id, g });
    } else {
      const k = classify(t);
      if (k) out.areas.push({ i: el.id, k, g: unclose(g) });
    }
  }
  return out;
}

function fromGeoJSON(data: any): RawFeatures {
  const out = blank();
  let auto = 0;
  for (const f of data.features || []) {
    const g = f.geometry;
    const t = f.properties || {};
    if (!g) continue;
    const id = f.id ?? ++auto;
    if (g.type === "Point") {
      const p: [number, number] = [g.coordinates[0], g.coordinates[1]];
      if (t.natural === "tree") out.trees.push(p);
      else if (t.amenity === "fountain") out.fountains.push(p);
      else if (t.highway === "street_lamp") out.lamps.push(p);
    } else if (g.type === "LineString") {
      if (t.railway === "tram") out.tram.push({ i: id, g: g.coordinates });
      else if (t.natural === "tree_row") out.treeRows.push({ i: id, g: g.coordinates });
      else if (!isClosed(g.coordinates)) {
        if (t.highway === "pedestrian") out.pedLines.push({ i: id, g: g.coordinates });
      } else {
        const k = classify(t);
        if (k) out.areas.push({ i: id, k, g: unclose(g.coordinates) });
      }
    } else if (g.type === "Polygon") {
      const k = classify(t);
      if (k) out.areas.push({ i: id, k, g: unclose(g.coordinates[0]) });
    } else if (g.type === "MultiPolygon") {
      const k = classify(t);
      if (k) for (const poly of g.coordinates) out.areas.push({ i: ++auto, k, g: unclose(poly[0]) });
    }
  }
  return out;
}

// --- preparation : projection + triangulation ------------------------------

export type FlatArea = {
  id: number;
  kind: AreaKind;
  /** triplets x,y,z prets a poser dans un BufferGeometry */
  pos: Float32Array;
  area: number;
  cx: number;
  cy: number;
  /** mineral / jardin / parc, ou null si ce n'est pas un espace ouvert */
  character: Character | null;
  name?: string;
};

export type FlatFence = { pts: { x: number; y: number }[]; kind: "f" | "h" | "w" };
export type FlatPath = { pts: { x: number; y: number }[]; soft: boolean };

export type FlatFeatures = {
  areas: FlatArea[];
  trees: { x: number; y: number }[];
  tram: { x: number; y: number }[][];
  fountains: { x: number; y: number }[];
  lamps: { x: number; y: number }[];
  fences: FlatFence[];
  paths: FlatPath[];
};

function signedArea(ring: number[]): number {
  let a = 0;
  for (let i = 0, n = ring.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return a / 2;
}

// espacement des arbres semes le long d'un tree_row, en metres
const ROW_SPACING = 9;

// xorshift seede sur l'index : la ville doit etre identique d'un chargement a
// l'autre, donc aucun Math.random nulle part.
export function rand01(seed: number): number {
  let x = (seed | 0) ^ 0x27d4eb2f;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

// Elargit une polyligne en bande, avec un patch carre sur chaque sommet pour
// boucher les encoches dans les angles. Meme principe que les rubans de Roads.
function widen(P: { x: number; y: number }[], half: number, y: number): number[] {
  const pos: number[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const b = P[i + 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    dx /= len;
    dy /= len;
    const nx = -dy * half;
    const ny = dx * half;

    pos.push(
      a.x + nx, y, -(a.y + ny), b.x + nx, y, -(b.y + ny), b.x - nx, y, -(b.y - ny),
      a.x + nx, y, -(a.y + ny), b.x - nx, y, -(b.y - ny), a.x - nx, y, -(a.y - ny),
    );

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

export function prepareFeatures(raw: RawFeatures, proj: Projector): FlatFeatures {
  const areas: FlatArea[] = [];

  // Rues pietonnes : le secteur pietonnier du centre est cartographie en
  // lignes, pas en polygones. Sans elles, tout le coeur de ville reste noir
  // meme une fois les places bouchees.
  const pedY = areaHeight("pedestrian");
  for (const line of raw.pedLines ?? []) {
    if (!line.g || line.g.length < 2) continue;
    const P = line.g.map(([lon, lat]) => proj.project(lon, lat));
    const pos = widen(P, PED_WIDTH / 2, pedY);
    if (!pos.length) continue;
    let cx = 0;
    let cy = 0;
    for (const p of P) {
      cx += p.x;
      cy += p.y;
    }
    areas.push({
      id: line.i,
      kind: "pedestrian",
      pos: new Float32Array(pos),
      area: 0,
      cx: cx / P.length,
      cy: cy / P.length,
      // Une rue pietonne est minerale par construction : c'est du sol dur qui
      // se marche entierement. Le secteur pietonnier du centre est entierement
      // cartographie comme ca.
      character: Character.Mineral,
      name: line.n,
    });
  }

  for (const a of raw.areas) {
    if (!a.g || a.g.length < 3) continue;

    // earcut travaille sur un tableau plat [x0,y0,x1,y1,...]
    const flat: number[] = [];
    for (const [lon, lat] of a.g) {
      const p = proj.project(lon, lat);
      flat.push(p.x, p.y);
    }

    const surface = Math.abs(signedArea(flat));
    if (surface < 12) continue; // bruit de saisie, invisible au rendu

    const tris = earcut(flat);
    if (tris.length < 3) continue;

    const character = characterFor({
      kind: a.k,
      leisure: a.lz,
      surface: a.s,
      square: !!a.sq,
      area: surface,
      trees: a.nt ?? 0,
      fenceLen: a.fl ?? 0,
      paths: a.np ?? 0,
    });

    const y = areaHeight(a.k);
    const pos = new Float32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i] * 2;
      pos[i * 3] = flat[t];
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = -flat[t + 1]; // metres nord -> -z three.js
    }

    let cx = 0;
    let cy = 0;
    for (let i = 0; i < flat.length; i += 2) {
      cx += flat[i];
      cy += flat[i + 1];
    }
    cx /= flat.length / 2;
    cy /= flat.length / 2;

    areas.push({ id: a.i, kind: a.k, pos, area: surface, cx, cy, character, name: a.n });
  }

  // --- arbres -------------------------------------------------------------
  const trees: { x: number; y: number }[] = [];
  for (const [lon, lat] of raw.trees) trees.push(proj.project(lon, lat));

  // Un tree_row est une polyligne : OSM dit "il y a une rangee d'arbres ici"
  // sans poser chaque tronc. On echantillonne donc la ligne. C'est la seule
  // densification qu'on s'autorise, et elle reste calee sur une feature reelle.
  for (const row of raw.treeRows) {
    const P = row.g.map(([lon, lat]) => proj.project(lon, lat));
    let run = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      let next = Math.ceil(run / ROW_SPACING) * ROW_SPACING;
      while (next < run + len) {
        const s = (next - run) / len;
        trees.push({ x: a.x + dx * s, y: a.y + dy * s });
        next += ROW_SPACING;
      }
      run += len;
    }
  }

  const tram = raw.tram
    .map((t) => t.g.map(([lon, lat]) => proj.project(lon, lat)))
    .filter((p) => p.length >= 2);

  // --- clotures et allees --------------------------------------------------
  // Deja filtrees a la generation : seules celles au contact d'un espace ouvert
  // sont dans le cache, le reste de la ville en est couvert mais ne servirait
  // a rien ici.
  const fences: FlatFence[] = [];
  for (const f of raw.fences ?? []) {
    if (!f.g || f.g.length < 2) continue;
    fences.push({ pts: f.g.map(([lon, lat]) => proj.project(lon, lat)), kind: f.k });
  }

  // Une allee de terre ou de gravier lit "parc", une allee betonnee lit
  // "amenagement". On garde juste cette bascule, le detail exact de la surface
  // ne survit pas a la distance.
  const SOFT = /^(gravel|fine_gravel|compacted|dirt|ground|earth|sand|grass|unpaved|wood)$/;
  const paths: FlatPath[] = [];
  for (const p of raw.paths ?? []) {
    if (!p.g || p.g.length < 2) continue;
    paths.push({
      pts: p.g.map(([lon, lat]) => proj.project(lon, lat)),
      soft: SOFT.test(p.s ?? ""),
    });
  }

  return {
    areas,
    trees,
    tram,
    fountains: raw.fountains.map(([lon, lat]) => proj.project(lon, lat)),
    lamps: raw.lamps.map(([lon, lat]) => proj.project(lon, lat)),
    fences,
    paths,
  };
}
