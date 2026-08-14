#!/usr/bin/env node
// Photos de reference du vrai Saint-Etienne, depuis Wikimedia Commons.
//   npm run fetch-reference             telecharge la selection dans reference/photos/
//   npm run fetch-reference -- --list   liste les candidates par categorie (rien ne part sur disque)
//
// Le but : caler les archetypes de facade (palette, trame, details) sur des
// photos du terrain plutot qu'a l'intuition, et garder la planche de comparaison
// (reference/index.html) honnete. Les images restent hors public/ : c'est un
// outil de developpement, jamais embarque dans le build de production.
//
// Deux temps : --list pour choisir, puis une selection curatée en dur ci-dessous
// (deterministe, comme le reste du projet : pas de tirage). Chaque photo
// telechargee garde sa licence, son auteur et son URL d'origine dans
// reference/photos/manifest.json.

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../reference/photos");

const API = "https://commons.wikimedia.org/w/api.php";
const UA = "SainteSpeed-reference/0.1 (outil de developpement local; photos de reference)";
const WIDTH = 1280; // largeur des vignettes telechargees, pas les originaux de 12 Mo

// Patience envers l'API : on est un client poli, pas un bot d'indexation.
// Une 429 attend son compte de secondes puis retente, au lieu d'echouer sec.
const PAUSE_MS = 2500;
const RETRY_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?format=json&origin=*&${new URLSearchParams(params)}`;
  for (let essai = 0; ; essai++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 && essai < 2) {
      console.warn(`  429 (limite de debit), pause ${RETRY_MS / 1000} s puis on retente…`);
      await sleep(RETRY_MS);
      continue;
    }
    if (!res.ok) throw new Error(`API Commons ${res.status}: ${url}`);
    return res.json();
  }
}

/** Fichiers d'une categorie, avec licence et auteur. */
async function listCategory(cat, limit = 12) {
  const d = await api({
    action: "query",
    generator: "categorymembers",
    gcmtitle: `Category:${cat}`,
    gcmtype: "file",
    gcmlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
  });
  const pages = d.query?.pages ?? {};
  return Object.values(pages)
    .map((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii) return null;
      const em = ii.extmetadata ?? {};
      return {
        title: p.title,
        width: ii.width,
        height: ii.height,
        url: ii.url,
        page: ii.descriptionurl,
        license: em.LicenseShortName?.value ?? "?",
        artist: (em.Artist?.value ?? "?").replace(/<[^>]*>/g, "").trim().slice(0, 80),
      };
    })
    .filter((f) => f && /\.jpe?g$/i.test(f.title) && f.width >= 900);
}

/** Recherche de fichiers en texte libre, pour les quartiers sans categorie. */
async function searchFiles(term, limit = 10) {
  const d = await api({
    action: "query",
    list: "search",
    srsearch: term,
    srnamespace: "6", // File:
    srlimit: String(limit),
  });
  const titles = (d.query?.search ?? []).map((r) => r.title);
  if (!titles.length) return [];
  const dd = await api({
    action: "query",
    titles: titles.join("|"),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
  });
  return Object.values(dd.query?.pages ?? {})
    .map((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii) return null;
      const em = ii.extmetadata ?? {};
      return {
        title: p.title,
        width: ii.width,
        height: ii.height,
        url: ii.url,
        page: ii.descriptionurl,
        license: em.LicenseShortName?.value ?? "?",
        artist: (em.Artist?.value ?? "?").replace(/<[^>]*>/g, "").trim().slice(0, 80),
      };
    })
    .filter((f) => f && /\.jpe?g$/i.test(f.title) && f.width >= 900);
}

// --- categories par archetype ------------------------------------------------
// Celles qui existaient au moment de l'ecriture. --list verifie leur contenu ;
// une categorie vide ou renomee n'est pas une erreur, elle est signalee.
const CATEGORIES = {
  pierre: [
    "Hôtel de ville de Saint-Étienne",
    "Place du Peuple (Saint-Étienne)",
    "Immeuble Fontaney, Saint-Étienne",
    "11 rue de la République, Saint-Étienne",
    "Immeuble - 15 rue Gambetta (Saint-Étienne)",
    "Opéra-théâtre de Saint-Étienne",
  ],
  brique: [
    "Manufacture Nationale d'Armes de Saint-Étienne",
    "Puits Couriot",
    "Place de la Manufacture-d'Armes (Saint-Étienne)",
  ],
  moderne: [
    "Cité du design",
    "Zénith de Saint-Étienne",
    "Gare de Saint-Étienne-Châteaucreux",
  ],
  // Pas de categorie dediee aux grands ensembles : recherche en texte libre.
  barre: { search: ["Montchovet", "Beaulieu Saint-Étienne immeuble", "Métare Saint-Étienne"] },
  faubourg: { cats: ["Rues de Saint-Étienne"], search: ["Saint-Étienne rue facade maison"] },
};

// --- selection curatée --------------------------------------------------------
// Title Commons -> archetype. Remplie apres revue des candidates (--list puis
// vignettes). Le script echoue si un titre n'existe plus : mieux vaut une
// erreur qu'une reference silencieusement perdue.
const SELECTION = [
  // pierre : le centre monumental et haussmannien
  { title: "File:Hôtel de ville de Saint-Étienne.jpg", archetype: "pierre" },
  { title: "File:Hôtel Ville - Saint-Étienne (FR42) - 2025-06-29 - 1.jpg", archetype: "pierre" },
  { title: "File:Saint Étienne-Les Nouvelles Galeries-2012 02 14.jpg", archetype: "pierre" },
  { title: "File:Immeuble de négociants 11, rue de la république saint etienne vue balcons.jpg", archetype: "pierre" },
  // brique : l'heritage minier et manufacturier
  { title: "File:Ancienne manufacture d'armes à Saint-Etienne.jpg", archetype: "brique" },
  { title: "File:Bâtiment Horloge Manufacture Armes - Saint-Étienne (FR42) - 2025-06-29 - 1.jpg", archetype: "brique" },
  { title: "File:Bâtiment Imprimerie Manufacture Armes - Saint-Étienne (FR42) - 2025-06-29 - 1.jpg", archetype: "brique" },
  { title: "File:Muscles de pierre ou de charbon - Flickr - Jeanne Menjoulet.jpg", archetype: "brique" },
  // moderne : la cite du design, la gare, le zenith
  { title: "File:Cité.du.Design.Saint-Etienne.Platine.jpg", archetype: "moderne" },
  { title: "File:Gare de Saint-Étienne-Châteaucreux (2011).JPG", archetype: "moderne" },
  { title: "File:Saint Étienne-Le Zénith-20120321.jpg", archetype: "moderne" },
  // barre : les grands ensembles, vus depuis les cretes faute de photos de rue
  { title: "File:Saint Étienne-Panorama depuis le Crêt de Roc-20120321.jpg", archetype: "barre" },
  { title: "File:Pano Saint Etienne Ouest Deschanel.jpg", archetype: "barre" },
  // faubourg : le tissu ordinaire
  { title: "File:Saint Étienne-Montreynaud VCdR-20120321.jpg", archetype: "faubourg" },
  { title: "File:Trolley STAS lig. 3, 42.jpg", archetype: "faubourg" },
];

const listOnly = process.argv.includes("--list");

let erreurs = 0;

if (listOnly) {
  for (const [arch, conf] of Object.entries(CATEGORIES)) {
    console.log(`\n--- ${arch} ---`);
    if (Array.isArray(conf)) {
      for (const cat of conf) {
        const files = await listCategory(cat).catch((e) => (console.warn(`  [${cat}] ${e.message}`), erreurs++, []));
        if (!files.length) console.log(`  [${cat}] aucune photo exploitable`);
        for (const f of files)
          console.log(`  [${cat}] ${f.title} (${f.width}x${f.height}, ${f.license}) ${f.artist}`);
        await sleep(PAUSE_MS);
      }
    } else {
      for (const cat of conf.cats ?? []) {
        const files = await listCategory(cat).catch((e) => (console.warn(`  [${cat}] ${e.message}`), erreurs++, []));
        if (!files.length) console.log(`  [${cat}] aucune photo exploitable`);
        for (const f of files)
          console.log(`  [${cat}] ${f.title} (${f.width}x${f.height}, ${f.license}) ${f.artist}`);
        await sleep(PAUSE_MS);
      }
      for (const term of conf.search ?? []) {
        const files = await searchFiles(term).catch((e) => (console.warn(`  "${term}" ${e.message}`), erreurs++, []));
        if (!files.length) console.log(`  "${term}" rien`);
        for (const f of files)
          console.log(`  "${term}" ${f.title} (${f.width}x${f.height}, ${f.license}) ${f.artist}`);
        await sleep(PAUSE_MS);
      }
    }
  }
  console.log(`\n${erreurs} erreur(s). Rien n'a ete telecharge.`);
  process.exit(erreurs ? 1 : 0);
}

if (!SELECTION.length) {
  console.log("Selection vide : lance d'abord `npm run fetch-reference -- --list`,");
  console.log("choisis tes photos, puis remplis SELECTION dans scripts/fetch-reference.mjs.");
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

for (const sel of SELECTION) {
  const dest = join(OUT, `${sel.archetype}_${sel.title.replace(/^File:/, "").replace(/[^a-zA-Z0-9._-]+/g, "_")}`);
  if (existsSync(dest)) {
    console.log(`deja la: ${dest}`);
    continue;
  }
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(sel.title.replace(/^File:/, ""))}?width=${WIDTH}`;
  let telechargee = false;
  for (let essai = 0; essai < 3; essai++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429) {
      console.warn(`  429 sur l'image, pause ${RETRY_MS / 1000} s…`);
      await sleep(RETRY_MS);
      continue;
    }
    if (!res.ok) {
      console.warn(`ECHEC ${sel.title}: HTTP ${res.status}`);
      break;
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`ok: ${dest}`);
    telechargee = true;
    break;
  }
  if (!telechargee) erreurs++;
  await sleep(PAUSE_MS * 2);
}

// Le manifeste porte la provenance : licence + auteur + page d'origine. Sans
// lui, les photos du dossier ne disent plus d'ou elles viennent ni a quelles
// conditions on les garde.
if (SELECTION.length) {
  const meta = [];
  for (const sel of SELECTION) {
    const d = await api({
      action: "query",
      titles: sel.title,
      prop: "imageinfo",
      iiprop: "url|extmetadata",
    });
    const p = Object.values(d.query?.pages ?? {})[0];
    const em = p?.imageinfo?.[0]?.extmetadata ?? {};
    meta.push({
      archetype: sel.archetype,
      file: `${sel.archetype}_${sel.title.replace(/^File:/, "").replace(/[^a-zA-Z0-9._-]+/g, "_")}`,
      title: sel.title,
      license: em.LicenseShortName?.value ?? "?",
      artist: (em.Artist?.value ?? "?").replace(/<[^>]*>/g, "").trim(),
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(sel.title.replace(/ /g, "_"))}`,
    });
    await sleep(PAUSE_MS);
  }
  await writeFile(join(OUT, "manifest.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`manifeste: ${join(OUT, "manifest.json")}`);
}

process.exit(erreurs ? 1 : 0);
