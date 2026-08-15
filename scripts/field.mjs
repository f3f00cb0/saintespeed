#!/usr/bin/env node
// Le releve de terrain : ou aller, d'ou photographier, et quoi verifier.
//
//   npm run field                      # calcule les postes et ecrit la planche
//   npm run field -- --list            # les sujets, en une ligne chacun
//   npm run field -- import <dossier>  # range des photos sur leur EXIF
//
// Le calcul vit dans scripts/field.entry.ts (il importe les modules du jeu et
// est donc compile a la volee par esbuild, comme pour l'elevation). Ce lanceur
// s'occupe des fichiers : la planche HTML autonome a emporter sur le telephone,
// le plan JSON qui sert de reference a l'import, et le rangement des photos.
//
// La planche est autonome (images en data URI) parce qu'elle est faite pour
// etre ouverte dehors, sur un telephone, eventuellement sans reseau.

import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lisExif } from "./field-exif.mjs";
import { planche } from "./field-page.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SORTIE = resolve(ROOT, "reference/field");
const TERRAIN = resolve(ROOT, "reference/terrain");
const PLAN = resolve(SORTIE, "plan.json");

const args = process.argv.slice(2);

// Declarees avant l'aiguillage : les sous-commandes s'executent au chargement du
// module, et une constante declaree plus bas n'existe pas encore pour elles.
const R = 6378137, D2R = Math.PI / 180;

if (args[0] === "import") {
  importe(args[1]);
} else {
  await genere(args.includes("--list"));
}

/** Calcule les postes, rend les elevations, ecrit la planche. */
async function genere(listeSeule) {
  const tmp = await mkdtemp(join(tmpdir(), "saintespeed-field-"));
  let releve;
  try {
    const bundle = join(tmp, "entry.mjs");
    await build({
      entryPoints: [resolve(HERE, "field.entry.ts")],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "warning",
    });
    const mod = await import(pathToFileURL(bundle).href);
    if (existsSync(SORTIE)) rmSync(SORTIE, { recursive: true, force: true });
    mkdirSync(SORTIE, { recursive: true });
    releve = mod.releve(ROOT, SORTIE);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const { sujets, mesures } = releve;
  writeFileSync(PLAN, JSON.stringify({ genere: new Date().toISOString(), sujets }, null, 1));

  if (listeSeule) {
    for (const s of sujets) {
      const p = s.postes[0];
      console.log(
        `${s.clef.padEnd(26)} ${s.label.slice(0, 30).padEnd(31)} ` +
        `${String(s.postes.length).padStart(2)} poste(s)  cap ${String(p.cap).padStart(3)}°  ` +
        `recul ${String(p.recul).padStart(3)} m  ${p.lat},${p.lon}`,
      );
    }
    return;
  }

  const html = planche(sujets, SORTIE);
  const page = resolve(SORTIE, "index.html");
  writeFileSync(page, html);

  const alertes = sujets.filter((s) => s.alertes.length);
  console.log(
    `${sujets.length} sujets : ${mesures.reperes} reperes, ${mesures.objets} objets ponctuels.\n` +
    `${mesures.faceMesuree} facades choisies par la mesure (le kit n'en designe pas),\n` +
    `${mesures.postesEnPlus} postes en plus la ou une seule photo ne suffit pas,\n` +
    `${alertes.length} sujets avec une alerte d'acces.\n\n` +
    `planche : ${page}  (${(html.length / 1e6).toFixed(1)} Mo)\n` +
    `plan    : ${PLAN}`,
  );
  for (const s of alertes.slice(0, 8)) console.log(`  ! ${s.label} : ${s.alertes[0]}`);
  if (alertes.length > 8) console.log(`  ... et ${alertes.length - 8} autres, voir la planche`);
}

/**
 * Range un dossier de photos sur leur EXIF. Chaque photo porte sa position et,
 * sur un telephone, le cap de la boussole au declenchement : c'est assez pour la
 * rattacher a un sujet sans rien saisir a la main, et pour MESURER l'ecart entre
 * le poste vise et le poste reel. Cet ecart est la seule facon de savoir si un
 * poste calcule tenait debout sur le terrain.
 */
function importe(dossier) {
  if (!dossier) {
    console.error("usage : npm run field -- import <dossier de photos>");
    process.exit(1);
  }
  if (!existsSync(PLAN)) {
    console.error("pas de plan : lancer d'abord `npm run field`");
    process.exit(1);
  }
  const { sujets } = JSON.parse(readFileSync(PLAN, "utf8"));
  const src = resolve(dossier);
  const fichiers = readdirSync(src).filter((f) => /\.(jpe?g|JPE?G|heic|HEIC)$/.test(f));
  if (!fichiers.length) {
    console.log(`aucune photo dans ${src}`);
    return;
  }

  mkdirSync(TERRAIN, { recursive: true });
  const manifPath = resolve(TERRAIN, "manifest.json");
  const manif = existsSync(manifPath) ? JSON.parse(readFileSync(manifPath, "utf8")) : { photos: [] };
  const deja = new Set(manif.photos.map((p) => p.origine));

  let pris = 0, sansGps = 0, horsSujet = 0;
  for (const f of fichiers) {
    if (deja.has(f)) continue;
    if (extname(f).toLowerCase() === ".heic") {
      console.log(`  ${f} : HEIC, non lu (exporter en JPEG depuis le telephone)`);
      continue;
    }
    const exif = lisExif(readFileSync(resolve(src, f)));
    if (!exif || exif.lon === undefined || exif.lat === undefined) {
      sansGps++;
      console.log(`  ${f} : pas de position dans l'EXIF, laisse de cote`);
      continue;
    }
    const m = rattache(exif, sujets);
    if (!m.sujet) {
      horsSujet++;
      console.log(
        `  ${f} : ${m.dosTourne
          ? "le sujet le plus proche etait dans le dos de l'appareil"
          : "aucun poste a moins de 120 m"}, laisse de cote`,
      );
      continue;
    }
    const n = manif.photos.filter((p) => p.clef === m.sujet.clef).length + 1;
    const nom = `${m.sujet.clef}-${n}.jpg`;
    copyFileSync(resolve(src, f), resolve(TERRAIN, nom));
    manif.photos.push({
      fichier: nom,
      origine: f,
      clef: m.sujet.clef,
      label: m.sujet.label,
      lon: exif.lon,
      lat: exif.lat,
      cap: exif.cap ?? null,
      focale35: exif.focale35 ?? null,
      date: exif.date ?? null,
      ecartPoste: Math.round(m.ecartPoste),
      ecartCap: m.ecartCap === null ? null : Math.round(m.ecartCap),
      auteur: "photo de terrain, droits de l'auteur du depot",
    });
    pris++;
    console.log(
      `  ${f} -> ${nom}  (${m.sujet.label}, ` +
      `${Math.round(m.ecartPoste)} m du poste` +
      `${m.ecartCap === null ? "" : `, ${Math.round(m.ecartCap)}° de cap d'ecart`})`,
    );
  }

  writeFileSync(manifPath, JSON.stringify(manif, null, 1));
  console.log(
    `\n${pris} photos rangees dans reference/terrain, ` +
    `${sansGps} sans position, ${horsSujet} hors sujet.\n` +
    `manifeste : ${manifPath}`,
  );
}

function metres(lon1, lat1, lon2, lat2) {
  const k = Math.cos(((lat1 + lat2) / 2) * D2R);
  return Math.hypot((lon2 - lon1) * D2R * k * R, (lat2 - lat1) * D2R * R);
}
function cap(lon1, lat1, lon2, lat2) {
  const k = Math.cos(((lat1 + lat2) / 2) * D2R);
  return ((Math.atan2((lon2 - lon1) * k, lat2 - lat1) * 180) / Math.PI + 360) % 360;
}

/**
 * A quel sujet appartient une photo.
 *
 * On compare a la distance au POSTE, pas au centre du sujet, et l'essai l'a
 * impose : une photo prise pile au poste de l'Hotel de Ville tombe a 76 m de
 * son centre, parce qu'un poste est justement en retrait de la facade. Notee
 * ainsi, elle etait rattachee a une statue situee a 35 m. Le poste est la
 * bonne reference, c'est lui qu'on a suivi pour se placer.
 *
 * Le cap de la boussole sert de garde-fou : un sujet qu'on ne regardait pas est
 * ecarte, meme si on etait juste devant. C'est ce qui distingue deux sujets dos
 * a dos sur la meme place.
 */
function rattache(exif, sujets) {
  let best = null;
  let dosTourne = false;
  for (const s of sujets) {
    let proche = Infinity;
    for (const p of s.postes) proche = Math.min(proche, metres(exif.lon, exif.lat, p.lon, p.lat));
    if (proche > 120) continue;
    const vers = cap(exif.lon, exif.lat, s.lon, s.lat);
    let ecartCap = null;
    if (exif.cap !== undefined) {
      ecartCap = Math.abs(((vers - exif.cap + 540) % 360) - 180);
      // L'appareil tournait le dos au sujet : on le retient pour pouvoir le
      // dire, une photo non rattachee pour cette raison n'est pas une photo
      // prise trop loin.
      if (ecartCap > 75) { dosTourne = true; continue; }
    }
    // Un degre d'ecart de visee vaut a peu pres un metre d'ecart de position :
    // les deux disent la meme chose, "ce n'est pas tout a fait ce sujet".
    const cout = proche + (ecartCap ?? 0) * 0.6;
    if (!best || cout < best.cout) best = { sujet: s, cout, ecartPoste: proche, ecartCap };
  }
  return best ?? { sujet: null, dosTourne };
}
