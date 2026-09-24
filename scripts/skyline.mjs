#!/usr/bin/env node
// Ligne de crete autour de Saint-Etienne, tiree du relief reel.
//
//   npm run skyline      -> public/sainte-skyline.json
//
// Saint-Etienne est au fond d'une cuvette : le Pilat au sud-est, les monts du
// Lyonnais au nord-est, les monts du Forez a l'ouest. Cette ligne d'horizon est
// ce qui fait reconnaitre la ville de nuit, bien plus qu'un ciel generique. On
// ne la dessine donc pas a la main : on la mesure.
//
// Source : les tuiles Terrarium des AWS Terrain Tiles (donnees ouvertes,
// agregat SRTM / EU-DEM / ETOPO), zoom 11, soit environ 55 m par pixel. Pour
// chaque azimut (tous les 0,5 degre) on lance un rayon depuis le centre-ville et
// on garde l'angle d'elevation maximal, en deux bandes :
//   - proche, de 2,5 a 9 km : les collines qui ferment la cuvette ;
//   - lointaine, de 9 a 60 km : les massifs, plus pales derriere.
// La courbure terrestre est retiree, refraction comprise (coefficient 0,13).
// Le jeu n'appelle rien au runtime : il lit le JSON genere, quelques ko.

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/sainte-skyline.json");

// meme centre que la deduction des hauteurs (src/lib/buildings.ts)
const CENTRE = { lon: 4.39, lat: 45.4397 };
const EYE = 12; // metres au dessus du sol : la camera de poursuite
const ZOOM = 11;
const STEP_DEG = 0.5;
const NEAR = [2500, 9000];
const FAR = [9000, 60000];
const EARTH_R = 6371000;
const REFRACTION = 0.13;

// --- PNG minimal : 8 bits RGB ou RGBA, non entrelace (ce que servent les tuiles)
function decodePng(buf) {
  let p = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      if (depth !== 8 || (color !== 2 && color !== 6) || data[12] !== 0) {
        throw new Error(`PNG non gere : profondeur ${depth}, couleur ${color}`);
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

// --- tuiles -------------------------------------------------------------------
const tiles = new Map();

async function tile(tx, ty) {
  const key = `${tx}/${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const png = decodePng(Buffer.from(await res.arrayBuffer()));
      tiles.set(key, png);
      return png;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url} : ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

function worldPx(lon, lat) {
  const n = 256 * 2 ** ZOOM;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

function heightAt(px, py) {
  // plus proche voisin : 55 m de pas suffisent pour une crete a 10 km
  const tx = Math.floor(px / 256);
  const ty = Math.floor(py / 256);
  const t = tiles.get(`${tx}/${ty}`);
  const x = Math.floor(px) - tx * 256;
  const y = Math.floor(py) - ty * 256;
  const o = (y * t.width + x) * t.channels;
  return t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768;
}

// metres -> degres autour du centre (equirectangulaire locale, comme le jeu)
const K = Math.cos((CENTRE.lat * Math.PI) / 180);
function lonLatAt(east, north) {
  return {
    lon: CENTRE.lon + (east / (111320 * K)),
    lat: CENTRE.lat + north / 110574,
  };
}

// precharge toutes les tuiles touchees par le disque de 60 km
const c0 = worldPx(CENTRE.lon, CENTRE.lat);
const corner = lonLatAt(FAR[1], FAR[1]);
const c1 = worldPx(corner.lon, corner.lat);
const spanX = Math.ceil(Math.abs(c1.x - c0.x) / 256) + 1;
const spanY = Math.ceil(Math.abs(c1.y - c0.y) / 256) + 1;
const ctx = Math.floor(c0.x / 256);
const cty = Math.floor(c0.y / 256);
const jobs = [];
for (let dx = -spanX; dx <= spanX; dx++) {
  for (let dy = -spanY; dy <= spanY; dy++) jobs.push([ctx + dx, cty + dy]);
}
console.log(`${jobs.length} tuiles Terrarium z${ZOOM}...`);
for (let i = 0; i < jobs.length; i += 8) {
  await Promise.all(jobs.slice(i, i + 8).map(([x, y]) => tile(x, y)));
}

const h0 = heightAt(c0.x, c0.y) + EYE;
console.log(`sol au centre : ${Math.round(h0 - EYE)} m`);

function sweep(az, [d0, d1]) {
  // az : 0 = nord, sens horaire (est = 90)
  const ex = Math.sin((az * Math.PI) / 180);
  const ny = Math.cos((az * Math.PI) / 180);
  let best = -90;
  let bestD = 0;
  for (let d = d0; d <= d1; d += 50) {
    const ll = lonLatAt(ex * d, ny * d);
    const p = worldPx(ll.lon, ll.lat);
    const drop = ((d * d) / (2 * EARTH_R)) * (1 - REFRACTION);
    const a = (Math.atan2(heightAt(p.x, p.y) - drop - h0, d) * 180) / Math.PI;
    if (a > best) {
      best = a;
      bestD = d;
    }
  }
  return [best, bestD];
}

const near = [];
const far = [];
let peak = { a: -90, az: 0, d: 0 };
for (let az = 0; az < 360; az += STEP_DEG) {
  const [an] = sweep(az, NEAR);
  const [af, df] = sweep(az, FAR);
  near.push(Math.round(an * 100) / 100);
  far.push(Math.round(af * 100) / 100);
  if (af > peak.a) peak = { a: af, az, d: df };
}
console.log(
  `crete lointaine la plus haute : ${peak.a.toFixed(2)} deg, azimut ${peak.az} deg, a ${(peak.d / 1000).toFixed(1)} km`,
);

await writeFile(
  OUT,
  JSON.stringify({
    source: "AWS Terrain Tiles (Terrarium), SRTM / EU-DEM / ETOPO",
    centre: CENTRE,
    step: STEP_DEG,
    azimuth: "0 = nord, sens horaire",
    near,
    far,
  }),
);
console.log(`ecrit ${OUT}`);
