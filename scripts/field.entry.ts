// Le releve de terrain : d'ou se placer, en vrai, pour photographier ce que la
// scene affirme. La partie qui a besoin des modules du jeu ; le lanceur est
// scripts/field.mjs, qui la compile a la volee comme pour l'elevation.
//
// Pourquoi cet outil existe. Sur les 17 reperes bespoke poses sur une emprise,
// 6 seulement ont une photo dans reference/photos : les 11 autres ont ete
// modelises sur du texte. Ce que ca coute est chiffre, c'est la reprise de
// l'Hotel de Ville : campanile invente, statues a dix metres de leur place,
// sept marches au lieu de seize. Aucune de ces erreurs n'etait une erreur de
// rendu, toutes venaient de l'absence d'image.
//
// Ce que le releve calcule, et qui n'est pas une liste de courses : le POSTE de
// prise de vue. Il part du repere du jeu (frameOf, meme centre de bbox, meme
// rot mesure), prend la facade que le kit compose (LANDMARKS.face), recule de
// ce qu'il faut pour la cadrer au telephone, et rend une position GPS et un cap
// boussole. Une photo prise a ce poste se superpose au rendu de
// `npm run elevation` : c'est ce qui permet de comparer au lieu d'apprecier.
//
// Le recul n'est pas theorique. Il est verifie contre l'espace public reel
// (chaussees, rues pietonnes, chemins, places, parcs, parkings) : si le poste
// ideal tombe dans un batiment ou derriere une grille, il est ramene au dernier
// point accessible, et le cadrage qui en decoule dicte le nombre de postes.
// Centre Deux demande 239 m de recul pour ses 321 m de facade, recul qui
// n'existe nulle part : la reponse utile n'est pas "recule", c'est "voici les
// six postes qui couvrent la facade".

import { readFileSync } from "node:fs";
import { makeProjector, type Projector } from "../src/lib/project";
import { prepareBuildings, CITY_CENTRE, type Building } from "../src/lib/buildings";
import { frameOf, type Frame } from "../src/lib/frame";
import { newEmit, type Emit } from "../src/lib/landmarkGeometry";
import { LANDMARK_KITS, SYNTHETIC_LANDMARKS, type KitBuilder } from "../src/lib/landmarks";
import { LANDMARKS } from "../src/lib/archetypes";
import { kitForPointKind } from "../src/lib/monuments";
import { MONUMENT_POINTS, POINT_KIND_NAMES } from "../src/lib/monumentPoints";
import { render, renderSynthetic, renderKind, type Side } from "./elevation.entry";
import { QUESTIONS, TYPOLOGIE_QUESTIONS, DEFAUT_QUESTIONS, NOMS } from "./field-questions";

// --- Optique -----------------------------------------------------------------
//
// Champs d'un telephone recent sur son objectif principal (~26 mm equivalent),
// en 4:3. Le grand angle ultra (~13 mm) existe mais deforme les verticales, ce
// qui est exactement ce qu'une photo de reference d'architecture ne doit pas
// faire : on cadre au principal, quitte a multiplier les postes.
const HFOV_PAYSAGE = (73 * Math.PI) / 180;
const VFOV_PAYSAGE = (56 * Math.PI) / 180;
const OEIL = 1.6; // hauteur de prise de vue, bras tendu

/** Marge autour du sujet dans le cadre : on ne colle jamais aux bords. */
const MARGE = 1.12;

export type Poste = {
  lon: number;
  lat: number;
  /** Cap boussole a viser, en degres depuis le nord vrai. */
  cap: number;
  /** Recul depuis le nu de facade, en metres. */
  recul: number;
  /** Largeur de sujet reellement cadree depuis ce poste, en metres. */
  couvre: number;
  /** Distance de ce poste a l'espace public le plus proche (0 = dessus). */
  marche: number;
  /** Ce sur quoi on se tient, quand c'est connu. */
  sol: string;
};

export type Sujet = {
  clef: string;
  label: string;
  genre: "emprise" | "synthetique" | "objet";
  osm?: number;
  lon: number;
  lat: number;
  /** Cote du repere local regarde, et d'ou vient ce choix. */
  face: Side;
  faceSource: "repere" | "mesure" | "indifferent";
  largeur: number;
  hauteur: number;
  /** Recul qu'il faudrait pour tout cadrer d'un coup, meme s'il est impossible. */
  reculIdeal: number;
  /** Vrai quand le sujet est plus haut que large : a tenir en portrait. */
  portrait: boolean;
  postes: Poste[];
  elevation: string | null;
  questions: string[];
  alertes: string[];
};

// --- Index spatial -----------------------------------------------------------
//
// 39 161 segments de chaussee et 57 630 emprises : le balayage lineaire coute
// une seconde par point interroge, et le releve en interroge des milliers (une
// recherche de recul balaie metre par metre). Grille reguliere de 100 m, la
// meme idee que le streaming par anneaux du jeu.

const CELL = 100;

class Grille<T> {
  private cases = new Map<number, T[]>();
  private static clef(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }
  ajoute(minx: number, miny: number, maxx: number, maxy: number, item: T) {
    const i0 = Math.floor(minx / CELL), i1 = Math.floor(maxx / CELL);
    const j0 = Math.floor(miny / CELL), j1 = Math.floor(maxy / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = Grille.clef(i, j);
        const c = this.cases.get(k);
        if (c) c.push(item); else this.cases.set(k, [item]);
      }
    }
  }
  /** Tout ce qui touche le carre de rayon r autour du point. */
  autour(x: number, y: number, r: number): T[] {
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((y - r) / CELL), j1 = Math.floor((y + r) / CELL);
    const out: T[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const c = this.cases.get(Grille.clef(i, j));
        if (c) out.push(...c);
      }
    }
    return out;
  }
}

type Seg = { ax: number; ay: number; bx: number; by: number; sol: string };
type Poly = { ring: { x: number; y: number }[]; sol: string };

function distSeg(x: number, y: number, s: Seg): number {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((x - s.ax) * dx + (y - s.ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (s.ax + t * dx), y - (s.ay + t * dy));
}

function dansPoly(x: number, y: number, ring: { x: number; y: number }[]): boolean {
  let dedans = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) dedans = !dedans;
  }
  return dedans;
}

/**
 * L'espace public : ce sur quoi on a le droit de se tenir avec un appareil.
 * Les voies rapides en sont exclues (on ne photographie pas depuis une bretelle
 * de rocade), les rues pietonnes, chemins, places, parcs et parkings en font
 * partie. Sans les surfaces pietonnes le releve est faux la ou il compte le
 * plus : le parvis de l'Hotel de Ville n'est pas une rue, et les longues
 * facades de La Platine sont a 79 m de la premiere chaussee.
 */
class EspacePublic {
  private segs = new Grille<Seg>();
  private polys = new Grille<Poly>();
  private eaux = new Grille<Poly>();
  private vasques: { x: number; y: number; r: number }[] = [];

  constructor(proj: Projector, routes: any, features: any) {
    const ligne = (coords: number[][], sol: string) => {
      let p = proj.project(coords[0][0], coords[0][1]);
      for (let i = 1; i < coords.length; i++) {
        const q = proj.project(coords[i][0], coords[i][1]);
        const s: Seg = { ax: p.x, ay: p.y, bx: q.x, by: q.y, sol };
        this.segs.ajoute(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y), s);
        p = q;
      }
    };

    const RAPIDE = new Set(["motorway", "trunk", "motorway_link", "trunk_link"]);
    for (const f of routes.features) {
      if (!f.geometry || f.geometry.type !== "LineString") continue;
      const h = f.properties?.highway;
      if (RAPIDE.has(h)) continue;
      ligne(f.geometry.coordinates, h === "footway" || h === "pedestrian" ? "rue pietonne" : "trottoir");
    }
    for (const l of features.pedLines ?? []) ligne(l.g, "rue pietonne");
    for (const p of features.paths ?? []) ligne(p.g, "chemin");

    const SURFACE: Record<string, string> = {
      pedestrian: "place pietonne", park: "parc", parking: "parking",
    };
    for (const a of features.areas ?? []) {
      const sol = SURFACE[a.k];
      if (!sol && a.k !== "water") continue;
      const ring = a.g.map(([lon, lat]: number[]) => proj.project(lon, lat));
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of ring) {
        if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
      }
      (a.k === "water" ? this.eaux : this.polys).ajoute(minx, miny, maxx, maxy, { ring, sol: sol ?? "eau" });
    }
    // Les bassins de la couche decor, avec leur rayon. Sans eux, le releve
    // envoyait photographier Daphne a 4 m de son axe, c'est-a-dire au milieu du
    // bassin de 8,8 m dans lequel elle se tient.
    for (const [lon, lat, r] of features.fountains ?? []) {
      const p = proj.project(lon, lat);
      this.vasques.push({ x: p.x, y: p.y, r });
    }
  }

  /** Vrai si le point est dans l'eau : un bassin, une vasque, une riviere. */
  mouille(x: number, y: number): boolean {
    for (const v of this.vasques) {
      if (Math.hypot(x - v.x, y - v.y) < v.r) return true;
    }
    for (const p of this.eaux.autour(x, y, 1)) if (dansPoly(x, y, p.ring)) return true;
    return false;
  }

  /** Distance a l'espace public le plus proche, et sa nature. 0 = on est dessus. */
  distance(x: number, y: number): { d: number; sol: string } {
    for (const p of this.polys.autour(x, y, 1)) {
      if (dansPoly(x, y, p.ring)) return { d: 0, sol: p.sol };
    }
    let best = Infinity, sol = "hors espace public";
    for (let r = CELL; r <= 400; r += CELL) {
      for (const s of this.segs.autour(x, y, r)) {
        const d = distSeg(x, y, s);
        if (d < best) { best = d; sol = s.sol; }
      }
      if (best < r) break;
    }
    // Un trottoir n'est pas dans la donnee : la chaussee est un axe, on se tient
    // a environ 4 m de cet axe sans etre pour autant "loin".
    return { d: Math.max(0, best - 4), sol: best === Infinity ? "hors espace public" : sol };
  }
}

/**
 * Les emprises baties. Elles servent deux fois : ne pas envoyer se poster dans
 * un mur, et savoir ce qui BOUCHE LA VUE. Le second usage est le plus utile.
 * Sans lui le releve prend le recul le plus grand qui tombe sur un sol public,
 * et il envoyait donc photographier Centre Deux depuis 243 m, a travers trois
 * ilots. Une facade ne se photographie pas au travers du bati.
 */
class Bati {
  private grille = new Grille<{ id: number; ring: { x: number; y: number }[] }>();
  constructor(emprises: { id: number; ring: { x: number; y: number }[] }[]) {
    for (const { id, ring } of emprises) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of ring) {
        if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
      }
      this.grille.ajoute(minx, miny, maxx, maxy, { id, ring });
    }
  }
  /** `sauf` exclut l'emprise du sujet lui-meme, qu'on regarde justement. */
  dedans(x: number, y: number, sauf?: number): boolean {
    for (const b of this.grille.autour(x, y, 1)) {
      if (b.id !== sauf && dansPoly(x, y, b.ring)) return true;
    }
    return false;
  }
}

// --- Geometrie du poste ------------------------------------------------------

const COTES: Side[] = ["y-", "y+", "x-", "x+"];

/** Milieu de facade et normale sortante, en coordonnees monde. */
function facadeDe(f: Frame, cote: Side) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  const local = {
    "y-": { lx: 0, ly: f.miny, nx: 0, ny: -1, span: f.w },
    "y+": { lx: 0, ly: f.maxy, nx: 0, ny: 1, span: f.w },
    "x-": { lx: f.minx, ly: 0, nx: -1, ny: 0, span: f.d },
    "x+": { lx: f.maxx, ly: 0, nx: 1, ny: 0, span: f.d },
  }[cote];
  return {
    x: f.x + local.lx * c - local.ly * s,
    y: f.y + local.lx * s + local.ly * c,
    nx: local.nx * c - local.ny * s,
    ny: local.nx * s + local.ny * c,
    // Direction le long de la facade, pour repartir plusieurs postes.
    tx: -(local.nx * s + local.ny * c),
    ty: local.nx * c - local.ny * s,
    span: local.span,
  };
}

/**
 * Le NU de facade sur une ligne de visee : le dernier point du contour REEL
 * rencontre en sortant du batiment. Le milieu de la face de bbox ne suffit pas.
 * L'ecart entre centroide et centre de bbox monte a 19,1 m sur les Nouvelles
 * Galeries : sur une emprise en L ou a cour, ce milieu tombe hors du batiment,
 * parfois dans le voisin, et le releve concluait alors a 3 m de recul dans une
 * rue qui en fait douze.
 */
function nuFacade(
  ring: { x: number; y: number }[], cx: number, cy: number, nx: number, ny: number,
): { x: number; y: number } | null {
  let tMax = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = nx * ey - ny * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - cx) * ey - (a.y - cy) * ex) / den;
    const u = (nx * (a.y - cy) - ny * (a.x - cx)) / -den;
    if (t > 0 && u >= 0 && u <= 1 && t > tMax) tMax = t;
  }
  return tMax > 0 ? { x: cx + nx * tMax, y: cy + ny * tMax } : null;
}

/**
 * Recul necessaire pour cadrer une facade de `largeur` sur `hauteur`, et dans
 * quel sens tenir l'appareil. Le sens n'est pas un detail de confort : sur la
 * cathedrale, 30 m de large pour 40 m de haut, le paysage demande 81 m de recul
 * et le portrait 58 m. Vingt-trois metres de difference decident si la photo
 * est possible depuis le parvis ou pas.
 */
function cadrage(largeur: number, hauteur: number): { recul: number; hfov: number; portrait: boolean } {
  const hors = Math.max(OEIL, hauteur - OEIL) * MARGE;
  const large = (largeur * MARGE) / 2;
  const paysage = Math.max(large / Math.tan(HFOV_PAYSAGE / 2), hors / Math.tan(VFOV_PAYSAGE / 2));
  const portrait = Math.max(large / Math.tan(VFOV_PAYSAGE / 2), hors / Math.tan(HFOV_PAYSAGE / 2));
  return portrait < paysage
    ? { recul: Math.max(portrait, 3), hfov: VFOV_PAYSAGE, portrait: true }
    : { recul: Math.max(paysage, 3), hfov: HFOV_PAYSAGE, portrait: false };
}

/** Cap boussole (degres depuis le nord) d'une direction du repere metrique. */
function capDe(dx: number, dy: number): number {
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Le poste effectif. On s'ECARTE du sujet metre par metre, et on s'arrete des
 * qu'une emprise batie coupe la ligne de vue : au-dela, le sujet n'est plus
 * visible, quel que soit le confort du trottoir. Parmi les points restants on
 * garde le plus recule qui tienne dans l'espace public, ce qui donne le meilleur
 * cadrage reellement disponible.
 *
 * Un bassin n'arrete pas la vue mais on ne s'y tient pas : il est saute, pas
 * bloquant. C'est ce qui distingue Daphne, statue DE bassin, d'une statue posee
 * a cote : il faut se poster sur la margelle, donc plus loin que le cadrage
 * ideal, et le releve doit le dire au lieu d'envoyer dans l'eau.
 */
function reculPossible(
  fx: number, fy: number, nx: number, ny: number, ideal: number, depart: number,
  espace: EspacePublic, bati: Bati, sauf?: number,
): { recul: number; marche: number; sol: string; bloque: number } {
  type Cand = { recul: number; marche: number; sol: string };
  const dedans: Cand[] = []; // dans le cadrage ideal
  const dehors: Cand[] = []; // au-dela, quand rien n'est disponible avant
  let bloque = Infinity;
  const limite = Math.max(ideal, depart) + 25;
  for (let d = depart; d <= limite; d += 1) {
    const x = fx + nx * d, y = fy + ny * d;
    if (bati.dedans(x, y, sauf)) { bloque = d; break; }
    if (espace.mouille(x, y)) continue;
    const { d: marche, sol } = espace.distance(x, y);
    (d <= ideal ? dedans : dehors).push({ recul: d, marche, sol });
  }
  const public_ = (c: Cand) => c.marche <= 12;
  const dansCadre = dedans.filter(public_);
  if (dansCadre.length) return { ...dansCadre[dansCadre.length - 1], bloque };
  const apres = dehors.filter(public_);
  if (apres.length) return { ...apres[0], bloque };
  const tous = [...dedans, ...dehors];
  if (tous.length) {
    return { ...tous.reduce((a, b) => (b.marche < a.marche ? b : a)), bloque };
  }
  return { recul: Math.max(depart, 3), marche: Infinity, sol: "hors espace public", bloque };
}

function posteAu(
  proj: Projector, fx: number, fy: number, nx: number, ny: number,
  recul: number, marche: number, sol: string, hfov: number,
): Poste {
  const { lon, lat } = proj.unproject(fx + nx * recul, fy + ny * recul);
  return {
    lon: +lon.toFixed(6),
    lat: +lat.toFixed(6),
    cap: Math.round(capDe(-nx, -ny)),
    recul: Math.round(recul),
    couvre: Math.round((2 * recul * Math.tan(hfov / 2)) / MARGE),
    marche: Math.round(marche),
    sol,
  };
}

/** Etendue locale de la geometrie produite par un kit sans emprise. */
function etendueKit(build: KitBuilder, rot: number): { largeur: number; hauteur: number } {
  const f: Frame = {
    x: 0, y: 0, rot, w: 0, d: 0, area: 0, height: 0,
    minx: 0, maxx: 0, miny: 0, maxy: 0,
  };
  const e: Emit = newEmit();
  build(e, f, { tileU: 18.6, patch: [0.5, 0.5] } as any, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, f);
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  let miny = Infinity, maxy = -Infinity;
  for (const buf of [e.walls, e.roofs, e.glow]) {
    for (let i = 0; i < buf.pos.length; i += 3) {
      const x = buf.pos[i], z = buf.pos[i + 1], y = -buf.pos[i + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
  }
  if (!Number.isFinite(minx)) return { largeur: 6, hauteur: 4 };
  return {
    largeur: Math.max(maxx - minx, maxy - miny),
    hauteur: Math.max(maxz - Math.min(0, minz), 1),
  };
}

// --- Le releve ---------------------------------------------------------------

export function releve(racine: string, sortie: string): { sujets: Sujet[]; mesures: Record<string, number> } {
  const proj = makeProjector(CITY_CENTRE.lon, CITY_CENTRE.lat);
  const cachePath = `${racine}/public/sainte-buildings.json`;
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  const brut: Building[] = cache.buildings.map((b: any) => ({
    id: b.i, ring: b.g, levels: b.l, height: b.h, kind: b.k, material: b.m,
    colour: b.c, roofShape: b.rs, name: b.n, zone: b.z, shop: b.s,
  }));
  const plat = prepareBuildings(brut, proj);
  const espace = new EspacePublic(
    proj,
    JSON.parse(readFileSync(`${racine}/public/sainte.geojson`, "utf8")),
    JSON.parse(readFileSync(`${racine}/public/sainte-features.json`, "utf8")),
  );
  const bati = new Bati(plat.map((b) => ({ id: b.id, ring: b.ring })));

  const sujets: Sujet[] = [];
  const mesures: Record<string, number> = {
    reperes: 0, objets: 0, postesEnPlus: 0, horsEspacePublic: 0, faceMesuree: 0,
    emprises: plat.length,
  };

  // 1) Les reperes poses sur une emprise OSM.
  for (const [id, kit] of LANDMARK_KITS) {
    const b = plat.find((x) => x.id === id);
    const lm = LANDMARKS.get(id);
    if (!b || !lm) continue;
    void kit;
    const f = frameOf(b.ring, b.height, lm.rot);

    // Le cote vient du repere quand le kit compose une facade principale. Quand
    // il n'en compose pas (volume symetrique : une tour, une halle, un auvent de
    // quai), il n'y a pas de bonne reponse dans la donnee : on prend alors le
    // cote d'ou le sujet est reellement accessible, et on le dit.
    // Le nu de facade sur une ligne de visee donnee, en partant de l'interieur.
    const viser = (t: number, cote: ReturnType<typeof facadeDe>) => {
      const cx = f.x + cote.tx * t, cy = f.y + cote.ty * t;
      return nuFacade(b.ring, cx, cy, cote.nx, cote.ny) ?? { x: cx + cote.nx * 0.1, y: cy + cote.ny * 0.1 };
    };

    let face: Side;
    let faceSource: Sujet["faceSource"];
    if (lm.face) {
      face = lm.face;
      faceSource = "repere";
    } else {
      // Le critere n'est pas "le cote le plus accessible" mais "le cote d'ou on
      // voit le plus de sujet". Les deux different : l'auvent du quai sud de
      // Carnot fait 63 m de long sur 2,6 m de large, et se photographier par son
      // pignon de 2,6 m est parfaitement accessible et parfaitement inutile.
      let best: { cote: Side; vu: number } | null = null;
      for (const cote of COTES) {
        const fa = facadeDe(f, cote);
        const cad = cadrage(fa.span, b.height);
        const nu = viser(0, fa);
        const p = reculPossible(nu.x, nu.y, fa.nx, fa.ny, cad.recul, 3, espace, bati, id);
        const couvre = (2 * p.recul * Math.tan(cad.hfov / 2)) / MARGE;
        const vu = Math.min(couvre, fa.span) * (p.marche <= 12 ? 1 : 0.2);
        if (!best || vu > best.vu) best = { cote, vu };
      }
      face = best!.cote;
      faceSource = "mesure";
      mesures.faceMesuree++;
    }

    const fa = facadeDe(f, face);
    const hauteur = b.height;
    const cad = cadrage(fa.span, hauteur);
    const ideal = cad.recul;
    const nu0 = viser(0, fa);
    const p0 = reculPossible(nu0.x, nu0.y, fa.nx, fa.ny, ideal, 3, espace, bati, id);
    const couvre = (2 * p0.recul * Math.tan(cad.hfov / 2)) / MARGE;

    const postes: Poste[] = [];
    const alertes: string[] = [];
    // Trois metres de facade en trop ne valent pas un deuxieme deplacement : on
    // recule d'un pas ou on cadre un peu large. Sans cette tolerance le releve
    // demandait deux postes pour un kiosque de 11 m.
    if (fa.span - couvre <= 3) {
      postes.push(posteAu(proj, nu0.x, nu0.y, fa.nx, fa.ny, p0.recul, p0.marche, p0.sol, cad.hfov));
    } else {
      // Le recul disponible ne cadre pas la facade : on repartit des postes le
      // long d'elle, chacun cadrant sa part. C'est la reponse utile, "recule
      // encore" n'en est pas une quand il n'y a plus de recul.
      //
      // On SONDE la facade avant de decider. Le recul disponible varie beaucoup
      // le long d'une facade longue, et les deux methodes evidentes echouent
      // chacune d'un cote : n postes a intervalles egaux calcules sur le milieu
      // n'en couvrent que 215 sur les 321 m de Centre Deux, et un placement de
      // proche en proche rampe la ou la vue est bouchee, jusqu'a huit postes de
      // 4 m sous le viaduc de Carnot. Neuf sondes, puis une decision.
      const posteA = (t: number) => {
        const nu = viser(t, fa);
        const pi = reculPossible(nu.x, nu.y, fa.nx, fa.ny, ideal, 3, espace, bati, id);
        return { t, marche: pi.marche, p: posteAu(proj, nu.x, nu.y, fa.nx, fa.ny, pi.recul, pi.marche, pi.sol, cad.hfov) };
      };
      const SONDES = 9;
      const sondes = [];
      for (let i = 0; i < SONDES; i++) {
        sondes.push(posteA(-fa.span / 2 + (fa.span / SONDES) * (i + 0.5)));
      }
      const tenables = sondes.filter((s) => s.marche <= 12);
      const utiles = tenables.filter((s) => s.p.couvre >= 8);
      const median = utiles.length
        ? [...utiles].sort((a, b) => a.p.couvre - b.p.couvre)[utiles.length >> 1].p.couvre
        : 0;

      if (!median) {
        // Aucune sonde ne cadre plus de 8 m : la facade n'est pas photographiable
        // d'un seul tenant depuis l'espace public. Deux postes aux meilleurs
        // endroits valent mieux que huit postes de quatre metres.
        const meilleurs = [...(tenables.length ? tenables : sondes)]
          .sort((a, b) => b.p.couvre - a.p.couvre)
          .slice(0, 2)
          .sort((a, b) => a.t - b.t);
        postes.push(...meilleurs.map((s) => s.p));
        alertes.push(
          `facade de ${fa.span.toFixed(0)} m non cadrable depuis l'espace public : ` +
          `${meilleurs[0].p.couvre} m au mieux, ${postes.length} postes sur les degagements`,
        );
      } else {
        const n = Math.max(1, Math.min(6, Math.ceil(fa.span / median)));
        for (let i = 0; i < n; i++) {
          postes.push(posteA(-fa.span / 2 + (fa.span / n) * (i + 0.5)).p);
        }
        const vu = postes.reduce((a, p) => a + Math.min(p.couvre, fa.span / n), 0);
        alertes.push(
          `facade de ${fa.span.toFixed(0)} m : ${n} postes au lieu d'un, ` +
          `${Math.round(vu)} m couverts en tout`,
        );
      }
      mesures.postesEnPlus += postes.length - 1;
    }
    for (const p of postes) {
      if (p.marche > 12) {
        alertes.push(`poste a ${p.marche} m du premier espace public : verifier sur place qu'on peut y acceder`);
        mesures.horsEspacePublic++;
        break;
      }
    }
    // Le releve ne sait pas ce qui BOUCHE la vue : il verifie qu'on peut se
    // tenir au poste, pas qu'on y voit le sujet. Au-dela de 80 m, en ville, la
    // probabilite qu'un arbre ou une facade coupe la vue devient serieuse.
    if (postes[0].recul > 80) {
      alertes.push(`${postes[0].recul} m de recul : le releve ne verifie pas ce qui bouche la vue, a confirmer sur place`);
    }

    const centre = proj.unproject(f.x, f.y);
    const slug = id < 0 ? `rel${-id}` : `way${id}`;
    let elevation: string | null = `elevation-${slug}.jpg`;
    try {
      render(id, cachePath, `${sortie}/${elevation}`, face);
    } catch {
      elevation = null;
    }
    sujets.push({
      clef: slug,
      label: NOMS[slug] ?? lm.label,
      genre: "emprise",
      osm: id,
      lon: +centre.lon.toFixed(6),
      lat: +centre.lat.toFixed(6),
      face,
      faceSource,
      largeur: +fa.span.toFixed(1),
      hauteur: +hauteur.toFixed(1),
      reculIdeal: Math.round(ideal),
      portrait: cad.portrait,
      postes,
      elevation,
      questions: QUESTIONS[slug] ?? DEFAUT_QUESTIONS,
      alertes,
    });
    mesures.reperes++;
  }

  // 2) Les reperes sans emprise : le stade, et les objets de la place
  //    Jean-Jaures, qui n'existent dans OSM que par un point nomme.
  for (const syn of SYNTHETIC_LANDMARKS) {
    const { largeur, hauteur } = etendueKit(syn.build, syn.rot);
    const c = proj.project(syn.lon, syn.lat);
    const cad = cadrage(largeur, hauteur);
    const ideal = cad.recul;

    // Rien n'oriente ces objets vers une facade : on tourne autour et on prend
    // la direction d'ou ils sont accessibles.
    let best: { cap: number; nx: number; ny: number; p: ReturnType<typeof reculPossible> } | null = null;
    for (let a = 0; a < 360; a += 15) {
      const r = (a * Math.PI) / 180;
      const nx = Math.sin(r), ny = Math.cos(r);
      const p = reculPossible(c.x, c.y, nx, ny, ideal, largeur / 2 + 1, espace, bati);
      if (!best || p.marche < best.p.marche || (p.marche === best.p.marche && p.recul > best.p.recul)) {
        best = { cap: a, nx, ny, p };
      }
    }
    const { nx, ny, p } = best!;
    const alertes: string[] = [];
    if (p.marche > 12) {
      alertes.push(`poste a ${Math.round(p.marche)} m du premier espace public : verifier l'acces sur place`);
      mesures.horsEspacePublic++;
    }
    let elevation: string | null = `elevation-${syn.key}.jpg`;
    try {
      renderSynthetic(syn.key, `${sortie}/${elevation}`);
    } catch {
      elevation = null;
    }
    sujets.push({
      clef: syn.key,
      label: NOMS[syn.key] ?? syn.key.replace(/-/g, " "),
      genre: "synthetique",
      lon: syn.lon,
      lat: syn.lat,
      face: "y-",
      faceSource: "indifferent",
      largeur: +largeur.toFixed(1),
      hauteur: +hauteur.toFixed(1),
      reculIdeal: Math.round(ideal),
      portrait: cad.portrait,
      postes: [posteAu(proj, c.x, c.y, nx, ny, p.recul, p.marche, p.sol, cad.hfov)],
      elevation,
      questions: QUESTIONS[syn.key] ?? DEFAUT_QUESTIONS,
      alertes,
    });
    mesures.reperes++;
  }

  // 3) Les objets ponctuels poses : croix, monuments aux morts, steles, bustes,
  //    statues. Leur forme decoule de leur type, donc leur elevation aussi : on
  //    rend une planche par typologie, pas 55 fois la meme.
  const typoRendue = new Set<number>();
  for (let i = 0; i < MONUMENT_POINTS.length; i++) {
    const [lon, lat, kind, nom] = MONUMENT_POINTS[i];
    const typo = POINT_KIND_NAMES[kind];
    if (!typoRendue.has(kind)) {
      try {
        renderKind(typo, `${sortie}/elevation-type-${typo}.jpg`);
      } catch { /* la typologie n'a pas de kit : elle n'est pas posee */ }
      typoRendue.add(kind);
    }
    const kit = kitForPointKind(kind, i);
    if (!kit) continue;
    const { largeur, hauteur } = etendueKit(kit, 0);
    const c = proj.project(lon, lat);
    const cad = cadrage(largeur, hauteur);
    const ideal = cad.recul;
    let best: { nx: number; ny: number; p: ReturnType<typeof reculPossible> } | null = null;
    for (let a = 0; a < 360; a += 30) {
      const r = (a * Math.PI) / 180;
      const nx = Math.sin(r), ny = Math.cos(r);
      const p = reculPossible(c.x, c.y, nx, ny, ideal, largeur / 2 + 1, espace, bati);
      if (!best || p.marche < best.p.marche) best = { nx, ny, p };
    }
    const { nx, ny, p } = best!;
    sujets.push({
      clef: `objet-${i}`,
      label: nom || `${typo}, sans nom`,
      genre: "objet",
      lon, lat,
      face: "y-",
      faceSource: "indifferent",
      largeur: +largeur.toFixed(1),
      hauteur: +hauteur.toFixed(1),
      reculIdeal: Math.round(ideal),
      portrait: cad.portrait,
      postes: [posteAu(proj, c.x, c.y, nx, ny, p.recul, p.marche, p.sol, cad.hfov)],
      elevation: `elevation-type-${typo}.jpg`,
      questions: TYPOLOGIE_QUESTIONS[typo] ?? DEFAUT_QUESTIONS,
      alertes: p.marche > 12 ? [`poste a ${Math.round(p.marche)} m du premier espace public`] : [],
    });
    mesures.objets++;
  }

  return { sujets, mesures };
}
