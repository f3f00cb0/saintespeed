#!/usr/bin/env node
// Dessine l'elevation d'un repere bespoke, a comparer avec les photos de
// reference/photos.
//
//   npm run elevation                 # l'Hotel de Ville
//   npm run elevation -- 63319547     # un autre repere, par id OSM
//   npm run elevation -- 63319547 --from=y+   # depuis une autre facade
//   npm run elevation -- --list       # les ids disponibles
//
// La facade principale n'est pas du meme cote pour tous les reperes : elle est
// mesuree emprise par emprise (src/lib/landmarks.ts). Par defaut on regarde
// depuis -y, ce qui est le cas le plus courant ; --from=y+ / x- / x+ pour les
// autres.
//
// Pourquoi cet outil existe : on ne peut pas regarder un kit dans le jeu depuis
// un terminal. Un onglet qui n'est pas au premier plan gele
// requestAnimationFrame, le canvas reste noir, et meme au premier plan il faut
// conduire jusqu'au monument. Resultat, les kits se relisaient dans le code au
// lieu de se regarder, et une erreur grossiere pouvait tenir longtemps :
// l'orientation de l'Hotel de Ville etait fausse de 12,5 degres, son nu de
// facade coupait l'emprise en biais, et ca n'a saute aux yeux qu'une fois la
// facade dessinee.
//
// Le rendu est une vue orthographique de face, depuis le parvis, sans three.js
// ni GPU : un rasteriseur de triangles et l'algorithme du peintre. Il ne montre
// ni les textures de facade ni le bloom, seulement la GEOMETRIE et les elements
// lumineux, c'est-a-dire exactement ce qu'un kit decide.
//
// Le module de rendu est en TypeScript (scripts/elevation.entry.ts) parce qu'il
// importe les modules du jeu ; il est compile a la volee par esbuild, deja
// present pour Vite.

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CACHE = resolve(ROOT, "public/sainte-buildings.json");
const ENTRY = resolve(HERE, "elevation.entry.ts");

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--")).map(Number);
const fromArg = args.find((a) => a.startsWith("--from="));
const side = fromArg ? fromArg.slice("--from=".length) : "y-";
if (!["y-", "y+", "x-", "x+"].includes(side)) {
  console.error(`cote inconnu : ${side} (attendu y-, y+, x- ou x+)`);
  process.exit(1);
}

const tmp = await mkdtemp(join(tmpdir(), "saintespeed-elevation-"));
try {
  const bundle = join(tmp, "entry.mjs");
  // Tout est embarque, y compris jpeg-js : le bundle vit dans un dossier
  // temporaire et n'a donc aucun node_modules a resoudre a cote de lui.
  await build({
    entryPoints: [ENTRY],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "warning",
  });
  const mod = await import(pathToFileURL(bundle).href);

  if (args.includes("--list")) {
    for (const { id, label } of mod.list()) console.log(`  ${String(id).padStart(10)}  ${label}`);
    console.log("\nnpm run elevation -- <id>");
  } else {
    for (const id of ids.length ? ids : [-5201020]) {
      // Les contours issus de relations portent un id negatif : on le nomme
      // "rel" plutot que de laisser deux tirets dans le nom de fichier.
      const slug = id < 0 ? `rel${-id}` : `way${id}`;
      console.log(mod.render(id, CACHE, resolve(ROOT, `reference/elevation-${slug}.jpg`), side));
    }
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
