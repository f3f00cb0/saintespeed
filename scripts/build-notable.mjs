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
const CACHE = resolve(ROOT, "public/sainte-buildings.json");

// Les contours issus de relations portent leur id en negatif dans le cache,
// meme convention que scripts/fetch-osm.mjs.
function osmId(featureId) {
  const [type, id] = featureId.split("/");
  if (type === "node") return null;
  return type === "relation" ? -Number(id) : Number(id);
}

const CULTE_BUILDING = /^(church|chapel|cathedral|mosque|synagogue|temple|monastery|shrine)$/;

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
console.log(
  `notable: ${rows.length} emprises ecrites dans src/lib/notable.ts ` +
    `(${matched} dans le cache, ${nodes} points ignores)`,
);
