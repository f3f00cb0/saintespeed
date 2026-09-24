// Relief : lecture de la grille d'altitude cuite par scripts/fetch-relief.mjs.
//
// La grille est reguliere en degres (lignes du nord au sud, colonnes d'ouest en
// est, valeurs aux centres des cellules de 10 m), donc independante de
// l'origine du repere metrique du jeu. On l'interroge en metres : le Projector
// ramene le point en degres, puis on interpole bilineairement.
//
// Pas de three.js ici : le module sert au jeu, aux scripts de releve et aux
// tests Node.

import type { Projector } from "./project";

export type ReliefMeta = {
  bbox: [number, number, number, number]; // ouest, sud, est, nord
  w: number;
  h: number;
  base: number;
  step: number;
  min: number;
  max: number;
  /** "delta-int16" : ecarts a la cellule ouest (au nord en premiere colonne). */
  encoding?: string;
  attribution?: string;
};

/**
 * Reconstruit les altitudes quantifiees a partir du fichier : les ecarts
 * Int16 sont cumules le long de chaque ligne, la premiere colonne depuis la
 * ligne du dessus (voir scripts/fetch-relief.mjs).
 */
export function decodeRelief(meta: ReliefMeta, raw: ArrayBuffer | ArrayBufferView): Uint16Array {
  const bytes =
    raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = meta.w * meta.h;
  if (bytes.byteLength !== n * 2) throw new Error(`relief : ${bytes.byteLength} octets pour ${n} cellules`);
  const copy = new Uint8Array(bytes); // alignement garanti pour la vue 16 bits
  if (meta.encoding !== "delta-int16") return new Uint16Array(copy.buffer);
  const d = new Int16Array(copy.buffer);
  const out = new Uint16Array(n);
  const { w, h } = meta;
  for (let y = 0; y < h; y++) {
    let v = y > 0 ? out[(y - 1) * w] + d[y * w] : d[0];
    out[y * w] = v;
    for (let x = 1; x < w; x++) {
      v += d[y * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

export type Relief = {
  meta: ReliefMeta;
  /** Altitude absolue (m) en un point lon/lat. Hors grille : le bord le plus proche. */
  atLonLat(lon: number, lat: number): number;
  /** Altitude absolue (m) en un point du repere metrique du jeu. */
  at(x: number, y: number): number;
};

export function makeRelief(meta: ReliefMeta, data: Uint16Array, proj: Projector): Relief {
  const [west, south, east, north] = meta.bbox;
  const { w, h, base, step } = meta;
  // pas d'une cellule en degres ; le centre de la cellule (0, 0) est a un
  // demi-pas du coin nord-ouest
  const dLon = (east - west) / w;
  const dLat = (north - south) / h;

  // Conversion metres -> degres inlinee : `at` est appele a chaque sommet de
  // sol et a chaque frame par la voiture, pas la peine d'allouer un objet.
  const kx = 1 / ((Math.PI / 180) * proj.k * 6378137);
  const ky = 1 / ((Math.PI / 180) * 6378137);

  const atLonLat = (lon: number, lat: number): number => {
    let fx = (lon - west) / dLon - 0.5;
    let fy = (north - lat) / dLat - 0.5;
    if (fx < 0) fx = 0;
    else if (fx > w - 1) fx = w - 1;
    if (fy < 0) fy = 0;
    else if (fy > h - 1) fy = h - 1;
    const x0 = Math.min(w - 2, Math.floor(fx));
    const y0 = Math.min(h - 2, Math.floor(fy));
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * w + x0;
    const a = data[i] + (data[i + 1] - data[i]) * tx;
    const b = data[i + w] + (data[i + w + 1] - data[i + w]) * tx;
    return base + (a + (b - a) * ty) * step;
  };

  return {
    meta,
    atLonLat,
    at(x, y) {
      return atLonLat(x * kx + proj.lon0, y * ky + proj.lat0);
    },
  };
}

/** Chargement navigateur : null si la grille manque, le jeu reste alors a plat. */
export async function loadRelief(proj: Projector): Promise<Relief | null> {
  try {
    const [mr, br] = await Promise.all([fetch("/sainte-relief.json"), fetch("/sainte-relief.bin")]);
    if (!mr.ok || !br.ok) return null;
    const meta = (await mr.json()) as ReliefMeta;
    return makeRelief(meta, decodeRelief(meta, await br.arrayBuffer()), proj);
  } catch (err) {
    console.warn("relief indisponible, sol plat", err);
    return null;
  }
}
