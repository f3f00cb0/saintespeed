// Emprises de batiments OSM et deduction des hauteurs.
//
// Saint-Etienne n'a quasiment aucune hauteur taggee : 0,05 % des batiments ont
// "height" et 10,9 % ont "building:levels". Le reste est donc infere, a partir
// de la surface au sol et de la distance au centre, avec un bruit deterministe
// seede sur l'id OSM pour que la ville ne bouge pas d'un chargement a l'autre.
//
// L'heuristique n'est pas devinee : elle est calee sur la mediane reelle des
// batiments qui portent building:levels, croisee surface x distance. La version
// precedente sortait 1 a 2 niveaux la ou OSM en mesure 4, et plafonnait les
// grandes emprises a 3 alors qu'elles font 4 a 5 : le centre lisait comme un
// lotissement.
//
// La table a ete calee sur les 1759 batiments tagues de l'ancienne emprise. Le
// bord nord ayant ete remonte, ils sont maintenant 2455. Re-mesure faite : la
// bande ajoutee a exactement la meme distribution que l'ancienne emprise
// (p25 1, mediane 3, p75 4, p90 6), la table tient donc telle quelle et les
// hauteurs sont inchangees au chiffre pres.

import type { Projector } from "./project";
import { zAt } from "./elev";
import { archetypeFor, hasShopFront, isUnlit, LANDMARKS, Archetype, type Landmark } from "./archetypes";
import { Family, culteHeight, familyOf } from "./families";
import { frameOf, type Frame } from "./frame";

export type Building = {
  id: number;
  ring: [number, number][]; // contour lon/lat, non ferme
  levels?: number;
  height?: number;
  kind?: string;
  material?: string; // building:material
  colour?: string; // building:colour
  roofShape?: string; // roof:shape
  name?: string;
  zone?: string; // "i" si dans un landuse industriel, calcule a la generation
  shop?: number; // masque commerce : 1 POI, 2 bord d'axe, 4 zone retail
};

export type FlatBuilding = {
  id: number;
  ring: { x: number; y: number }[]; // contour projete en metres, sens trigo
  height: number;
  area: number;
  cx: number;
  cy: number;
  /** Archetype de facade, assigne par la cascade de src/lib/archetypes.ts. */
  archetype: Archetype;
  /** Rez-de-chaussee commercant. */
  shopFront: boolean;
  /** Couleur OSM explicite, si le batiment en porte une. */
  colour?: string;
  /** Toit en pente : archetype, ou roof:shape OSM quand il est tague. */
  sloped: boolean;
  /** Masse sombre sans fenetres allumees : clochers, chevalements. */
  unlit: boolean;
  /** Reglage bespoke si le batiment est un repere pose a la main. */
  landmark?: Landmark;
  /** Famille de kit posee sur l'emprise (clocher, sheds, marquise, edicules). */
  family: Family;
  /** Repere local de l'emprise, calcule seulement si une famille s'y pose. */
  frame?: Frame;
};

export const FLOOR = 3.1; // hauteur d'etage retenue

export async function loadBuildings(): Promise<Building[]> {
  try {
    const res = await fetch("/sainte-buildings.json");
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.buildings)) return [];
    return data.buildings.map((b: any) => ({
      id: b.i,
      ring: b.g,
      levels: b.l,
      height: b.h,
      kind: b.k,
      material: b.m,
      colour: b.c,
      roofShape: b.rs,
      name: b.n,
      zone: b.z,
      shop: b.s,
    }));
  } catch (err) {
    console.warn("batiments indisponibles", err);
    return [];
  }
}

// xorshift : bruit reproductible a partir de l'id OSM
function rand01(seed: number): number {
  let x = (seed | 0) ^ 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

// Hypercentre stephanois : place de l'Hotel de Ville. C'est de la que doit
// partir le gradient de hauteur, pas du barycentre du circuit, qui est a 1,5 km
// au sud-est et laissait justement le centre-ville en construction basse.
export const CITY_CENTRE = { lon: 4.39, lat: 45.4397 };

// Niveaux observes sur les batiments taggés du cache, par tranche de surface au
// sol et de distance a l'Hotel de Ville.
//
// Une nuance sur la colonne "core" : ailleurs on prend la mediane mesuree, mais
// dans les 300 premiers metres on prend le troisieme quartile. Saint-Etienne
// n'est pas Paris, son hypercentre est mesure a 4 niveaux de mediane et 5 au
// p75 ; viser la mediane donnait un coeur de ville qui lisait bas. Le p75 reste
// une valeur relevee dans OSM, pas un chiffre invente, et il donne la densite
// attendue une fois l'etalement applique.
const LEVELS: { maxArea: number; core: number; near: number; mid: number; far: number }[] = [
  { maxArea: 40, core: 1, near: 1, mid: 1, far: 1 }, // garages, abris
  { maxArea: 120, core: 4, near: 4, mid: 3, far: 2 }, // immeubles de ville etroits
  { maxArea: 400, core: 5, near: 4, mid: 4, far: 3 }, // le tissu dominant
  { maxArea: 1200, core: 5, near: 5, mid: 4, far: 5 },
  { maxArea: Infinity, core: 5, near: 5, mid: 4, far: 4 }, // halles, grands ensembles
];

const CORE = 300; // metres depuis l'Hotel de Ville
const NEAR = 600;
const MID = 1400;

function inferLevels(id: number, area: number, distCentre: number): number {
  const row = LEVELS.find((l) => area < l.maxArea) ?? LEVELS[LEVELS.length - 1];
  const base =
    distCentre < CORE
      ? row.core
      : distCentre < NEAR
        ? row.near
        : distCentre < MID
          ? row.mid
          : row.far;

  // Une mediane seule donnerait des rangees de batiments jumeaux. On etale de
  // plus ou moins un niveau, sauf sur les abris qui doivent rester plats.
  if (base <= 1) return 1;
  const r = rand01(id);
  const spread = r < 0.28 ? -1 : r > 0.72 ? 1 : 0;

  return Math.max(1, Math.min(12, base + spread));
}

// --- retrait de contour, pour les toits en pente --------------------------
// Un toit en pente est un bandeau qui relie le contour du mur a un contour
// rentre et sureleve. Le retrait fait reculer chaque sommet le long de sa
// bissectrice, avec une limite de biseau pour que les angles aigus ne partent
// pas a l'infini.
//
// C'est ici et pas dans le rendu parce que c'est de la geometrie pure : ca se
// teste dans Node sur les 22 509 emprises reelles, ce qui a servi a regler la
// valeur de retrait. A 1,5 m de retrait fixe, 2 843 batiments (14 %) voyaient
// leur contour s'auto-intersecter et retombaient a plat.

export type Pt = { x: number; y: number };

function insetOnce(ring: Pt[], inset: number): Pt[] | null {
  const n = ring.length;
  const out: Pt[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];

    let ax = cur.x - prev.x;
    let ay = cur.y - prev.y;
    let bx = next.x - cur.x;
    let by = next.y - cur.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-4 || lb < 1e-4) return null;
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;

    // contour en sens trigo : la normale interieure d'une arete (dx,dy) est
    // (-dy, dx)
    const n1x = -ay;
    const n1y = ax;
    const n2x = -by;
    const n2y = bx;

    let mx = n1x + n2x;
    let my = n1y + n2y;
    const lm = Math.hypot(mx, my);
    if (lm < 1e-4) return null; // demi-tour sur place
    mx /= lm;
    my /= lm;

    const cos = mx * n1x + my * n1y;
    const step = inset / Math.max(0.35, cos);
    out.push({ x: cur.x + mx * step, y: cur.y + my * step });
  }

  // Garde-fou : si le contour rentre s'est retourne ou a perdu l'essentiel de
  // sa surface, il s'auto-intersecte et sa triangulation serait du bruit.
  let a0 = 0;
  let a1 = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a0 += p.x * q.y - q.x * p.y;
    const r = out[i];
    const s = out[(i + 1) % n];
    a1 += r.x * s.y - s.x * r.y;
  }
  if (a1 <= 0 || a1 < a0 * 0.3) return null;
  return out;
}

/**
 * Contour rentre pour le bandeau de toit. Le retrait demande est proportionne a
 * la taille de l'emprise, puis reduit tant qu'il s'auto-intersecte : une
 * emprise etroite ou dentelee accepte 40 cm la ou une grande en accepte 1,5 m.
 * Renvoie null seulement quand meme le plus petit retrait echoue, auquel cas
 * l'appelant retombe sur un toit plat.
 */
export function insetRing(ring: Pt[], area: number): Pt[] | null {
  const want = Math.min(1.5, Math.sqrt(Math.max(area, 1)) * 0.2);
  for (const f of [1, 0.6, 0.35, 0.2]) {
    const r = insetOnce(ring, want * f);
    if (r) return r;
  }
  return null;
}

// --- index des murs, pour empecher la camera de traverser -----------------
// Un batiment est un prisme vertical, donc un test en 2D suffit tant qu'on
// compare la hauteur du mur a celle du point teste. Bien moins cher qu'un
// raycast sur 200k triangles.

const WALL_CELL = 40;
const WALL_OFFSET = 32768;

export type WallIndex = {
  /** Fraction du trajet libre entre deux points, 1 si rien ne bloque. */
  clear(x0: number, y0: number, x1: number, y1: number, probeH: number): number;
  count: number;
};

export function buildWallIndex(buildings: FlatBuilding[]): WallIndex {
  // segments a plat : ax, ay, bx, by, hauteur
  const seg: number[] = [];
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx + WALL_OFFSET) * 65536 + (cy + WALL_OFFSET);

  const put = (cx: number, cy: number, idx: number) => {
    const k = key(cx, cy);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    if (bucket[bucket.length - 1] !== idx) bucket.push(idx);
  };

  for (const b of buildings) {
    const ring = b.ring;
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 0.2) continue;
      const idx = seg.length;
      // sommet du mur en altitude de jeu : sans ca, une camera a y = 80
      // passerait au-dessus de tous les prismes encore mesures depuis 0.
      const top = b.height + 2.2 + zAt(b.cx, b.cy);
      seg.push(p.x, p.y, q.x, q.y, top);
      const steps = Math.max(1, Math.ceil(len / (WALL_CELL * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        put(
          Math.floor((p.x + (q.x - p.x) * f) / WALL_CELL),
          Math.floor((p.y + (q.y - p.y) * f) / WALL_CELL),
          idx,
        );
      }
    }
  }

  // Le marqueur de segments deja testes est reutilise d'un appel a l'autre : un
  // Set neuf par appel coutait cher des que les appels se comptent en centaines
  // de milliers. Les trottoirs lancent 130 000 rayons a la construction, et
  // l'allocation pesait a elle seule pres d'une seconde.
  const seen = new Int32Array(seg.length / 5);
  let stamp = 0;

  return {
    count: seg.length / 5,
    clear(x0, y0, x1, y1, probeH) {
      const rx = x1 - x0;
      const ry = y1 - y0;
      const len = Math.hypot(rx, ry);
      if (len < 1e-3) return 1;

      let best = 1;
      const steps = Math.max(1, Math.ceil(len / (WALL_CELL * 0.5)));
      stamp++;

      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const cx = Math.floor((x0 + rx * f) / WALL_CELL);
        const cy = Math.floor((y0 + ry * f) / WALL_CELL);
        // la cellule voisine peut contenir un mur qui coupe le trajet
        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            const bucket = grid.get(key(cx + i, cy + j));
            if (!bucket) continue;
            for (const idx of bucket) {
              const slot = idx / 5;
              if (seen[slot] === stamp) continue;
              seen[slot] = stamp;
              if (seg[idx + 4] < probeH) continue; // mur plus bas que la camera

              const ax = seg[idx];
              const ay = seg[idx + 1];
              const sx = seg[idx + 2] - ax;
              const sy = seg[idx + 3] - ay;
              const denom = rx * sy - ry * sx;
              if (Math.abs(denom) < 1e-9) continue; // paralleles
              const qx = ax - x0;
              const qy = ay - y0;
              const t = (qx * sy - qy * sx) / denom;
              const u = (qx * ry - qy * rx) / denom;
              if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
            }
          }
        }
      }
      return best;
    },
  };
}

// aire signee : sert a la fois de surface et de test d'orientation
function signedArea(ring: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function prepareBuildings(raw: Building[], proj: Projector): FlatBuilding[] {
  const out: FlatBuilding[] = [];
  const centre = proj.project(CITY_CENTRE.lon, CITY_CENTRE.lat);

  for (const b of raw) {
    if (!b.ring || b.ring.length < 3) continue;
    const ring = b.ring.map(([lon, lat]) => proj.project(lon, lat));

    let area = signedArea(ring);
    if (Math.abs(area) < 4) continue; // bruit de saisie
    // on force le sens trigo pour que la triangulation et les normales soient
    // previsibles
    if (area < 0) {
      ring.reverse();
      area = -area;
    }

    let cx = 0;
    let cy = 0;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
    }
    cx /= ring.length;
    cy /= ring.length;

    const dist = Math.hypot(cx - centre.x, cy - centre.y);
    const landmark = LANDMARKS.get(b.id);
    // La hauteur mesuree d'un monument prime sur l'inference : la table
    // inferLevels est calee sur du logement et ecraserait une cathedrale.
    let height =
      landmark?.height ?? b.height ?? (b.levels ?? inferLevels(b.id, area, dist)) * FLOOR;

    // Les niveaux rendus servent a la cascade d'archetypes. Un batiment tague
    // "height" sans "levels" doit quand meme peser dans la decision, on le
    // reconvertit plutot que de le laisser sans niveau.
    const renderedLevels = Math.max(1, Math.round(height / FLOOR));
    const input = {
      id: b.id,
      kind: b.kind,
      levels: b.levels,
      material: b.material,
      renderedLevels,
      area,
      dist,
      zone: b.zone,
      shop: b.shop,
    };

    const archetype = landmark ? landmark.archetype : archetypeFor(input);

    // Famille de kit. Un repere pose a la main garde son traitement bespoke :
    // la cathedrale a deja sa lanterne et sa rosace dans landmarks.ts, lui
    // ajouter le clocher generique de la famille culte la defigurerait.
    let frame: Frame | undefined;
    const lazyFrame = () => (frame ??= frameOf(ring, 0));
    const family = landmark
      ? Family.None
      : familyOf(
          { id: b.id, kind: b.kind, area, height, zone: b.zone, isBarre: archetype === Archetype.Barre },
          lazyFrame,
        );

    // Une nef n'est pas un immeuble : sans cette correction, les 56 lieux de
    // culte sortaient a la hauteur que la table inferLevels donne a du logement
    // de meme emprise, soit 9 m pour une eglise de 1 500 m2. Un "height" tague
    // en metres reste prioritaire, il est mesure.
    if (family === Family.Culte && landmark?.height === undefined && b.height === undefined) {
      height = culteHeight(area);
    }
    if (family !== Family.None) lazyFrame().height = height;

    // roof:shape est tague sur 206 batiments seulement, mais quand il est la il
    // prime sur la silhouette deduite de l'archetype. Les familles qui posent
    // leur propre couverture (nef a deux pentes, sheds) coupent la coiffe
    // generique, sinon deux toits se superposent.
    const rs = b.roofShape;
    const covered = family === Family.Culte || family === Family.Halle;
    const sloped =
      covered
        ? false
        : rs
          ? !/^(flat|skillion)$/.test(rs)
          : archetype === Archetype.Pierre || archetype === Archetype.Faubourg;

    out.push({
      id: b.id,
      ring,
      height,
      area,
      cx,
      cy,
      archetype,
      shopFront: hasShopFront(input),
      colour: b.colour,
      sloped,
      // Un lieu de culte tague building=yes (mosquees, temples) n'est pas vu
      // par isUnlit, qui ne connait que le tag de batiment. La famille, elle,
      // le sait.
      unlit: isUnlit(b.kind, landmark) || family === Family.Culte,
      landmark,
      family,
      frame,
    });
  }

  return out;
}
