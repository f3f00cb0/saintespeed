#!/usr/bin/env node
// Joint la BD TOPO de l'IGN aux batiments OSM (voir scripts/ign.mjs).
//
//   npm run fetch-ign                 telecharge puis joint
//   npm run fetch-ign -- --cache      rejoint depuis le cache, sans reseau
//
// Le telechargement brut est garde dans data/ign-batiments.json (hors depot,
// quelques dizaines de Mo). `npm run fetch-osm -- buildings` relit ce cache
// s'il existe : regenerer les emprises OSM ne perd donc pas les hauteurs IGN.
//
// Le resultat est ecrit dans public/sainte-buildings.json, sur les batiments
// deja presents : ce script n'ajoute ni ne retire aucune emprise.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBdTopo, joinIgn, IGN_ATTRIBUTION, IGN_CACHE } from "./ign.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "public/sainte-buildings.json");

const data = JSON.parse(readFileSync(OUT, "utf8"));
// meme bbox que les emprises OSM : [sud, ouest, nord, est]
const bbox = data.bbox?.length === 4 ? [data.bbox[1], data.bbox[0], data.bbox[3], data.bbox[2]] : [45.38, 4.33, 45.49, 4.44];

let features;
if (process.argv.includes("--cache")) {
  if (!existsSync(IGN_CACHE)) {
    console.error(`pas de cache ${IGN_CACHE}, lancer d'abord npm run fetch-ign`);
    process.exit(1);
  }
  features = JSON.parse(readFileSync(IGN_CACHE, "utf8")).features;
  console.log(`BD TOPO depuis le cache : ${features.length} emprises`);
} else {
  console.log(`BD TOPO -> ${bbox.join(", ")}`);
  features = await fetchBdTopo(bbox);
  await mkdir(dirname(IGN_CACHE), { recursive: true });
  await writeFile(IGN_CACHE, JSON.stringify({ attribution: IGN_ATTRIBUTION, bbox, features }));
  console.log(`  cache ecrit : ${features.length} emprises`);
  // Les noms de champs changent d'une version de la BD TOPO a l'autre : on les
  // affiche, pour voir d'un coup d'oeil si un attribut attendu a disparu.
  if (features[0]) console.log(`  champs servis : ${Object.keys(features[0].properties ?? {}).join(", ")}`);
}

const lat0 = (bbox[0] + bbox[2]) / 2;
const s = joinIgn(data.buildings, features, lat0);
data.ign = IGN_ATTRIBUTION;
const body = JSON.stringify(data);
await writeFile(OUT, body);

const n = data.buildings.length;
const pct = (v) => `${v} (${((v / n) * 100).toFixed(1)}%)`;
console.log(
  `  ${s.polygons} emprises BD TOPO indexees\n` +
    `  batiments OSM joints : ${pct(s.joined)}\n` +
    `    hauteur mesuree : ${pct(s.height)}\n` +
    `    matiere des murs : ${pct(s.material)}\n` +
    `    toiture : ${pct(s.roof)}\n` +
    `    annee : ${pct(s.year)}\n` +
    `  ecrit sainte-buildings.json, ${(body.length / 1e6).toFixed(2)} Mo`,
);
