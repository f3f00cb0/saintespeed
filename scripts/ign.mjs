// BD TOPO de l'IGN : les vraies hauteurs, matieres, toitures et dates des
// batiments, jointes aux emprises OSM.
//
// Pourquoi une deuxieme source. OSM porte une hauteur sur 0,05 % des batiments
// de Saint-Etienne et un nombre de niveaux sur 10,9 % : tout le reste est
// infere (src/lib/buildings.ts). L'inference est calee sur des medianes, elle
// donne donc une ville plausible mais moyenne, ou toutes les silhouettes se
// ressemblent. La BD TOPO, elle, porte pour chaque batiment de France :
//
//   hauteur                   hauteur mesuree par photogrammetrie, du sol a la
//                             gouttiere (la naissance du toit)
//   altitude_minimale_toit /  l'ecart des deux donne la hauteur de la toiture
//   altitude_maximale_toit    elle-meme, donc sa pente reelle
//   nombre_d_etages           issu des fichiers fonciers
//   materiaux_des_murs        codes fonciers : 1 pierre, 2 meuliere, 3 beton,
//                             4 briques, 5 agglomere, 6 bois, 9 autres
//   materiaux_de_la_toiture   1 tuiles, 2 ardoises, 3 zinc alu, 4 beton
//   usage_1                   Residentiel, Industriel, Religieux...
//   date_d_apparition         annee de construction quand elle est connue
//
// Licence Ouverte Etalab 2.0 : la reutilisation est libre, sous reserve de
// citer la source ("IGN - BD TOPO").
//
// Le service est le WFS de la Geoplateforme, sans cle. Ce module ne fait que
// deux choses, testables separement : telecharger les emprises (fetchBdTopo)
// et les joindre au JSON compact des batiments OSM (joinIgn).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IGN_ATTRIBUTION = "IGN - BD TOPO, Licence Ouverte Etalab 2.0";

/** Telechargement brut, hors depot (voir .gitignore). */
export const IGN_CACHE = resolve(dirname(fileURLToPath(import.meta.url)), "../data/ign-batiments.json");

const WFS = "https://data.geopf.fr/wfs/ows";
const LAYER = "BDTOPO_V3:batiment";
// Plafond de page du service. Au dela, il tronque sans prevenir.
const PAGE = 5000;
const UA = "saintespeed/0.1 (jeu de course, jointure BD TOPO; contact via github)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitBBox(b, n) {
  const out = [];
  const dLat = (b[2] - b[0]) / n;
  const dLon = (b[3] - b[1]) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push([b[0] + i * dLat, b[1] + j * dLon, b[0] + (i + 1) * dLat, b[1] + (j + 1) * dLon]);
    }
  }
  return out;
}

async function getPage(box, start) {
  // WFS 2.0 en EPSG:4326 : la bbox est en latitude, longitude.
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: LAYER,
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:4326",
    BBOX: `${box[0]},${box[1]},${box[2]},${box[3]},urn:ogc:def:crs:EPSG::4326`,
    COUNT: String(PAGE),
    STARTINDEX: String(start),
  });
  const url = `${WFS}?${params}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return await res.json();
      console.warn(`    WFS ${res.status}, nouvel essai`);
    } catch (err) {
      console.warn(`    WFS injoignable (${err.cause?.code ?? err.message}), nouvel essai`);
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`WFS BD TOPO injoignable apres 5 essais : ${url}`);
}

/**
 * Toutes les emprises BD TOPO de la bbox [sud, ouest, nord, est], paginees et
 * dedupliquees sur leur identifiant (cleabs). La bbox est decoupee en cases :
 * une pagination profonde sur une seule requete ralentit fort cote serveur.
 */
export async function fetchBdTopo(bbox, split = 4) {
  const seen = new Map();
  const boxes = splitBBox(bbox, split);
  for (let i = 0; i < boxes.length; i++) {
    let start = 0;
    for (;;) {
      const page = await getPage(boxes[i], start);
      const feats = page.features ?? [];
      for (const f of feats) {
        const id = f.properties?.cleabs ?? f.id;
        if (!seen.has(id)) seen.set(id, f);
      }
      console.log(`    case ${i + 1}/${boxes.length}, depart ${start} : ${feats.length} emprises, ${seen.size} cumulees`);
      if (feats.length < PAGE) break;
      start += PAGE;
    }
  }
  return [...seen.values()];
}

// --- lecture des attributs ---------------------------------------------------

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Premier chiffre non nul d'un code foncier ("14" -> 1, "00" -> null). */
export function materialCode(v) {
  if (v === null || v === undefined) return null;
  for (const c of String(v)) {
    const d = c.charCodeAt(0) - 48;
    if (d >= 1 && d <= 9) return d;
  }
  return null;
}

const USAGES = [
  [/^r[ée]sidentiel/i, "r"],
  [/^commercial/i, "c"],
  [/^industriel/i, "i"],
  [/^religieux/i, "g"],
  [/^sportif/i, "s"],
  [/^agricole/i, "x"],
  [/^annexe/i, "a"],
];

export function usageCode(v) {
  if (!v) return null;
  for (const [re, c] of USAGES) if (re.test(String(v))) return c;
  return null;
}

/** Annee de construction, quel que soit le nom de champ de la version servie. */
export function yearOf(p) {
  const now = new Date().getFullYear();
  for (const k of ["date_de_construction", "annee_de_construction", "date_d_apparition"]) {
    const m = /(\d{4})/.exec(String(p[k] ?? ""));
    if (!m) continue;
    const y = Number(m[1]);
    if (y >= 1500 && y <= now) return y;
  }
  return null;
}

/**
 * Ce qu'on garde d'une emprise BD TOPO, en cles courtes : c'est ce qui finira
 * dans le JSON servi au navigateur.
 *   ih hauteur a la gouttiere (m)     il etages
 *   ir hauteur de toiture (m)         iy annee
 *   im murs (code foncier)            it toiture (code foncier)
 *   iu usage (r c i g s x a)
 */
export function ignAttributes(p) {
  const out = {};
  const h = num(p.hauteur);
  if (h !== null && h >= 2 && h <= 250) out.ih = Math.round(h * 10) / 10;
  const et = num(p.nombre_d_etages);
  if (et !== null && et >= 1 && et <= 80) out.il = Math.round(et);
  const zMin = num(p.altitude_minimale_toit);
  const zMax = num(p.altitude_maximale_toit);
  if (zMin !== null && zMax !== null && zMax >= zMin) {
    const r = zMax - zMin;
    // au dela de 15 m ce n'est plus une toiture, c'est un defaut de saisie ou un
    // edicule mal rattache
    if (r <= 15) out.ir = Math.round(r * 10) / 10;
  }
  const y = yearOf(p);
  if (y !== null) out.iy = y;
  const m = materialCode(p.materiaux_des_murs);
  if (m !== null) out.im = m;
  const t = materialCode(p.materiaux_de_la_toiture);
  if (t !== null) out.it = t;
  const u = usageCode(p.usage_1);
  if (u !== null) out.iu = u;
  return out;
}

// --- geometrie ---------------------------------------------------------------

const R = 6378137;
const D2R = Math.PI / 180;

function makeProj(lat0) {
  const k = Math.cos(lat0 * D2R);
  return (lon, lat) => ({ x: lon * D2R * R * k, y: lat * D2R * R });
}

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Anneaux exterieurs d'une geometrie GeoJSON, en [lon, lat]. Le service peut
 * rendre l'ordre latitude, longitude en EPSG:4326 : on le detecte sur la
 * premiere coordonnee plutot que de le supposer (la France est entre -5 et 10
 * de longitude, 41 et 52 de latitude, les deux plages ne se recouvrent pas).
 */
function outerRings(geom) {
  if (!geom) return [];
  const polys =
    geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  const rings = [];
  for (const poly of polys) {
    const outer = poly?.[0];
    if (!outer || outer.length < 4) continue;
    const swap = Math.abs(outer[0][0]) > 30;
    rings.push(outer.map((c) => (swap ? [c[1], c[0]] : [c[0], c[1]])));
  }
  return rings;
}

// Points d'echantillon d'une emprise OSM : son centre, et chaque sommet tire a
// 35 % vers le centre. Un batiment OSM et un batiment cadastral ne sont pas
// decoupes pareil ; un vote sur l'emprise entiere resiste a ca bien mieux que
// le seul centroide, qui tombe dans la cour d'une emprise en U.
function samples(ring) {
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const out = [{ x: cx, y: cy }];
  const step = Math.max(1, Math.floor(ring.length / 16));
  for (let i = 0; i < ring.length; i += step) {
    const p = ring[i];
    out.push({ x: p.x + (cx - p.x) * 0.35, y: p.y + (cy - p.y) * 0.35 });
  }
  return out;
}

/** Part des echantillons qui doivent tomber dans l'emprise gagnante. */
const MIN_VOTE = 0.4;
const CELL = 50;

/**
 * Pose les attributs BD TOPO sur les batiments du JSON compact OSM (mutation en
 * place). Chaque emprise OSM prend l'emprise BD TOPO qui recouvre le plus de
 * ses points d'echantillon, a condition qu'elle en recouvre au moins 40 %.
 * Renvoie les compteurs, pour le journal.
 */
export function joinIgn(buildings, features, lat0) {
  const proj = makeProj(lat0);

  // index en grille des emprises BD TOPO
  const polys = [];
  const grid = new Map();
  const key = (i, j) => `${i}:${j}`;
  for (const f of features) {
    const attrs = ignAttributes(f.properties ?? {});
    if (!Object.keys(attrs).length) continue;
    for (const lonlat of outerRings(f.geometry)) {
      const ring = lonlat.map(([lon, lat]) => proj(lon, lat));
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of ring) {
        if (p.x < minx) minx = p.x;
        if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y;
        if (p.y > maxy) maxy = p.y;
      }
      const idx = polys.length;
      polys.push({ ring, minx, miny, maxx, maxy, attrs });
      for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++) {
        for (let j = Math.floor(miny / CELL); j <= Math.floor(maxy / CELL); j++) {
          const k = key(i, j);
          let bucket = grid.get(k);
          if (!bucket) grid.set(k, (bucket = []));
          bucket.push(idx);
        }
      }
    }
  }

  const hit = (p) => {
    const bucket = grid.get(key(Math.floor(p.x / CELL), Math.floor(p.y / CELL)));
    if (!bucket) return -1;
    for (const idx of bucket) {
      const q = polys[idx];
      if (p.x < q.minx || p.x > q.maxx || p.y < q.miny || p.y > q.maxy) continue;
      if (pointInRing(p.x, p.y, q.ring)) return idx;
    }
    return -1;
  };

  const stats = { polygons: polys.length, joined: 0, height: 0, material: 0, roof: 0, year: 0 };
  for (const b of buildings) {
    // on repart de zero : une jointure relancee ne doit pas garder d'anciens
    // attributs qu'aucune emprise ne porte plus
    for (const k of ["ih", "il", "ir", "iy", "im", "it", "iu"]) delete b[k];

    const ring = b.g.map(([lon, lat]) => proj(lon, lat));
    const pts = samples(ring);
    const votes = new Map();
    for (const p of pts) {
      const idx = hit(p);
      if (idx >= 0) votes.set(idx, (votes.get(idx) ?? 0) + 1);
    }
    let best = -1;
    let bestN = 0;
    for (const [idx, n] of votes) {
      if (n > bestN) {
        best = idx;
        bestN = n;
      }
    }
    if (best < 0 || bestN < pts.length * MIN_VOTE) continue;

    Object.assign(b, polys[best].attrs);
    stats.joined++;
    if (b.ih !== undefined) stats.height++;
    if (b.im !== undefined) stats.material++;
    if (b.it !== undefined) stats.roof++;
    if (b.iy !== undefined) stats.year++;
  }
  return stats;
}

/**
 * Rejoue la jointure depuis le cache s'il existe, sur un JSON compact tout
 * juste regenere par fetch-osm. Renvoie null sans cache : les batiments
 * restent alors sur l'inference, comme avant.
 */
export function joinIgnFromCache(data) {
  if (!existsSync(IGN_CACHE)) return null;
  const { features } = JSON.parse(readFileSync(IGN_CACHE, "utf8"));
  const [w, s, e, n] = data.bbox;
  const stats = joinIgn(data.buildings, features, (s + n) / 2);
  data.ign = IGN_ATTRIBUTION;
  return stats;
}
