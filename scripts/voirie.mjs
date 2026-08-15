#!/usr/bin/env node
// Harnais de la couche voirie : mesure les trottoirs et en dessine le plan,
// sans navigateur ni GPU.
//
//   npm run voirie                       # les chiffres, boite jouable et ville
//   npm run voirie -- plan               # les trois plans de reference en SVG
//   npm run voirie -- plan 4.3874 45.4397 90    # un plan ailleurs, rayon en m
//
// Pourquoi ce harnais existe : un trottoir pose sur la chaussee d'en face ou
// rentre dans une facade ne se voit pas depuis la voiture, et on ne peut pas
// regarder la scene depuis un terminal (un onglet qui n'est pas au premier plan
// gele requestAnimationFrame). Les chiffres attrapent la faute, le plan montre
// ou elle est.
//
// Le module de rendu est en TypeScript (scripts/voirie.entry.ts) parce qu'il
// importe les modules du jeu ; il est compile a la volee par esbuild.

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUBLIC = resolve(ROOT, "public");
const ENTRY = resolve(HERE, "voirie.entry.ts");

// Trois lieux qui couvrent les trois cas : un carrefour a trois branches, une
// place, et un tissu residentiel dense.
const PLANS = [
  { nom: "carrefour", lon: 4.388856, lat: 45.437928, rayon: 32 },
  { nom: "jean-jaures", lon: 4.3897, lat: 45.4372, rayon: 110 },
  { nom: "residentiel", lon: 4.3955, lat: 45.4315, rayon: 80 },
];

const args = process.argv.slice(2);
const tmp = await mkdtemp(join(tmpdir(), "saintespeed-voirie-"));
try {
  const bundle = join(tmp, "entry.mjs");
  await build({
    entryPoints: [ENTRY],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "warning",
  });
  const mod = await import(pathToFileURL(bundle).href);
  const charge = mod.charger(PUBLIC);

  if (args[0] === "plan") {
    const [, lon, lat, rayon] = args;
    const vues = lon
      ? [{ nom: "plan", lon: Number(lon), lat: Number(lat), rayon: Number(rayon || 90) }]
      : PLANS;
    for (const v of vues) {
      console.log(mod.plan(charge, v.lon, v.lat, v.rayon, resolve(ROOT, `reference/voirie-${v.nom}.svg`)));
    }
  } else {
    console.log(mod.verifier(charge, 2600));
    console.log(mod.verifier(charge, Infinity));
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
