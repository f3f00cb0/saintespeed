#!/usr/bin/env node
// Mesure les palettes dominantes des photos de reference, pour caler les
// STYLES de src/lib/archetypes.ts sur des chiffres plutot qu'a l'oeil.
//   npm run palette-reference
//
// Principe : on decode chaque photo de reference/photos/ (jpeg-js), on jette
// le ciel (teinte bleue claire) et les bords, puis on classe les pixels en
// familles de matiere (mur clair, matiere saturee type brique, sombre type
// zinc/toit, vitrage). On sort les clusters dominants par archetype, avec leur
// part, a cote des valeurs actuellement codees dans le jeu : l'ecart saute aux
// yeux et les reglages deviennent des mesures.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "jpeg-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PHOTOS = resolve(HERE, "../reference/photos");

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// Un pixel appartient au ciel s'il est clair et nettement bleu. Les photos de
// facade en contiennent souvent la moitie : le garder fausserait la moyenne.
function isSky(h, s, l) {
  return h > 185 && h < 265 && s > 0.12 && l > 0.45;
}

function analyze(data, width, height) {
  // Famille de matiere -> liste de pixels [r,g,b]
  const familles = { mur: [], matiere: [], sombre: [], vitrage: [] };
  // echantillonne grossierement : les photos font des megapixels
  const pas = Math.max(1, Math.floor(Math.sqrt((width * height) / 120000)));

  for (let y = Math.floor(height * 0.05); y < height * 0.97; y += pas) {
    for (let x = Math.floor(width * 0.04); x < width * 0.96; x += pas) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      if (isSky(h, s, l)) continue;

      if (l > 0.32 && l < 0.88 && s < 0.42) familles.mur.push([r, g, b]);
      else if (l > 0.18 && l < 0.72 && s >= 0.22 && (h < 70 || h > 330)) familles.matiere.push([r, g, b]);
      else if (l <= 0.22) familles.sombre.push([r, g, b]);
      else if (h > 180 && h < 265 && l < 0.45) familles.vitrage.push([r, g, b]);
    }
  }
  return familles;
}

// Regroupe par cube de couleurs (pas de 32 par canal) et renvoie les clusters
// dominants : couleur moyenne, part de la famille.
function clusters(pixels, top = 3) {
  const seaux = new Map();
  for (const [r, g, b] of pixels) {
    const k = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    let s = seaux.get(k);
    if (!s) seaux.set(k, (s = [0, 0, 0, 0]));
    s[0] += r; s[1] += g; s[2] += b; s[3]++;
  }
  const total = pixels.length || 1;
  return [...seaux.values()]
    .sort((a, b) => b[3] - a[3])
    .slice(0, top)
    .map((s) => ({ hex: hex(s[0] / s[3], s[1] / s[3], s[2] / s[3]), part: s[3] / total }));
}

// La comparaison avec les valeurs du jeu (src/lib/archetypes.ts) se fait dans
// reference/NOTES.md : ce module reste sans dependance au code TypeScript du
// jeu, Node ne digere pas ses const enum.

const manifest = JSON.parse(await readFile(join(PHOTOS, "manifest.json"), "utf8"));
const parArche = new Map();
for (const m of manifest) {
  if (!parArche.has(m.archetype)) parArche.set(m.archetype, []);
  parArche.get(m.archetype).push(m);
}

for (const [name, refs] of parArche) {
  console.log(`\n=== ${name} (${refs.length} photo${refs.length > 1 ? "s" : ""}) ===`);

  const cumul = { mur: [], matiere: [], sombre: [], vitrage: [] };
  for (const ref of refs) {
    if (!existsSync(join(PHOTOS, ref.file))) {
      console.log(`  ${ref.file.slice(0, 54).padEnd(56)} MANQUANTE (fetch-reference)`);
      continue;
    }
    const raw = await readFile(join(PHOTOS, ref.file));
    const { data, width, height } = decode(raw, { maxMemoryUsageInMB: 512 });
    const fam = analyze(data, width, height);
    for (const k of Object.keys(cumul)) cumul[k] = cumul[k].concat(fam[k]);
    console.log(
      `  ${ref.file.slice(0, 54).padEnd(56)} mur ${fam.mur.length}, matiere ${fam.matiere.length}, sombre ${fam.sombre.length}`,
    );
  }

  for (const [fam, label] of [
    ["mur", "murs clairs    "],
    ["matiere", "matiere saturee"],
    ["sombre", "sombres/toits  "],
    ["vitrage", "vitrages       "],
  ]) {
    const cs = clusters(cumul[fam]);
    if (!cs.length) continue;
    console.log(
      `  ${label}: ${cs.map((c) => `${c.hex} (${Math.round(c.part * 100)} %)`).join("  ")}`,
    );
  }
}
