#!/usr/bin/env node
// Bake le MNT IGN RGE ALTI sur la bbox du jeu, dans le meme repere que le graphe.
//   npm run fetch-elev
//   node scripts/fetch-elev.mjs --eternite-only   # reprofile le spawn sans rebaker la grille
//
// Sans ca le proto de relief n'a rien a echantillonner. OSM `ele` est trop
// creux, SRTM trop grossier pour la rue de l'Eternite. IGN 5 m, licence Etalab.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUBLIC = resolve(ROOT, "public");
const GEO = resolve(PUBLIC, "sainte.geojson");

const IGN = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const RESOURCE = "ign_rge_alti_wld";
const STEP = 16; // metres : assez fin pour une rue courte et raide
const BATCH = 1000;
const EARTH_R = 6378137;
const D2R = Math.PI / 180;

function makeProjector(lon0, lat0) {
  const k = Math.cos(lat0 * D2R);
  return {
    lon0,
    lat0,
    project(lon, lat) {
      return {
        x: (lon - lon0) * D2R * k * EARTH_R,
        y: (lat - lat0) * D2R * EARTH_R,
      };
    },
    unproject(x, y) {
      return {
        lon: x / (D2R * k * EARTH_R) + lon0,
        lat: y / (D2R * EARTH_R) + lat0,
      };
    },
  };
}

function parseWays(data) {
  const ways = [];
  const feats = data.features || [];
  for (const f of feats) {
    const g = f.geometry;
    const p = f.properties || {};
    if (!g) continue;
    const name = p.name || p.n;
    const type = p.highway || p.type;
    if (g.type === "LineString") ways.push({ name, type, pts: g.coordinates });
    else if (g.type === "MultiLineString") {
      for (const c of g.coordinates) ways.push({ name, type, pts: c });
    }
  }
  return ways.filter((w) => w.pts && w.pts.length >= 2);
}

function fold(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, " ");
}

async function ignElev(lons, lats) {
  const payload = JSON.stringify({
    lon: lons.join("|"),
    lat: lats.join("|"),
    zonly: "true",
    resource: RESOURCE,
    delimiter: "|",
    indent: "false",
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(IGN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      console.warn(`  IGN ${res.status}, retry ${attempt + 1}`);
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`IGN HTTP ${res.status} ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const raw = json.elevations ?? json.z ?? json;
    const zs = Array.isArray(raw) ? raw.map((e) => (typeof e === "number" ? e : e.z)) : [];
    if (zs.length !== lons.length) throw new Error(`IGN a renvoye ${zs.length} z pour ${lons.length} points`);
    return zs.map((z) => (z == null || z < -1000 ? NaN : z));
  }
  throw new Error("IGN injoignable apres retries");
}

async function fill(lons, lats) {
  const out = new Array(lons.length);
  for (let i = 0; i < lons.length; i += BATCH) {
    const a = lons.slice(i, i + BATCH);
    const b = lats.slice(i, i + BATCH);
    const z = await ignElev(a, b);
    for (let k = 0; k < z.length; k++) out[i + k] = z[k];
    const n = Math.min(i + BATCH, lons.length);
    if (n % 4000 < BATCH || n === lons.length) {
      process.stdout.write(`  ${n}/${lons.length}\n`);
    }
  }
  return out;
}

function resampleLonLat(pts, step, projector) {
  const P = pts.map(([lon, lat]) => ({ ...projector.project(lon, lat), lon, lat }));
  const out = [{ lon: P[0].lon, lat: P[0].lat }];
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    acc += len;
    while (acc >= step) {
      acc -= step;
      const t = 1 - acc / len;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const ll = projector.unproject(x, y);
      out.push({ lon: ll.lon, lat: ll.lat });
    }
    out.push({ lon: b.lon, lat: b.lat });
  }
  return out;
}

/** Distance 2D en metres entre deux [lon, lat]. */
function distM(a, b, projector) {
  const pa = projector.project(a[0], a[1]);
  const pb = projector.project(b[0], b[1]);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/** Clusterise des polylignes si un bout est a moins de `joinM` d'un autre. */
function clusterWays(ways, projector, joinM = 80) {
  const n = ways.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = ways.map((w) => [w.pts[0], w.pts[w.pts.length - 1]]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = Infinity;
      for (const a of ends[i]) for (const b of ends[j]) d = Math.min(d, distM(a, b, projector));
      if (d <= joinM) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(ways[i]);
  }
  return [...groups.values()];
}

/**
 * Recoud un cluster en partant du bout le plus au sud (cote ville pour le
 * Cret de Roc). OSM coupe la rue en plusieurs ways.
 */
function stitchFromSouth(ways, projector, joinM = 25) {
  const segs = ways.map((w) => w.pts);
  let start = 0;
  let reverse = false;
  let minLat = Infinity;
  segs.forEach((pts, i) => {
    if (pts[0][1] < minLat) {
      minLat = pts[0][1];
      start = i;
      reverse = false;
    }
    const last = pts[pts.length - 1];
    if (last[1] < minLat) {
      minLat = last[1];
      start = i;
      reverse = true;
    }
  });
  const used = new Set([start]);
  const line = reverse ? segs[start].slice().reverse() : segs[start].slice();
  while (used.size < segs.length) {
    const tip = line[line.length - 1];
    let best = -1;
    let bestD = Infinity;
    let flip = false;
    segs.forEach((pts, i) => {
      if (used.has(i)) return;
      const d0 = distM(pts[0], tip, projector);
      const d1 = distM(pts[pts.length - 1], tip, projector);
      if (d0 < bestD) {
        bestD = d0;
        best = i;
        flip = false;
      }
      if (d1 < bestD) {
        bestD = d1;
        best = i;
        flip = true;
      }
    });
    if (best < 0 || bestD > joinM) break;
    used.add(best);
    const extra = flip ? segs[best].slice().reverse() : segs[best].slice();
    if (bestD < 2) extra.shift();
    line.push(...extra);
  }
  return line;
}

/**
 * OSM a deux rues de l'Eternite. On prend le cluster du Cret de Roc
 * (vers 4.390 / 45.443), pas la voie du sud (45.404).
 */
function pickEterniteLine(allWays, projector) {
  const named = allWays.filter((w) => fold(w.name).includes("eternite"));
  if (!named.length) return [];
  const clusters = clusterWays(named, projector);
  const CRET = { lon: 4.39, lat: 45.443 };
  let best = clusters[0];
  let bestD = Infinity;
  for (const c of clusters) {
    let slon = 0;
    let slat = 0;
    let n = 0;
    for (const w of c) {
      for (const p of w.pts) {
        slon += p[0];
        slat += p[1];
        n++;
      }
    }
    const d = distM([slon / n, slat / n], [CRET.lon, CRET.lat], projector);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return stitchFromSouth(best, projector);
}

const eterniteOnly = process.argv.includes("--eternite-only");

const ways = parseWays(JSON.parse(readFileSync(GEO, "utf8")));
let sx = 0, sy = 0, n = 0;
for (const w of ways) for (const p of w.pts) { sx += p[0]; sy += p[1]; n++; }
const proj = makeProjector(sx / n, sy / n);
console.log(`projecteur : lon0=${proj.lon0.toFixed(5)} lat0=${proj.lat0.toFixed(5)}  (${n} sommets)`);

const eternitePts = pickEterniteLine(ways, proj);
if (!eternitePts.length) {
  console.warn("Rue de l'Eternite absente du geojson — spawn au centre");
} else {
  const a = eternitePts[0];
  const b = eternitePts[eternitePts.length - 1];
  console.log(
    `Eternite Cret de Roc : ${eternitePts.length} sommets, ` +
      `sud ${a[1].toFixed(5)},${a[0].toFixed(5)} → nord ${b[1].toFixed(5)},${b[0].toFixed(5)}`,
  );
}

let eternite = null;
if (eternitePts.length >= 2) {
  const line = resampleLonLat(eternitePts, 8, proj);
  const elons = line.map((p) => p.lon);
  const elats = line.map((p) => p.lat);
  console.log(`profil Rue de l'Eternite : ${line.length} points`);
  const ez = await fill(elons, elats);
  // La montee historique : du sud (ville) jusqu'a la crete. Le nord redescend.
  const hi = ez.reduce((k, z, i) => (z > ez[k] ? i : k), 0);
  const spawnAlong = 12; // un peu dans la rue, pas sur le carrefour
  let acc = 0;
  let spawnI = 0;
  for (let i = 1; i < line.length; i++) {
    const a = proj.project(line[i - 1].lon, line[i - 1].lat);
    const b = proj.project(line[i].lon, line[i].lat);
    acc += Math.hypot(b.x - a.x, b.y - a.y);
    spawnI = i;
    if (acc >= spawnAlong) break;
  }
  let run = 0;
  let gMax = 0;
  for (let i = 1; i <= hi; i++) {
    const a = proj.project(line[i - 1].lon, line[i - 1].lat);
    const b = proj.project(line[i].lon, line[i].lat);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const dz = ez[i] - ez[i - 1];
    run += d;
    if (d > 1) gMax = Math.max(gMax, Math.abs(dz) / d);
  }
  const look = Math.min(line.length - 1, spawnI + 4);
  const pb = proj.project(line[spawnI].lon, line[spawnI].lat);
  const pl = proj.project(line[look].lon, line[look].lat);
  const heading = Math.atan2(pl.y - pb.y, pl.x - pb.x);
  const top = line[hi];
  const pt = proj.project(top.lon, top.lat);
  eternite = {
    bottom: {
      lon: line[spawnI].lon,
      lat: line[spawnI].lat,
      x: pb.x,
      y: pb.y,
      z: ez[spawnI],
      heading,
    },
    top: { lon: top.lon, lat: top.lat, x: pt.x, y: pt.y, z: ez[hi] },
    len: run,
    rise: ez[hi] - ez[0],
    gradeMean: run > 0 ? (ez[hi] - ez[0]) / run : 0,
    gradeMax: gMax,
  };
  console.log(
    `Eternite : ${run.toFixed(0)} m, +${(ez[hi] - ez[0]).toFixed(1)} m, ` +
      `pente moyenne ${(eternite.gradeMean * 100).toFixed(1)} %, max ${(gMax * 100).toFixed(1)} %`,
  );
}

if (eterniteOnly) {
  const metaPath = resolve(PUBLIC, "sainte-elev.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  meta.eternite = eternite;
  writeFileSync(metaPath, JSON.stringify(meta));
  console.log("mis a jour public/sainte-elev.json (eternite seulement)");
  process.exit(0);
}

const BBOX = [45.38, 4.33, 45.49, 4.44]; // sud, ouest, nord, est — meme que osm.ts
const sw = proj.project(BBOX[1], BBOX[0]);
const ne = proj.project(BBOX[3], BBOX[2]);
const pad = 80;
const x0 = Math.floor((Math.min(sw.x, ne.x) - pad) / STEP) * STEP;
const y0 = Math.floor((Math.min(sw.y, ne.y) - pad) / STEP) * STEP;
const x1 = Math.ceil((Math.max(sw.x, ne.x) + pad) / STEP) * STEP;
const y1 = Math.ceil((Math.max(sw.y, ne.y) + pad) / STEP) * STEP;
const nx = Math.round((x1 - x0) / STEP) + 1;
const ny = Math.round((y1 - y0) / STEP) + 1;
console.log(`grille ${nx} x ${ny} = ${nx * ny} points, pas ${STEP} m`);

const lons = [];
const lats = [];
for (let j = 0; j < ny; j++) {
  for (let i = 0; i < nx; i++) {
    const ll = proj.unproject(x0 + i * STEP, y0 + j * STEP);
    lons.push(+ll.lon.toFixed(7));
    lats.push(+ll.lat.toFixed(7));
  }
}

console.log("IGN RGE ALTI…");
const zs = await fill(lons, lats);

let zMin = Infinity, zMax = -Infinity, holes = 0;
for (const z of zs) {
  if (!Number.isFinite(z)) { holes++; continue; }
  if (z < zMin) zMin = z;
  if (z > zMax) zMax = z;
}
if (!Number.isFinite(zMin)) throw new Error("MNT vide");
console.log(`z ${zMin.toFixed(1)} .. ${zMax.toFixed(1)} m  (Δ ${(zMax - zMin).toFixed(1)} m), ${holes} trous`);

for (let i = 0; i < zs.length; i++) {
  if (Number.isFinite(zs[i])) continue;
  const x = i % nx;
  const y = (i / nx) | 0;
  let found = NaN;
  for (const r of [1, 2, 3, 5]) {
    for (let dy = -r; dy <= r && !Number.isFinite(found); dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const v = zs[yy * nx + xx];
        if (Number.isFinite(v)) { found = v; break; }
      }
    }
    if (Number.isFinite(found)) break;
  }
  zs[i] = Number.isFinite(found) ? found : zMin;
}

const q = 0.05;
const buf = Buffer.alloc(nx * ny * 2);
for (let i = 0; i < zs.length; i++) {
  const v = Math.round((zs[i] - zMin) / q);
  buf.writeUInt16LE(Math.max(0, Math.min(65535, v)), i * 2);
}

mkdirSync(PUBLIC, { recursive: true });
writeFileSync(resolve(PUBLIC, "sainte-elev.bin"), buf);
writeFileSync(
  resolve(PUBLIC, "sainte-elev.json"),
  JSON.stringify({
    src: "IGN RGE ALTI (geoplateforme)",
    license: "Etalab 2.0",
    lon0: proj.lon0,
    lat0: proj.lat0,
    x0,
    y0,
    dx: STEP,
    dy: STEP,
    nx,
    ny,
    zMin,
    zMax,
    q,
    eternite,
  }),
);
console.log(`ecrit public/sainte-elev.bin (${(buf.length / 1e6).toFixed(2)} Mo) + sainte-elev.json`);
