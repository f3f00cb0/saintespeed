#!/usr/bin/env node
// Grille de relief de Saint-Etienne, tiree du RGE ALTI de l'IGN.
//
//   npm run fetch-relief   -> public/sainte-relief.json + public/sainte-relief.bin
//
// Saint-Etienne est au fond d'une cuvette : de 417 m a la sortie du Furan a
// plus de 700 m a Montreynaud et au Crêt de Roch, et le bord sud de la bbox
// monte jusqu'au Pilat. Plat, le jeu ne ressemblait a aucune de ses rues. Ce
// script cuit une fois pour toutes une grille d'altitude que le jeu echantillonne.
//
// Source : couche ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES du WMS raster de la
// Geoplateforme (RGE ALTI, pas de 1 a 5 m), servie en flottants 32 bits
// (image/x-bil;bits=32). Licence Ouverte Etalab 2.0, "IGN - RGE ALTI".
//
// On la lit a 2 m, puis on moyenne par blocs de 5 x 5 pour sortir une grille a
// 10 m. Pourquoi 2 m et pas 5 : le service choisit son niveau de pyramide sur
// l'echelle demandee, et a 5 m par pixel sur des tuiles de 5 km il descendait a
// un niveau plus grossier en latitude, rendu en pixels dupliques. Mesure a la
// premiere cuisson : 555 lignes sur 1 224 identiques a leur voisine, soit un
// relief en escalier de 20 m. A 2 m par pixel il sert sa vraie resolution. La
// moyenne n'est pas un detail : a 1-5 m le modele porte les bordures,
// les murets et les voitures garees, du bruit a l'echelle d'une chaussee. A 25 m
// il rate les murs de soutenement. Dix metres garde les rues en escalier du
// centre et gomme le mobilier. Les chaussees seront de toute facon lissees le
// long de leur axe (etape suivante), le sol ne sert qu'a les porter.
//
// Format de sortie, pense pour le navigateur :
//   sainte-relief.json  { bbox: [ouest, sud, est, nord], w, h, base, step, ... }
//   sainte-relief.bin   w*h Int16 little-endian, ligne 0 au NORD, colonne 0 a
//                       l'OUEST, en ecarts a la cellule voisine (voir plus bas) ;
//                       une fois cumules, altitude = base + valeur * step.
// La grille est reguliere en degres : elle ne depend pas de l'origine du repere
// metrique du jeu, qui suit le barycentre du reseau.
// Les valeurs sont aux CENTRES des cellules (convention du WMS).

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");

const WMS = "https://data.geopf.fr/wms-r/wms";
const LAYER = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES";
const UA = "saintespeed/0.1 (jeu de course, grille de relief; contact via github)";
export const RELIEF_ATTRIBUTION = "IGN - RGE ALTI, Licence Ouverte Etalab 2.0";

// meme bbox que le reseau : [ouest, sud, est, nord]
const geo = JSON.parse(readFileSync(resolve(PUBLIC, "sainte.geojson"), "utf8"));
const [W0, S0, E0, N0] = geo.bbox ?? [4.33, 45.38, 4.44, 45.49];

const TARGET = 10; // metres, pas de la grille livree
const FACTOR = 5; // cellules fines par cellule livree, dans chaque direction
const FINE = TARGET / FACTOR; // pas de lecture
const latMid = (S0 + N0) / 2;
const mPerDegLat = 111320;
const mPerDegLon = 111320 * Math.cos((latMid * Math.PI) / 180);

// nombre de cellules fines, arrondi a un multiple de FACTOR pour la moyenne
const fw = Math.ceil(((E0 - W0) * mPerDegLon) / FINE / FACTOR) * FACTOR;
const fh = Math.ceil(((N0 - S0) * mPerDegLat) / FINE / FACTOR) * FACTOR;
const TILE = 1024; // cote max d'une requete, en pixels

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTile(x0, y0, tw, th) {
  // pixels [x0, x0+tw) x [y0, y0+th) de la grille fine, ligne 0 au nord
  const west = W0 + ((E0 - W0) * x0) / fw;
  const east = W0 + ((E0 - W0) * (x0 + tw)) / fw;
  const north = N0 - ((N0 - S0) * y0) / fh;
  const south = N0 - ((N0 - S0) * (y0 + th)) / fh;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: LAYER,
    STYLES: "",
    CRS: "EPSG:4326", // WMS 1.3.0 : latitude, longitude
    BBOX: `${south},${west},${north},${east}`,
    WIDTH: String(tw),
    HEIGHT: String(th),
    FORMAT: "image/x-bil;bits=32",
  });
  const url = `${WMS}?${params}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === tw * th * 4) {
          return new Float32Array(buf.buffer, buf.byteOffset, tw * th);
        }
        console.warn(`    tuile de ${buf.length} octets au lieu de ${tw * th * 4}, nouvel essai`);
      } else {
        console.warn(`    WMS ${res.status}, nouvel essai`);
      }
    } catch (err) {
      console.warn(`    WMS injoignable (${err.cause?.code ?? err.message}), nouvel essai`);
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`WMS relief injoignable apres 6 essais : ${url}`);
}

// Le modele marque l'absence de donnee par -99999 ; on garde une marge large.
const valid = (v) => v > -500 && v < 5000;

console.log(`relief -> ${W0}, ${S0}, ${E0}, ${N0} : grille fine ${fw} x ${fh} a ${FINE} m`);
const fine = new Float32Array(fw * fh);
for (let y0 = 0; y0 < fh; y0 += TILE) {
  for (let x0 = 0; x0 < fw; x0 += TILE) {
    const tw = Math.min(TILE, fw - x0);
    const th = Math.min(TILE, fh - y0);
    const t = await getTile(x0, y0, tw, th);
    for (let y = 0; y < th; y++) fine.set(t.subarray(y * tw, (y + 1) * tw), (y0 + y) * fw + x0);
    console.log(`    tuile ${x0},${y0} (${tw} x ${th}) lue`);
  }
}

// moyenne FACTOR x FACTOR, en ignorant les pixels sans donnee
const w = fw / FACTOR;
const h = fh / FACTOR;
const grid = new Float32Array(w * h);
let holes = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    let s = 0;
    let n = 0;
    for (let dy = 0; dy < FACTOR; dy++) {
      for (let dx = 0; dx < FACTOR; dx++) {
        const v = fine[(y * FACTOR + dy) * fw + x * FACTOR + dx];
        if (valid(v)) {
          s += v;
          n++;
        }
      }
    }
    grid[y * w + x] = n ? s / n : NaN;
    if (!n) holes++;
  }
}

// Trous : rebouches par diffusion depuis les voisins valides, en passes
// successives. Il n'y en a normalement aucun sur la ville ; la boucle est la
// pour qu'un trou du service ne devienne jamais un puits de 99 km.
for (let pass = 0; holes > 0 && pass < 200; pass++) {
  holes = 0;
  const next = grid.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!Number.isNaN(grid[y * w + x])) continue;
      let s = 0;
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = grid[yy * w + xx];
        if (!Number.isNaN(v)) {
          s += v;
          n++;
        }
      }
      if (n) next[y * w + x] = s / n;
      else holes++;
    }
  }
  grid.set(next);
}
if (holes) throw new Error(`${holes} cellules sans altitude apres rebouchage`);

let min = Infinity;
let max = -Infinity;
for (const v of grid) {
  if (v < min) min = v;
  if (v > max) max = v;
}
// Quantification au pas de 5 cm, puis ecarts a la cellule voisine en Int16.
// Mesure : en Uint16 au centimetre, gzip ne gagnait que 7 % (2,11 -> 1,96 Mo),
// le centimetre etant du bruit. Au pas de 5 cm, tres en dessous de l'ecart du
// modele a la BD TOPO (0,22 m en mediane), et en ecarts plutot qu'en valeurs,
// le terrain variant lentement, le fichier tombe a 1,05 Mo compresse.
// Chaque cellule stocke son ecart a la cellule a l'ouest ; la premiere colonne,
// son ecart a la cellule au nord ; la toute premiere, son ecart a `base`.
const base = Math.floor(min);
const step = 0.05;
const abs = new Int32Array(w * h);
for (let i = 0; i < abs.length; i++) abs[i] = Math.round((grid[i] - base) / step);
const q = new Int16Array(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const prev = x > 0 ? abs[i - 1] : y > 0 ? abs[i - w] : 0;
    const d = abs[i] - prev;
    if (d < -32768 || d > 32767) throw new Error(`ecart hors Int16 en ${x},${y} : ${d}`);
    q[i] = d;
  }
}

const meta = {
  attribution: RELIEF_ATTRIBUTION,
  source: LAYER,
  bbox: [W0, S0, E0, N0],
  w,
  h,
  base,
  step,
  encoding: "delta-int16",
  cell: TARGET,
  min: Math.round(min * 100) / 100,
  max: Math.round(max * 100) / 100,
  order: "lignes du nord au sud, colonnes d'ouest en est, valeurs aux centres des cellules",
};
await writeFile(resolve(PUBLIC, "sainte-relief.json"), JSON.stringify(meta, null, 1));
await writeFile(resolve(PUBLIC, "sainte-relief.bin"), Buffer.from(q.buffer));
console.log(
  `  ecrit sainte-relief.bin : ${w} x ${h} cellules de ${TARGET} m, ` +
    `${((q.byteLength) / 1e6).toFixed(2)} Mo, altitudes ${meta.min} a ${meta.max} m`,
);
