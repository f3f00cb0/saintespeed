#!/usr/bin/env node
// Extrait de export.geojson la table des batiments notables, et l'ecrit en
// module TypeScript versionne (src/lib/notable.ts).
//
//   npm run build-notable
//
// Pourquoi un fichier a part du cache batiments : export.geojson est un export
// Overpass Turbo curate (patrimoine, culte, tourisme, memoire) qui ne porte
// AUCUNE geometrie utile. Ses building:levels et roof:shape sont deja dans
// public/sainte-buildings.json, au champ pres. Ce qu'il apporte et que le cache
// n'a pas, c'est un signal de NOTABILITE : quel batiment est un lieu de culte,
// lequel est classe monument historique, comment il s'appelle. C'est ce signal
// qui decide quelle famille de kit se pose sur une emprise (src/lib/families.ts).
//
// Le fichier genere est petit (quelques ko) et deterministe : on le commite,
// comme le reste des donnees derivees, pour ne pas dependre d'Overpass au build.
// Donnees OpenStreetMap sous ODbL.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "export.geojson");
const OUT = resolve(ROOT, "src/lib/notable.ts");
const OUT_POINTS = resolve(ROOT, "src/lib/monumentPoints.ts");
const FEATURES = resolve(ROOT, "public/sainte-features.json");
const ROADS = resolve(ROOT, "public/sainte.geojson");
const CACHE = resolve(ROOT, "public/sainte-buildings.json");

// Les contours issus de relations portent leur id en negatif dans le cache,
// meme convention que scripts/fetch-osm.mjs.
function osmId(featureId) {
  const [type, id] = featureId.split("/");
  if (type === "node") return null;
  return type === "relation" ? -Number(id) : Number(id);
}

const CULTE_BUILDING = /^(church|chapel|cathedral|mosque|synagogue|temple|monastery|shrine)$/;

// --- points d'objet ---------------------------------------------------------
//
// L'export contient 261 points isoles. Tous ne sont pas des objets a dessiner,
// et la difference se mesure plutot qu'elle ne se suppose :
//
//   23 musees et galeries, dont 20 A L'INTERIEUR d'un batiment : ce sont des
//      points d'interet, il n'y a rien a poser dans la rue.
//   18 points de vue : ce n'est pas un objet.
//   17 tombes, dans les cimetieres, une seule a moins de 30 m d'une rue.
//   11 lieux de culte en point, dont 10 dans un batiment : doublon des emprises
//      cultuelles, deja traitees par la famille culte.
//   6 plaques et 5 peintures murales : c'est sur un mur, pas dans l'espace.
//   32 points "autres" qui sont en fait des noms de gare ou de place.
//
// Restent 98 candidats, dont on ne garde que les TYPOLOGIES, c'est-a-dire les
// types ou la forme decoule du type : croix de chemin, monument aux morts,
// stele, buste, statue. Les 40 sculptures contemporaines sont volontairement
// laissees de cote : leur forme est precisement ce qu'une etiquette ne
// determine pas. "Les Femmes Noires" de Ndary Lo ou "Pouet" de Remy Jacquier ne
// se deduisent pas d'un tag, et les inventer serait exactement ce qu'on refuse.
// Elles meritent un traitement individuel, sur source, comme les monuments.
const KINDS = ["croix", "guerre", "stele", "buste", "statue"];

function pointKind(t) {
  if (t.historic === "wayside_cross") return 0;
  if (t.memorial === "war_memorial") return 1;
  if (t.memorial === "stele") return 2;
  if (t.memorial === "bust" || t.artwork_type === "bust") return 3;
  if (t.artwork_type === "statue" || t.memorial === "statue") return 4;
  return -1;
}

// Largeurs de chaussee du rendu, reprises de ROADS dans src/lib/osm.ts. Ce sont
// des conventions de dessin, pas des largeurs relevees : un objet de bord de
// route peut donc se retrouver "sur la chaussee" a dix centimetres pres.
const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7,
  unclassified: 5, residential: 5, living_street: 4,
  motorway_link: 8, trunk_link: 8, primary_link: 7, secondary_link: 6, tertiary_link: 5,
};

/** Projection metrique locale, suffisante pour des tests de distance. */
function makeProjLocal(lat0, lon0) {
  const D = Math.PI / 180;
  const k = Math.cos(lat0 * D);
  const R = 6378137;
  return (lon, lat) => ({ x: (lon - lon0) * D * k * R, y: (lat - lat0) * D * R });
}

function pointInRing(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i].y > y) !== (ring[j].y > y) &&
        x < ((ring[j].x - ring[i].x) * (y - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) ins = !ins;
  }
  return ins;
}

function main(geo) {
  const rows = [];
  let nodes = 0;

  for (const f of geo.features) {
    const id = osmId(f.id);
    if (id === null) {
      nodes++;
      continue;
    }
    const p = f.properties ?? {};

    // Un batiment, ou une emprise cultuelle taguee sans building=* explicite.
    const isBuilding = Boolean(p.building);
    const worship = p.amenity === "place_of_worship" || CULTE_BUILDING.test(p.building ?? "");
    if (!isBuilding && !worship) continue;

    // heritage=* et ref:mhs disent la meme chose sous deux formes ; les deux
    // manquent sur des monuments evidents, d'ou l'union.
    const mh = Boolean(p.heritage || p["ref:mhs"] || p["mhs:inscription_date"]);
    const religion = p.religion ?? (worship ? "unknown" : undefined);
    const name = p.name ?? p.alt_name ?? "";

    if (!mh && !religion && !name) continue; // rien a apporter au jeu

    rows.push({ id, name, religion, worship, mh });
  }

  rows.sort((a, b) => a.id - b.id);
  return { rows, nodes };
}

const geo = JSON.parse(await readFile(SRC, "utf8"));
const { rows, nodes } = main(geo);

// Controle : combien de ces emprises existent vraiment dans le cache du jeu.
// Purement informatif, la table n'est pas filtree dessus (le cache peut etre
// regenere sur une autre bbox).
let matched = "non verifie (cache absent)";
try {
  const cache = JSON.parse(await readFile(CACHE, "utf8"));
  const ids = new Set(cache.buildings.map((b) => b.i));
  matched = `${rows.filter((r) => ids.has(r.id)).length} / ${rows.length}`;
} catch {
  /* le cache n'est pas indispensable pour generer */
}

const flags = (r) => (r.mh ? 1 : 0) | (r.worship ? 2 : 0);
const esc = (s) => JSON.stringify(s);

const body = rows
  .map((r) => `  [${r.id}, ${esc(r.name)}, ${flags(r)}, ${r.religion ? esc(r.religion) : "0"}],`)
  .join("\n");

const out = `// GENERE par scripts/build-notable.mjs depuis export.geojson. Ne pas editer a
// la main : relancer \`npm run build-notable\`.
//
// Ce que la table apporte, et que public/sainte-buildings.json n'a pas : quel
// batiment est un lieu de culte, lequel est classe monument historique, et son
// nom. Les niveaux et les formes de toit du meme export sont deja dans le
// cache, ils ne sont donc pas repris ici.
//
// ${rows.length} emprises notables (${matched} presentes dans le cache courant),
// ${nodes} points isoles de l'export ignores (statues, stèles, croix : ils
// relevent d'une couche d'objets, pas des emprises).
//
// Donnees OpenStreetMap sous ODbL.

export type Notable = {
  /** Nom OSM, vide si l'emprise n'en porte pas. */
  name: string;
  /** Monument historique (heritage=* ou ref:mhs). */
  mh: boolean;
  /** Lieu de culte (building cultuel ou amenity=place_of_worship). */
  worship: boolean;
  /** religion=*, "unknown" si le tag manque sur un lieu de culte avere. */
  religion?: string;
};

// [id OSM, nom, drapeaux (1 = MH, 2 = culte), religion ou 0]
const RAW: [number, string, number, string | 0][] = [
${body}
];

export const NOTABLE: Map<number, Notable> = new Map(
  RAW.map(([id, name, f, religion]) => [
    id,
    { name, mh: (f & 1) !== 0, worship: (f & 2) !== 0, religion: religion || undefined },
  ]),
);
`;

await writeFile(OUT, out);

// --- points d'objet : filtre mesure, puis module genere ---------------------
const pj = makeProjLocal(45.4397, 4.39);
let buildings = [];
let cemeteries = [];
let roadSegs = [];
try {
  const cache = JSON.parse(await readFile(CACHE, "utf8"));
  buildings = cache.buildings.map((b) => b.g.map(([lon, lat]) => pj(lon, lat)));
  const feats = JSON.parse(await readFile(FEATURES, "utf8"));
  cemeteries = feats.areas.filter((a) => a.k === "cemetery").map((a) => a.g.map(([lon, lat]) => pj(lon, lat)));
  const rd = JSON.parse(await readFile(ROADS, "utf8"));
  for (const f of rd.features) {
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const hw = (ROAD_WIDTH[f.properties?.highway] ?? 4) / 2;
    for (let i = 1; i < c.length; i++) {
      roadSegs.push([pj(c[i - 1][0], c[i - 1][1]), pj(c[i][0], c[i][1]), hw]);
    }
  }
} catch (err) {
  console.warn("caches absents, le filtre des points ne peut pas tourner", err.message);
}

const CELL = 60;
const bGrid = new Map();
for (const ring of buildings) {
  const c = ring[0];
  const k = `${Math.floor(c.x / CELL)}:${Math.floor(c.y / CELL)}`;
  let l = bGrid.get(k);
  if (!l) bGrid.set(k, (l = []));
  l.push(ring);
}
const rGrid = new Map();
for (const s2 of roadSegs) {
  const k = `${Math.floor(s2[0].x / CELL)}:${Math.floor(s2[0].y / CELL)}`;
  let l = rGrid.get(k);
  if (!l) rGrid.set(k, (l = []));
  l.push(s2);
}
/** Distance a la chaussee la plus proche : negative si on est dessus. */
const roadClearance = (x, y) => {
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
  let best = { d: Infinity, nx: 0, ny: 0 };
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      for (const [a, b, hw] of rGrid.get(`${gx + i}:${gy + j}`) ?? []) {
        const vx = b.x - a.x, vy = b.y - a.y;
        const L2 = vx * vx + vy * vy || 1;
        let t = ((x - a.x) * vx + (y - a.y) * vy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + t * vx, py = a.y + t * vy;
        const d = Math.hypot(x - px, y - py) - hw;
        if (d < best.d) {
          const len = Math.hypot(x - px, y - py) || 1;
          best = { d, nx: (x - px) / len, ny: (y - py) / len };
        }
      }
    }
  }
  return best;
};
const inAnyBuilding = (x, y) => {
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      for (const ring of bGrid.get(`${gx + i}:${gy + j}`) ?? []) if (pointInRing(x, y, ring)) return true;
    }
  }
  return false;
};

// Une oeuvre CONTEMPORAINE ne se deduit d'aucune etiquette, meme quand elle
// porte artwork_type=statue. Le filtre par type seul laissait passer « Les
// Femmes Noires » de Ndary Lo (2005), que le README cite pourtant comme
// l'exemple meme de ce qu'on refuse d'inventer : elle sortait en statue sur
// socle du XIXe. Mesure : 21 des 57 points retenus sont tagues tourism=artwork,
// dont 7 posterieurs a 1950.
//
// La date fait la coupure, et pas l'auteur : une statue academique d'avant
// guerre suit une typologie (buste sur colonne, figure en pied) dont la forme
// decoule vraiment du type ; une oeuvre d'apres 1950 n'en suit aucune.
const CONTEMPORAIN = 1950;
function contemporary(t) {
  if (t.tourism !== "artwork") return false;
  const y = Number(String(t.start_date ?? "").slice(0, 4));
  return Number.isFinite(y) && y >= CONTEMPORAIN;
}

// Objets deja poses par un kit bespoke : les reposer en silhouette generique
// les met en double. La Rubanerie est en haut du perron de l'Hotel de Ville,
// posee par son kit avec La Metallurgie (Etienne Montagny, 1870 et 1872) ;
// seule La Metallurgie echappait au doublon, et par accident, parce que son
// point tombe dans l'emprise.
const DEJA_POSES = new Set(["La Rubanerie", "La Métallurgie"]);

const points = [];
const rejected = { type: 0, bati: 0, cimetiere: 0, loin: 0, chaussee: 0, contemporain: 0, bespoke: 0 };
let nudged = 0;
for (const f of geo.features) {
  if (f.geometry?.type !== "Point" || !String(f.id).startsWith("node/")) continue;
  const t = f.properties ?? {};
  const kind = pointKind(t);
  if (kind < 0) { rejected.type++; continue; }
  if (contemporary(t)) { rejected.contemporain++; continue; }
  if (DEJA_POSES.has(t.name)) { rejected.bespoke++; continue; }
  const [lon, lat] = f.geometry.coordinates;
  const p = pj(lon, lat);
  if (inAnyBuilding(p.x, p.y)) { rejected.bati++; continue; }
  if (cemeteries.some((ring) => pointInRing(p.x, p.y, ring))) { rejected.cimetiere++; continue; }
  const cl = roadClearance(p.x, p.y);
  if (cl.d > 30) { rejected.loin++; continue; }
  // Un objet de bord de route peut tomber DANS la chaussee du jeu, dont la
  // largeur est une convention de dessin. On le pousse perpendiculairement
  // juste ce qu'il faut plutot que de le jeter : c'est sa position qui est
  // juste, c'est notre chaussee qui est large.
  let out = { lon, lat };
  if (cl.d < 0.6) {
    const push = 0.6 - cl.d;
    if (push > 3) { rejected.chaussee++; continue; }
    const D = Math.PI / 180;
    const mPerLon = D * Math.cos(45.4397 * D) * 6378137;
    const mPerLat = D * 6378137;
    out = { lon: lon + (cl.nx * push) / mPerLon, lat: lat + (cl.ny * push) / mPerLat };
    nudged++;
  }
  points.push({ lon: Number(out.lon.toFixed(6)), lat: Number(out.lat.toFixed(6)), kind, name: t.name ?? "" });
}
points.sort((a, b) => a.lat - b.lat || a.lon - b.lon);

const counts = KINDS.map((k, i) => `${k} ${points.filter((p) => p.kind === i).length}`).join(", ");
const bodyPoints = points
  .map((p) => `  [${p.lon}, ${p.lat}, ${p.kind}, ${esc(p.name)}],`)
  .join("\n");

const outPoints = `// GENERE par scripts/build-notable.mjs depuis export.geojson. Ne pas editer a
// la main : relancer \`npm run build-notable\`.
//
// Objets ponctuels de l'espace public : ${points.length} points, ${counts}.
//
// Le filtre est mesure, pas suppose. Sur les 261 points de l'export :
//   ${rejected.contemporain} sont des oeuvres CONTEMPORAINES (posterieures a ${CONTEMPORAIN}) : leur
//      forme ne decoule d'aucune etiquette, meme quand OSM les tague "statue" ;
//   ${rejected.bespoke} sont deja posees par un kit bespoke, les reposer les mettrait en double ;
//   ${rejected.type} sont d'un type dont la forme ne decoule PAS du type (sculptures
//      contemporaines, oeuvres, plaques, peintures murales), ou ne sont pas des
//      objets du tout (points de vue, noms de gare et de place, musees) ;
//   ${rejected.bati} tombent DANS un batiment : ce sont des points d'interet
//      d'interieur, il n'y a rien a poser dans la rue ;
//   ${rejected.cimetiere} sont dans un cimetiere ;
//   ${rejected.loin} sont a plus de 30 m de toute chaussee, donc invisibles depuis la
//      voiture ;
//   ${rejected.chaussee} tombent en pleine chaussee et ne peuvent pas en etre sortis.
//
// ${nudged} objets ont ete pousses perpendiculairement hors de la chaussee, de moins
// de 3 m : leur position OSM est juste, c'est la largeur de chaussee du rendu
// qui est une convention.
//
// Donnees OpenStreetMap sous ODbL.

/** Typologies ou la forme decoule du type. */
export const enum PointKind {
  Croix = 0,
  Guerre = 1,
  Stele = 2,
  Buste = 3,
  Statue = 4,
}

export const POINT_KIND_NAMES = ${JSON.stringify(KINDS)};

/** [lon, lat, type, nom] */
export const MONUMENT_POINTS: [number, number, PointKind, string][] = [
${bodyPoints}
];
`;
await writeFile(OUT_POINTS, outPoints);
console.log(
  `points: ${points.length} objets ecrits dans src/lib/monumentPoints.ts (${counts})\n` +
    `  ecartes : ${rejected.type} de type non dessinable, ${rejected.contemporain} contemporains, ` +
    `${rejected.bespoke} deja poses par un kit, ${rejected.bati} dans un batiment, ` +
    `${rejected.cimetiere} en cimetiere, ${rejected.loin} a plus de 30 m d'une rue, ` +
    `${rejected.chaussee} en pleine chaussee\n` +
    `  pousses hors chaussee : ${nudged}`,
);
console.log(
  `notable: ${rows.length} emprises ecrites dans src/lib/notable.ts ` +
    `(${matched} dans le cache, ${nodes} points ignores)`,
);
