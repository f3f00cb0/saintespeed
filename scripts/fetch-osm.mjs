#!/usr/bin/env node
// Regenere les donnees OSM locales depuis Overpass.
//   npm run fetch-osm            routes + batiments + decor
//   npm run fetch-osm -- roads   routes seules
//   npm run fetch-osm -- buildings
//   npm run fetch-osm -- features surfaces au sol, arbres, tram, mobilier
//   npm run fetch-osm -- rail     voies ferrees, dont les viaducs
// Donnees OpenStreetMap sous ODbL.

import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");

// bbox Saint-Etienne, routes sur toute la ville (sud, ouest, nord, est)
const BBOX = [45.38, 4.33, 45.49, 4.44];

// Les batiments sont bien plus nombreux (57 000 sur la ville entiere), on se
// limite a une zone autour du circuit. Elle doit rester assez large pour qu'on
// ne tombe pas dans le vide en sortant du trace : une emprise trop serree faisait
// disparaitre la ville des qu'on montait vers l'Hotel de Ville.
//
// Les batiments couvrent maintenant toute la ville, soit la meme emprise que
// les routes. L'emprise a grandi deux fois : d'abord le bord nord remonte a
// 45,465 parce que la Cite du Design, Le Soleil, Montreynaud et
// Geoffroy-Guichard renvoyaient zero batiment, puis la ville entiere pour
// mesurer ce que l'architecture encaisse reellement.
const BUILD_BBOX = BBOX;

// Le decor lourd (clotures, allees) reste borne au coeur de ville : ce sont les
// couches les plus volumineuses et elles ne servent qu'a caracteriser les
// espaces ouverts qu'on traverse, pas les confins.
const DECOR_BBOX = [45.4115, 4.3765, 45.465, 4.4215];

// Un "out geom" sur 57 000 emprises depasse la centaine de mega-octets et
// Overpass rend un 504 avant la fin. On decoupe donc la bbox en cases et on
// fusionne : chaque case est reessayee independamment, donc un echec ne perd
// pas le travail deja fait.
const BUILD_SPLIT = 3;

function splitBBox(b, n) {
  const out = [];
  const dLat = (b[2] - b[0]) / n;
  const dLon = (b[3] - b[1]) / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      out.push([b[0] + i * dLat, b[1] + j * dLon, b[0] + (i + 1) * dLat, b[1] + (j + 1) * dLon]);
  return out;
}

const HIGHWAYS = "motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street";
const LINKS = "motorway_link|trunk_link|primary_link|secondary_link|tertiary_link";

const bb = (b) => `(${b[0]},${b[1]},${b[2]},${b[3]})`;

// Les zones pietonnes viennent avec les routes, pas pour etre rendues ici mais
// pour disqualifier les voies qui les traversent : voir roadsToGeoJSON.
const ROADS_QUERY =
  `[out:json][timeout:240];(` +
  `way["highway"~"^(${HIGHWAYS}|${LINKS})$"]${bb(BBOX)};` +
  `way["highway"="pedestrian"]${bb(BBOX)};` +
  `way["highway"="footway"]["area"="yes"]${bb(BBOX)};` +
  `);out geom;`;

// Les commerces qui comptent pour un rez-de-chaussee eclaire. La liste est
// volontairement fermee : "amenity" tout court ramene les bancs, les corbeilles
// et les places de parking, soit du bruit qui allumerait des vitrines au hasard.
const COMMERCE_AMENITY =
  "restaurant|cafe|bar|pub|fast_food|pharmacy|bank|bakery|cinema|theatre|marketplace|" +
  "nightclub|ice_cream|food_court|bureau_de_change|post_office|clinic|dentist|doctors";

// Un seul pull pour les batiments et les deux signaux qui les qualifient. Les
// jointures spatiales (POI -> batiment, zone -> batiment, axe -> batiment) sont
// faites ici, hors ligne : le navigateur recoit un simple drapeau par batiment
// au lieu de refaire 15 000 tests de point-dans-polygone au chargement.
// Les batiments a cour interieure sont cartographies en relation multipolygone,
// pas en way. Ne prendre que les ways les fait disparaitre : l'Hotel de Ville
// (relation 5201020) n'existait tout simplement pas dans la scene, et 176
// relations sont dans ce cas sur la bbox.
const buildingsQuery = (box) =>
  `[out:json][timeout:300];(` +
  `way["building"]${bb(box)};` +
  `relation["building"]${bb(box)};` +
  `way["landuse"~"^(industrial|retail|commercial|brownfield)$"]${bb(box)};` +
  `node["shop"]${bb(box)};` +
  `node["amenity"~"^(${COMMERCE_AMENITY})$"]${bb(box)};` +
  `);out geom;`;

// Tout le decor en un seul pull, on trie par tag a l'arrivee. Les places
// pietonnes et les parcs sont ce qui bouche les trous noirs des grandes places,
// le reste est de l'habillage.
// Les clotures et les allees ne sont tirees que sur la bbox batiments : ce sont
// les couches les plus volumineuses et elles ne servent qu'a caracteriser les
// espaces ouverts de la ville rendue, pas les confins.
const FEATURES_QUERY =
  `[out:json][timeout:300];(` +
  `node["natural"="tree"]${bb(BBOX)};` +
  `way["natural"="tree_row"]${bb(BBOX)};` +
  `way["highway"="pedestrian"]${bb(BBOX)};` +
  `way["highway"="footway"]["area"="yes"]${bb(BBOX)};` +
  `way["leisure"~"park|garden|pitch|playground"]${bb(BBOX)};` +
  `way["place"="square"]${bb(BBOX)};` +
  `way["landuse"~"grass|forest|meadow|cemetery"]${bb(BBOX)};` +
  `way["natural"="water"]${bb(BBOX)};` +
  `way["amenity"="parking"]${bb(BBOX)};` +
  `way["railway"="tram"]${bb(BBOX)};` +
  // Une fontaine de place est cartographiee par son bassin, donc en way, pas en
  // noeud. Ne prendre que les noeuds ratait justement celles qui comptent : la
  // fontaine de la place du Peuple (way 1300735962, a 32 m du centre de la
  // place) et les deux bassins devant la cathedrale a Jean Jaures (ways
  // 582876118 et 582876124, a 49 et 55 m).
  `node["amenity"="fountain"]${bb(BBOX)};` +
  `way["amenity"="fountain"]${bb(BBOX)};` +
  `node["highway"="street_lamp"]${bb(BBOX)};` +
  // caractere des espaces ouverts : cloture et allees
  `way["barrier"~"^(fence|hedge|wall|railing)$"]${bb(DECOR_BBOX)};` +
  `way["highway"~"^(footway|path|steps)$"]${bb(DECOR_BBOX)};` +
  // Les places du centre sont cartographiees en RELATION multipolygone, pas en
  // way. Ne demander que les ways les faisait purement disparaitre du sol :
  // Jean Jaures, le Peuple, Chavanelle, Neuve, Fourneyron, Waldeck Rousseau,
  // Jules Guesde, Jean Moulin, et jusqu'a la place de l'Hotel de Ville, soit
  // 16 places nommees sur 44 relations d'espace ouvert mesurees.
  `relation["highway"="pedestrian"]${bb(BBOX)};` +
  `relation["place"="square"]${bb(BBOX)};` +
  `relation["leisure"~"park|garden|pitch|playground"]${bb(BBOX)};` +
  `relation["landuse"~"grass|forest|meadow|cemetery"]${bb(BBOX)};` +
  `);out geom;`;

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

const ATTRIBUTION = "(c) OpenStreetMap contributors, ODbL";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (v) => Math.round(v * 1e6) / 1e6;

// Overpass renvoie 406 si le User-Agent n'identifie pas le client.
const UA = "saintespeed/0.1 (jeu de course sur reseau OSM; contact via github)";

// Les voies ferrees etaient la grande absente du fetch. Elles ne servent pas a
// rouler, mais l'une d'elles porte un objet urbain majeur : la gare Carnot est
// AERIENNE, posee sur le viaduc de la ligne de Saint-Georges-d'Aurac. Sans la
// geometrie de ce viaduc, on ne pouvait que deviner un tablier a la main, et il
// s'arretait dans le vide contre un batiment.
//
// Mesure sur la seule emprise du centre : 97 troncons, dont 25 en pont pour
// 1 683 m cumules. C'est peu de donnees pour un objet qui traverse la ville.
//
// On garde "bridge" et "layer" : c'est ce qui distingue le remblai du viaduc.
const RAIL_QUERY =
  `[out:json][timeout:180];(` +
  `way["railway"~"^(rail|light_rail|narrow_gauge)$"]${bb(BBOX)};` +
  `);out geom;`;

/** Compacte les voies ferrees : polyligne + ce qui dit si elle est en l'air. */
function railToCompact(json) {
  const lines = [];
  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
    const g = el.geometry.filter((p) => p && Number.isFinite(p.lon));
    if (g.length < 2) continue;
    const t = el.tags ?? {};
    const bridge = t.bridge && t.bridge !== "no";
    const tunnel = t.tunnel && t.tunnel !== "no";
    if (tunnel) continue; // rien a montrer d'un souterrain
    lines.push({
      i: el.id,
      g: g.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]),
      b: bridge ? 1 : 0,
      l: t.layer ? Number(t.layer) : 0,
      n: t.name || undefined,
      s: t.service || undefined,
    });
  }
  return { attribution: "(c) contributeurs OpenStreetMap, ODbL", lines };
}

async function hit(url, query) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(300000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (text.trimStart().startsWith("<")) {
    const m = text.match(/Error<\/strong>:([^<]*)/);
    throw new Error("reponse HTML: " + (m ? m[1].trim() : "inconnue").slice(0, 120));
  }
  return JSON.parse(text);
}

async function fetchWithRetry(query, label, rounds = 8) {
  // Overpass public rend beaucoup de 504/429 aux heures chargees. On insiste,
  // c'est un script de generation lance a la main, pas un chemin critique.
  for (let round = 0; round < rounds; round++) {
    for (const url of ENDPOINTS) {
      process.stdout.write(`  ${label} tour ${round + 1} - ${new URL(url).host} ... `);
      try {
        const json = await hit(url, query);
        const n = json.elements?.length ?? 0;
        if (!n) throw new Error("reponse vide");
        console.log(`ok, ${n} elements`);
        return json;
      } catch (err) {
        console.log("echec (" + err.message + ")");
      }
    }
    const wait = 10000 * (round + 1);
    console.log(`  tous les miroirs KO, nouvelle tentative dans ${wait / 1000}s`);
    await sleep(wait);
  }
  throw new Error("Overpass injoignable apres " + rounds + " tours");
}

// Overpass ne rend pas une case trop lourde : il coupe a 504 quel que soit le
// miroir. Le coeur dense de Saint-Etienne est dans ce cas. Plutot que d'insister
// sur une case impossible, on la recoupe en quatre et on redescend. Deux tours
// suffisent pour decider : au dela, c'est la taille qui bloque, pas la charge
// du serveur.
async function fetchBoxAdaptive(box, label, depth = 0) {
  try {
    return (await fetchWithRetry(buildingsQuery(box), label, 2)).elements;
  } catch (err) {
    if (depth >= 3) throw err;
    console.log(`  ${label} trop lourde, on la recoupe en 4`);
    const out = [];
    const subs = splitBBox(box, 2);
    for (let i = 0; i < subs.length; i++) {
      out.push(...(await fetchBoxAdaptive(subs[i], `${label}.${i + 1}`, depth + 1)));
    }
    return out;
  }
}

// --- routes : GeoJSON compact ---------------------------------------------
//
// Une partie du reseau OSM porte "highway=residential" alors qu'on n'y roule
// pas : les places pietonnes du centre sont modelisees comme des rues, parce
// que les livraisons et les riverains y passent. Place du Peuple, place Jean
// Jaures, place de l'Hotel de Ville, rue de la Republique en sont. Les laisser
// dans le graphe laisse la voiture traverser la zone pietonne.
//
// ATTENTION, piege mesure : NE PAS disqualifier une voie parce qu'elle longe le
// tram. Le tram stephanois roule en site partage sur une bonne partie du
// reseau, et le critere "proche d'un rail" frappait 63 ways dont le boulevard
// Jules Janin, la rue Gambetta et la rue Charles de Gaulle, tous parfaitement
// roulables. Seule l'appartenance a une zone pietonne compte.
const NON_DRIVABLE_ACCESS = /^(no|private)$/;

function roadsToGeoJSON(json) {
  const drivable = [];
  const pedRings = [];
  const pedLines = [];

  for (const el of json.elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags || {};
    const g = el.geometry.map((p) => [r6(p.lon), r6(p.lat)]);

    if (t.highway === "pedestrian" || (t.highway === "footway" && t.area === "yes")) {
      const first = g[0];
      const last = g[g.length - 1];
      if (g.length > 3 && first[0] === last[0] && first[1] === last[1]) pedRings.push(g.slice(0, -1));
      else pedLines.push(g);
      continue;
    }
    drivable.push({ el, t, g });
  }

  const proj = makeProj((BBOX[0] + BBOX[2]) / 2);
  const polys = pedRings.map((r) => {
    const ring = r.map(([lon, lat]) => proj(lon, lat));
    return { ring, ...bboxOf(ring) };
  });
  const lines = pedLines.map((l) => l.map(([lon, lat]) => proj(lon, lat)));

  // Demi-largeur d'une rue pietonne, la meme que celle utilisee au rendu.
  const PED_HALF = 4.5;

  function pedestrianFraction(g) {
    const pts = g.map(([lon, lat]) => proj(lon, lat));
    let hit = 0;
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
      for (let s = 0; s < steps; s++) {
        const x = a.x + ((b.x - a.x) * s) / steps;
        const y = a.y + ((b.y - a.y) * s) / steps;
        total++;
        let inside = false;
        for (const p of polys) {
          if (x < p.minx || x > p.maxx || y < p.miny || y > p.maxy) continue;
          if (pointInRing(x, y, p.ring)) { inside = true; break; }
        }
        if (!inside) {
          for (const l of lines) {
            for (let k = 0; k < l.length - 1 && !inside; k++)
              if (ptSegDist(x, y, l[k].x, l[k].y, l[k + 1].x, l[k + 1].y) < PED_HALF) inside = true;
            if (inside) break;
          }
        }
        if (inside) hit++;
      }
    }
    return total ? hit / total : 0;
  }

  const features = [];
  const dropped = { pedestrian: 0, access: 0 };
  for (const { el, t, g } of drivable) {
    if (NON_DRIVABLE_ACCESS.test(t.access ?? "") || NON_DRIVABLE_ACCESS.test(t.motor_vehicle ?? "")) {
      dropped.access++;
      continue;
    }
    if (pedestrianFraction(g) > 0.5) {
      dropped.pedestrian++;
      continue;
    }
    const props = { highway: t.highway };
    if (t.name) props.name = t.name;
    if (t.oneway) props.oneway = t.oneway;
    if (t.maxspeed) props.maxspeed = t.maxspeed;
    features.push({
      type: "Feature",
      id: el.id,
      properties: props,
      geometry: { type: "LineString", coordinates: g },
    });
  }

  return {
    type: "FeatureCollection",
    attribution: ATTRIBUTION,
    bbox: [BBOX[1], BBOX[0], BBOX[3], BBOX[2]],
    features,
    dropped,
  };
}

// --- jointures spatiales, faites une fois a la generation ------------------
// Projection equirectangulaire locale, meme convention que src/lib/project.ts.
const R6378 = 6378137;
const D2R = Math.PI / 180;

function makeProj(lat0) {
  const k = Math.cos(lat0 * D2R);
  return (lon, lat) => ({ x: lon * D2R * k * R6378, y: lat * D2R * R6378 });
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
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

function bboxOf(ring) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of ring) {
    if (p.x < minx) minx = p.x;
    if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy };
}

// Grille uniforme : les jointures sont en O(n) au lieu de O(n x m). Sans elle,
// 1700 POI contre 30 000 batiments font 51 millions de tests.
function makeGrid(cell) {
  const map = new Map();
  const key = (a, b) => (a + 32768) * 65536 + (b + 32768);
  return {
    put(x, y, v) {
      const k = key(Math.floor(x / cell), Math.floor(y / cell));
      let b = map.get(k);
      if (!b) map.set(k, (b = []));
      if (b[b.length - 1] !== v) b.push(v);
    },
    around(x, y) {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      const out = [];
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const b = map.get(key(gx + i, gy + j));
          if (b) out.push(...b);
        }
      return out;
    },
  };
}

function segDist(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L = vx * vx + vy * vy;
  let t = L ? ((px - a.x) * vx + (py - a.y) * vy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
}

// Rayon de rattachement d'un POI ou d'un axe a un batiment. 40 m couvre la
// profondeur d'un ilot depuis l'axe et le decalage courant entre un noeud POI
// saisi a la va-vite et l'emprise reelle.
const COMMERCE_RADIUS = 40;

// --- relations multipolygones ----------------------------------------------
// Un multipolygone OSM decrit son contour exterieur en plusieurs ways qui se
// touchent bout a bout. Il faut les recoudre pour retrouver l'anneau. Les
// anneaux interieurs (role "inner", les cours) sont ignores : le batiment sera
// plein plutot qu'absent, ce qui est tres largement preferable.
function stitchRings(members) {
  const parts = members
    .filter((m) => m.type === "way" && (m.role === "outer" || !m.role) && m.geometry?.length > 1)
    .map((m) => m.geometry.map((p) => [r6(p.lon), r6(p.lat)]));

  const rings = [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];

  while (parts.length) {
    let ring = parts.shift();
    let grew = true;
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const tail = ring[ring.length - 1];
        if (same(p[0], tail)) {
          ring = ring.concat(p.slice(1));
        } else if (same(p[p.length - 1], tail)) {
          ring = ring.concat(p.slice(0, -1).reverse());
        } else {
          continue;
        }
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1])) ring.pop();
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// --- batiments : format maison, contour + niveaux -------------------------
// Un GeoJSON complet couterait 8 Mo pour la meme information. On ne garde que
// le contour et ce qui sert a deviner la hauteur et l'archetype de facade.
function buildingsToCompact(json) {
  const levelsOf = (t) => {
    const raw = t["building:levels"];
    if (raw === undefined) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 && n < 200 ? Math.round(n) : null;
  };
  const heightOf = (t) => {
    const raw = t.height;
    if (raw === undefined) return null;
    const n = parseFloat(String(raw).replace(",", "."));
    return Number.isFinite(n) && n > 1 && n < 400 ? Math.round(n * 10) / 10 : null;
  };

  const proj = makeProj((BUILD_BBOX[0] + BUILD_BBOX[2]) / 2);

  const out = [];
  const zones = []; // polygones landuse projetes
  const pois = []; // commerces, projetes

  let relRings = 0;

  // Un batiment, quel que soit son support OSM (way simple ou relation
  // multipolygone), se ramene ici a une liste de contours a plat.
  const contours = [];
  for (const el of json.elements) {
    const t = el.tags || {};
    if (el.type === "relation" && t.building && Array.isArray(el.members)) {
      for (const ring of stitchRings(el.members)) {
        // id negatif : evite toute collision avec les ids de way
        contours.push({ id: -el.id, tags: t, g: ring });
        relRings++;
      }
    }
  }

  for (const el of json.elements) {
    const t = el.tags || {};

    if (el.type === "node") {
      if (t.shop || t.amenity) pois.push(proj(el.lon, el.lat));
      continue;
    }
    if (el.type !== "way" || !el.geometry || el.geometry.length < 4) continue;

    if (t.landuse && !t.building) {
      const ring = el.geometry.map((p) => proj(p.lon, p.lat));
      if (ring.length < 4) continue;
      zones.push({ kind: t.landuse, ring, ...bboxOf(ring) });
      continue;
    }
    if (!t.building) continue;

    // Overpass ferme le contour en repetant le premier point, on le retire
    const g = el.geometry.map((p) => [r6(p.lon), r6(p.lat)]);
    const first = g[0];
    const last = g[g.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) g.pop();
    if (g.length < 3) continue;
    contours.push({ id: el.id, tags: t, g });
  }

  for (const c of contours) {
    const t = c.tags;
    const g = c.g;
    const b = { i: c.id, g };
    const lv = levelsOf(t);
    const h = heightOf(t);
    if (lv !== null) b.l = lv;
    if (h !== null) b.h = h;
    if (t.building && t.building !== "yes") b.k = t.building;
    // Tags de matiere : les plus fideles de tous, donc on les garde meme s'ils
    // sont rarissimes a Saint-Etienne (2 batiments chacun sur l'ancienne bbox).
    if (t["building:material"]) b.m = t["building:material"];
    if (t["building:colour"]) b.c = t["building:colour"];
    if (t["roof:shape"]) b.rs = t["roof:shape"];
    if (t.name) b.n = t.name;
    // Un commerce tague sur l'emprise elle-meme est le signal le plus sur, il
    // n'a pas besoin de la jointure de proximite.
    if (t.shop || t.amenity) b.s = 1;

    // geometrie projetee, gardee de cote pour les jointures
    const ring = g.map(([lon, lat]) => proj(lon, lat));
    b._ring = ring;
    b._bb = bboxOf(ring);
    let cx = 0, cy = 0;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
    }
    b._cx = cx / ring.length;
    b._cy = cy / ring.length;
    b._area = ringArea(ring);
    out.push(b);
  }

  // --- POI -> batiment ------------------------------------------------------
  // On teste d'abord l'appartenance stricte au contour, puis on retombe sur le
  // centroide le plus proche : un POI est souvent pose a cote de l'emprise
  // plutot que dedans.
  const bGrid = makeGrid(COMMERCE_RADIUS * 2);
  for (let i = 0; i < out.length; i++) bGrid.put(out[i]._cx, out[i]._cy, i);

  let poiHits = 0;
  for (const p of pois) {
    let inside = -1;
    let near = -1;
    let nearD = COMMERCE_RADIUS;
    for (const idx of bGrid.around(p.x, p.y)) {
      const b = out[idx];
      if (p.x >= b._bb.minx && p.x <= b._bb.maxx && p.y >= b._bb.miny && p.y <= b._bb.maxy) {
        if (pointInRing(p.x, p.y, b._ring)) {
          inside = idx;
          break;
        }
      }
      const d = Math.hypot(b._cx - p.x, b._cy - p.y);
      if (d < nearD) {
        nearD = d;
        near = idx;
      }
    }
    const hit = inside >= 0 ? inside : near;
    if (hit >= 0) {
      if (!out[hit].s) poiHits++;
      out[hit].s = (out[hit].s || 0) | 1;
    }
  }

  // --- zone landuse -> batiment --------------------------------------------
  // Les zones sont peu nombreuses mais tres grandes, la grille ne sert a rien
  // ici : un test de boite englobante puis un point-dans-polygone suffit.
  let zoneHits = 0;
  for (const b of out) {
    for (const z of zones) {
      if (b._cx < z.minx || b._cx > z.maxx || b._cy < z.miny || b._cy > z.maxy) continue;
      if (!pointInRing(b._cx, b._cy, z.ring)) continue;
      if (z.kind === "industrial" || z.kind === "brownfield") {
        if (!b.z) zoneHits++;
        b.z = "i";
      } else if (!b.z) {
        // retail / commercial : allume la vitrine, ne change pas la matiere
        b.s = (b.s || 0) | 4;
      }
    }
  }

  // --- axes primary/secondary -> batiment ----------------------------------
  // Le fichier routes est deja sur le disque. S'il manque (fetch batiments
  // lance seul avant les routes), on saute simplement ce signal.
  let axisHits = 0;
  let axisSegs = 0;
  try {
    const roads = JSON.parse(readFileSync(resolve(PUBLIC, "sainte.geojson"), "utf8"));
    const segs = [];
    const aGrid = makeGrid(COMMERCE_RADIUS * 2);
    for (const f of roads.features) {
      const hw = f.properties?.highway || "";
      if (!/^(primary|secondary)(_link)?$/.test(hw)) continue;
      const pts = f.geometry.coordinates.map(([lon, lat]) => proj(lon, lat));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const c = pts[i + 1];
        const idx = segs.length;
        segs.push([a, c]);
        const steps = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / COMMERCE_RADIUS));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          aGrid.put(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, idx);
        }
      }
    }
    axisSegs = segs.length;
    for (const b of out) {
      for (const idx of aGrid.around(b._cx, b._cy)) {
        if (segDist(b._cx, b._cy, segs[idx][0], segs[idx][1]) < COMMERCE_RADIUS) {
          if (!(b.s & 2)) axisHits++;
          b.s = (b.s || 0) | 2;
          break;
        }
      }
    }
  } catch {
    console.log("  sainte.geojson absent, signal 'bord d'axe' non calcule");
  }

  for (const b of out) {
    delete b._ring;
    delete b._bb;
    delete b._cx;
    delete b._cy;
    delete b._area;
  }

  return {
    attribution: ATTRIBUTION,
    bbox: [BUILD_BBOX[1], BUILD_BBOX[0], BUILD_BBOX[3], BUILD_BBOX[2]],
    buildings: out,
    joins: { zones: zones.length, pois: pois.length, poiHits, zoneHits, axisSegs, axisHits, relRings },
  };
}

// --- decor : surfaces, arbres, tram, mobilier ------------------------------
// Meme logique que les batiments : format maison, contours seuls. Les surfaces
// partent dans un seul tableau avec une "classe" (k) qui pilote le materiau au
// rendu, c'est ce qui evite dix listes paralleles.

// Ordre de test volontaire : une aire peut porter plusieurs tags (un parking
// dans un parc, une pelouse taggee aussi leisure=park). Le premier qui matche
// gagne, du plus specifique au plus generique.
function classifyArea(t) {
  if (t.natural === "water") return "water";
  if (t.highway === "pedestrian") return "pedestrian";
  if (t.highway === "footway" && t.area === "yes") return "pedestrian";
  // Volontairement PAS de "place=square" : c'est une emprise de nommage, pas
  // une surface. La place Sadi Carnot est un place=square de 17 282 m2 qui
  // englobe le parc de 8 366 m2 ; la peindre en dalle posait une plaque
  // minerale par dessus le parc et faisait lire Carnot comme une place dure,
  // exactement l'inverse de ce qu'elle est.
  if (t.amenity === "parking") return "parking";
  if (t.leisure === "pitch") return "pitch";
  if (t.leisure === "playground") return "park";
  if (t.leisure === "park" || t.leisure === "garden") return "park";
  if (t.landuse === "cemetery") return "cemetery";
  if (t.landuse === "forest") return "forest";
  if (t.landuse === "grass" || t.landuse === "meadow") return "grass";
  return null;
}

// Distance d'un point a un segment, reutilisee par les jointures de decor.
function ptSegDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const L = vx * vx + vy * vy;
  let t = L ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/**
 * Deplie les relations multipolygones en contours, pour que la suite n'ait
 * qu'un seul cas a traiter. C'est la meme reparation que pour les batiments,
 * appliquee au sol : le contour recousu est referme, parce que la boucle des
 * surfaces ne garde que les anneaux fermes.
 */
function expandOpenSpaceRelations(elements) {
  const out = [];
  let rings = 0;
  for (const el of elements) {
    if (el.type !== "relation" || !Array.isArray(el.members)) {
      out.push(el);
      continue;
    }
    for (const ring of stitchRings(el.members)) {
      out.push({
        type: "way",
        id: -el.id, // id negatif : pas de collision avec les ids de way
        tags: el.tags || {},
        geometry: [...ring, ring[0]].map(([lon, lat]) => ({ lon, lat })),
      });
      rings++;
    }
  }
  return { elements: out, rings };
}

function featuresToCompact(json) {
  const areas = [];
  const pedLines = []; // rues pietonnes : des lignes, pas des contours
  const trees = []; // points nus, ils sont 4000 et n'ont pas besoin d'id
  const treeRows = [];
  const tram = [];
  const fountains = [];
  const lamps = [];
  const rawFences = [];
  const rawPaths = [];

  const expanded = expandOpenSpaceRelations(json.elements);
  const relRings = expanded.rings;

  for (const el of expanded.elements) {
    const t = el.tags || {};

    if (el.type === "node") {
      if (t.natural === "tree") trees.push([r6(el.lon), r6(el.lat)]);
      // rayon par defaut d'une fontaine posee en simple noeud
      else if (t.amenity === "fountain") fountains.push([r6(el.lon), r6(el.lat), 2.4]);
      else if (t.highway === "street_lamp") lamps.push([r6(el.lon), r6(el.lat)]);
      continue;
    }
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;

    const g = el.geometry.map((p) => [r6(p.lon), r6(p.lat)]);

    if (t.railway === "tram") {
      tram.push({ i: el.id, g });
      continue;
    }
    if (t.natural === "tree_row") {
      treeRows.push({ i: el.id, g });
      continue;
    }
    // Un bassin de fontaine : on garde son centre et son rayon equivalent, pas
    // son contour. A cette echelle une vasque ronde suffit, mais la taille
    // reelle compte : le bassin de la place du Peuple n'a rien a voir avec une
    // fontaine a boire.
    if (t.amenity === "fountain") {
      // Overpass repete le premier point pour fermer le contour, il fausserait
      // le centroide
      const ring = g.length > 2 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1]
        ? g.slice(0, -1)
        : g;
      let clon = 0, clat = 0;
      for (const [lon, lat] of ring) {
        clon += lon;
        clat += lat;
      }
      clon /= ring.length;
      clat /= ring.length;
      // un bassin fait quelques metres : le centroide en lon/lat est exact a
      // cette echelle, seul le rayon demande une projection
      const pj = makeProj(clat);
      const r = Math.sqrt(ringArea(ring.map(([lon, lat]) => pj(lon, lat))) / Math.PI);
      fountains.push([r6(clon), r6(clat), Math.round(Math.max(1, Math.min(12, r)) * 10) / 10]);
      continue;
    }
    if (t.barrier) {
      rawFences.push({ g, kind: t.barrier });
      continue;
    }
    if (/^(footway|path|steps)$/.test(t.highway ?? "") && t.area !== "yes") {
      rawPaths.push({ g, surface: t.surface ?? null });
      continue;
    }

    // une surface est forcement un contour ferme
    const first = g[0];
    const last = g[g.length - 1];
    const closed = first[0] === last[0] && first[1] === last[1];

    // Sur 179 highway=pedestrian, 129 sont des lignes ouvertes : ce sont les
    // rues pietonnes du centre, pas des places. Les jeter laissait tout le
    // secteur pietonnier en noir, on les garde comme polylignes a elargir au
    // rendu.
    if (!closed) {
      if (t.highway === "pedestrian") pedLines.push({ i: el.id, g, n: t.name, s: t.surface });
      continue;
    }

    g.pop();
    if (g.length < 3) continue;

    const k = classifyArea(t);
    if (!k) continue;
    const a = { i: el.id, k, g };
    if (t.name) a.n = t.name;
    if (t.surface) a.s = t.surface;
    if (t.leisure) a.lz = t.leisure;
    if (t.place === "square") a.sq = 1;
    areas.push(a);
  }

  // --- caractere des espaces ouverts ---------------------------------------
  // Trois jointures faites ici, hors ligne : arbres dans le polygone, cloture
  // le long du perimetre, allees a l'interieur. Le navigateur ne recoit que le
  // resultat, il ne refait aucun test geometrique au chargement.
  const proj = makeProj((BBOX[0] + BBOX[2]) / 2);
  const openKinds = new Set(["pedestrian", "park", "grass"]);

  const polys = areas.map((a) => {
    if (!openKinds.has(a.k)) return null;
    const ring = a.g.map(([lon, lat]) => proj(lon, lat));
    return { a, ring, ...bboxOf(ring), area: ringArea(ring) };
  });

  const inside = (p, poly) =>
    p.x >= poly.minx && p.x <= poly.maxx && p.y >= poly.miny && p.y <= poly.maxy &&
    pointInRing(p.x, p.y, poly.ring);

  // arbres
  for (const poly of polys) {
    if (!poly) continue;
    poly.a.nt = 0;
  }
  for (const [lon, lat] of trees) {
    const p = proj(lon, lat);
    for (const poly of polys) {
      if (!poly) continue;
      if (inside(p, poly)) { poly.a.nt++; break; }
    }
  }

  // clotures : on ne garde que celles qui longent un espace ouvert, et on note
  // la longueur cumulee sur chaque polygone. C'est le canal le plus
  // discriminant d'un jardin, et le plus sous-exploite.
  const fences = [];
  for (const f of rawFences) {
    const pts = f.g.map(([lon, lat]) => proj(lon, lat));
    let keep = false;
    let len = 0;
    for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    for (const poly of polys) {
      if (!poly) continue;
      let touch = false;
      for (const p of pts) {
        if (p.x < poly.minx - 12 || p.x > poly.maxx + 12 || p.y < poly.miny - 12 || p.y > poly.maxy + 12) continue;
        // au contact : soit dedans, soit a moins de 12 m d'une arete
        if (pointInRing(p.x, p.y, poly.ring)) { touch = true; break; }
        for (let i = 0; i < poly.ring.length && !touch; i++) {
          const a = poly.ring[i];
          const b = poly.ring[(i + 1) % poly.ring.length];
          if (ptSegDist(p.x, p.y, a.x, a.y, b.x, b.y) < 12) touch = true;
        }
        if (touch) break;
      }
      if (touch) {
        keep = true;
        poly.a.fl = Math.round((poly.a.fl ?? 0) + len);
      }
    }
    if (keep) fences.push({ g: f.g, k: f.kind === "hedge" ? "h" : f.kind === "wall" ? "w" : "f" });
  }

  // allees : seules celles dont le milieu tombe dans un espace ouvert
  const paths = [];
  for (const p of rawPaths) {
    const pts = p.g.map(([lon, lat]) => proj(lon, lat));
    const mid = pts[Math.floor(pts.length / 2)];
    for (const poly of polys) {
      if (!poly) continue;
      if (inside(mid, poly)) {
        paths.push({ g: p.g, s: p.surface ?? undefined });
        poly.a.np = (poly.a.np ?? 0) + 1;
        break;
      }
    }
  }

  return {
    attribution: ATTRIBUTION,
    bbox: [BBOX[1], BBOX[0], BBOX[3], BBOX[2]],
    relRings,
    areas,
    pedLines,
    trees,
    treeRows,
    tram,
    fountains,
    lamps,
    fences,
    paths,
  };
}

// --- pilotage --------------------------------------------------------------
const arg = process.argv[2];
const doRoads = !arg || arg === "roads";
const doBuildings = !arg || arg === "buildings";
const doFeatures = !arg || arg === "features";
const doRail = !arg || arg === "rail";

await mkdir(PUBLIC, { recursive: true });

if (doRoads) {
  console.log("routes ->", BBOX.join(", "));
  const json = await fetchWithRetry(ROADS_QUERY, "routes");
  const gj = roadsToGeoJSON(json);
  const body = JSON.stringify(gj);
  await writeFile(resolve(PUBLIC, "sainte.geojson"), body);
  const pts = gj.features.reduce((a, f) => a + f.geometry.coordinates.length, 0);
  console.log(
    `  ecrit sainte.geojson : ${gj.features.length} ways, ${pts} points, ${(body.length / 1e6).toFixed(2)} Mo`,
  );
  console.log(
    `  voies ecartees : ${gj.dropped.pedestrian} en zone pietonne, ${gj.dropped.access} interdites par tag`,
  );
}

if (doBuildings) {
  const boxes = splitBBox(BUILD_BBOX, BUILD_SPLIT);
  console.log(`batiments -> ${BUILD_BBOX.join(", ")} en ${boxes.length} cases`);
  // Les cases se recouvrent sur leurs bords : un meme way peut revenir
  // plusieurs fois, on deduplique par id et par type.
  const seen = new Set();
  const elements = [];
  for (let i = 0; i < boxes.length; i++) {
    const els = await fetchBoxAdaptive(boxes[i], `case ${i + 1}/${boxes.length}`);
    let fresh = 0;
    for (const el of els) {
      const k = `${el.type[0]}${el.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      elements.push(el);
      fresh++;
    }
    console.log(`    case ${i + 1} : ${els.length} elements, ${fresh} nouveaux, ${elements.length} cumules`);
  }
  const data = buildingsToCompact({ elements });
  const body = JSON.stringify(data);
  await writeFile(resolve(PUBLIC, "sainte-buildings.json"), body);
  const pts = data.buildings.reduce((a, b) => a + b.g.length, 0);
  const n = data.buildings.length;
  const tagged = data.buildings.filter((b) => b.l || b.h).length;
  const pct = (v) => `${v} (${((v / n) * 100).toFixed(1)}%)`;
  console.log(
    `  ecrit sainte-buildings.json : ${n} batiments, ${pts} points, ` +
      `${(body.length / 1e6).toFixed(2)} Mo`,
  );
  console.log(
    `  hauteur connue : ${pct(tagged)}, le reste sera infere`,
  );
  const j = data.joins;
  console.log(
    `  contours issus de relations multipolygones : ${j.relRings}\n` +
      `  jointures : ${j.zones} zones landuse, ${j.pois} POI commerce, ${j.axisSegs} segments d'axe\n` +
      `  zone industrielle : ${pct(data.buildings.filter((b) => b.z === "i").length)}\n` +
      `  rez commerce : ${pct(data.buildings.filter((b) => b.s).length)} ` +
      `(POI ${data.buildings.filter((b) => b.s & 1).length}, ` +
      `axe ${data.buildings.filter((b) => b.s & 2).length}, ` +
      `zone ${data.buildings.filter((b) => b.s & 4).length})\n` +
      `  materiau tague : ${data.buildings.filter((b) => b.m).length} · ` +
      `couleur taguee : ${data.buildings.filter((b) => b.c).length} · ` +
      `nommes : ${data.buildings.filter((b) => b.n).length}`,
  );
}

if (doFeatures) {
  console.log("decor ->", BBOX.join(", "));
  const json = await fetchWithRetry(FEATURES_QUERY, "decor");
  const data = featuresToCompact(json);
  const body = JSON.stringify(data);
  await writeFile(resolve(PUBLIC, "sainte-features.json"), body);

  const byKind = {};
  for (const a of data.areas) byKind[a.k] = (byKind[a.k] || 0) + 1;
  console.log(
    `  ecrit sainte-features.json : ${(body.length / 1e6).toFixed(2)} Mo\n` +
      `  surfaces : ${data.areas.length} (` +
      Object.entries(byKind)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") +
      `)\n` +
      `  contours issus de relations multipolygones : ${data.relRings} ` +
      `(les places du centre en sont)\n` +
      `  rues pietonnes : ${data.pedLines.length} polylignes\n` +
      `  arbres : ${data.trees.length} isoles, ${data.treeRows.length} alignements\n` +
      `  tram : ${data.tram.length} troncons · fontaines : ${data.fountains.length} · ` +
      `lampadaires OSM : ${data.lamps.length}\n` +
      `  clotures au contact d'un espace ouvert : ${data.fences.length} · ` +
      `allees dans un espace ouvert : ${data.paths.length}\n` +
      `  espaces ouverts avec cloture : ${data.areas.filter((a) => a.fl).length} · ` +
      `avec arbres : ${data.areas.filter((a) => a.nt).length} · ` +
      `avec surface taguee : ${data.areas.filter((a) => a.s).length}`,
  );
}

if (doRail) {
  console.log("voies ferrees ->", BBOX.join(", "));
  const json = await fetchWithRetry(RAIL_QUERY, "rail");
  const data = railToCompact(json);
  const body = JSON.stringify(data);
  await writeFile(resolve(PUBLIC, "sainte-rail.json"), body);

  const proj = makeProj((BBOX[0] + BBOX[2]) / 2);
  const lengthOf = (l) => {
    let m = 0;
    for (let i = 1; i < l.g.length; i++) {
      const a = proj(l.g[i - 1][0], l.g[i - 1][1]);
      const b = proj(l.g[i][0], l.g[i][1]);
      m += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return m;
  };
  const bridges = data.lines.filter((l) => l.b || l.l > 0);
  const total = data.lines.reduce((a, l) => a + lengthOf(l), 0);
  const aerien = bridges.reduce((a, l) => a + lengthOf(l), 0);
  console.log(
    `  ecrit sainte-rail.json : ${data.lines.length} troncons, ` +
      `${(body.length / 1e3).toFixed(0)} ko\n` +
      `  ${Math.round(total)} m de voie, dont ${Math.round(aerien)} m EN L'AIR ` +
      `(${bridges.length} troncons en pont ou en layer positif)`,
  );
}
