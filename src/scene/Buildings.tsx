import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FLOOR, insetRing, type FlatBuilding } from "../lib/buildings";
import { STYLES, hash01, type ArchetypeStyle } from "../lib/archetypes";
import { car } from "../lib/car";
import { editView } from "../lib/editView";
import { useStore } from "../state/store";
import { Lod, TILE, planStreaming, tileKey, type TileRef } from "../lib/streaming";
import { SHOP_BAYS, SHOP_TILE_U, SHOP_VARIANTS } from "../lib/facades";
import { getFacadeArray, getShopTexture, makeFacadeMaterial } from "../lib/facadeTextures";
import { LAYER_PATCH_UV, VARIANTS, tileOf, variantFor } from "../lib/facadeVariants";
import { Family } from "../lib/families";
import { kitFor } from "../lib/familyKits";
import { newEmit, type Buf as KitBuf, type Emit } from "../lib/landmarkGeometry";
import { NOTABLE } from "../lib/notable";
import { SINK, footingOf } from "../lib/footing";

// La peinture des facades vit dans lib/facades.ts : des canvas purs, sans
// three.js, pour que la planche de comparaison (reference/) puisse afficher
// exactement les memes tuiles que le jeu, a cote des photos du vrai
// Saint-Etienne. Ici on se contente de les emballer en textures.
//
// --- streaming -------------------------------------------------------------
//
// La geometrie n'est plus construite d'un bloc au chargement. A l'echelle de la
// ville entiere ca ferait 2,00 M de triangles et 247 Mo de tampons GPU, tous
// residents en permanence : le frustum culling n'y change rien, il epargne le
// dessin, pas la memoire. Les tuiles sont donc construites a la demande autour
// du joueur et liberees derriere lui. Voir lib/streaming.ts pour la politique.

const PARAPET = 0.75; // bandeau vertical des toits plats
// Rez-de-chaussee commercant : plus haut qu'un etage courant, comme les vrais.
// La jointure IGN mesure les etages a 1,22 fois nos 3,1 m en mediane, et le
// rez-de-chaussee d'un immeuble de rapport, avec sa devanture et son entresol,
// monte a 4 m et plus. A 3,1 m la vitrine lisait comme un etage de plus.
const GF_SHOP = 4.0;

// --- relief : le pied des batiments --------------------------------------------
//
// Un batiment se construit toujours dans son repere local, de 0 a sa hauteur,
// comme avant. Son "niveau de reference" Y0 est le milieu entre le point le plus
// bas et le plus haut du sol sous ses angles : c'est la que son 0 local se pose,
// donc la que ses etages se comptent et que son toit, plat, s'arrete a Y0 + h.
// Ses murs, eux, descendent a chaque angle jusqu'au sol de cet angle, et SINK
// en dessous : rue en pente, la facade aval montre un etage de plus, la facade
// amont s'enterre, comme les vrais immeubles stephanois accroches aux cotes.
// Mesure sur la BD TOPO : une emprise porte 1,7 m de denivele en mediane, 4,2 m
// au p90. Une altitude unique par batiment l'aurait fait flotter d'un cote.
/** Decale en y les sommets ecrits depuis `from` : du repere local au monde. */
function liftFrom(pos: number[], from: number, dy: number) {
  if (dy === 0) return;
  for (let i = from + 1; i < pos.length; i += 3) pos[i] += dy;
}
const ROOF_RISE = 1.9; // hauteur du bandeau incline des toits en pente

// Combien de tuiles au plus on construit par tick de streaming. Sans worker, la
// construction est synchrone : une tuile de 36 emprises coute environ 1,3 ms,
// donc trois tuiles tiennent dans une frame sans hoquet visible. Les plus
// proches du joueur passent en premier.
const BUILD_BUDGET = 3;

// Le streaming tourne a 6 Hz, pas a chaque frame : la position du joueur ne
// change pas assez en 16 ms pour justifier de replanifier 1 467 tuiles.
const STREAM_HZ = 6;

// --- geometrie --------------------------------------------------------------

/** fac : (calque de variante, gain emissif) par sommet, murs seulement. */
type Buf = { pos: number[]; norm: number[]; uv: number[]; col: number[]; fac?: number[] };
const newBuf = (): Buf => ({ pos: [], norm: [], uv: [], col: [] });

// pied de facade dans l'ombre, couronnement expose
function ramp(y: number, h: number): number {
  return 0.62 + 0.38 * Math.min(1, y / Math.max(h, 9));
}

const scratchTint = new THREE.Color();
const scratchRoof = new THREE.Color();

/** Teintes mur et toit d'un batiment, dans l'ordre de priorite des sources. */
function tintsOf(b: FlatBuilding, style: ArchetypeStyle) {
  let base =
    b.landmark?.wall ?? style.wall[Math.floor(hash01(b.id, 13) * style.wall.length) % style.wall.length];
  if (b.colour) {
    try {
      base = new THREE.Color().setStyle(b.colour).getHex();
    } catch {
      /* valeur OSM libre, on garde la palette */
    }
  }
  // decalage de clarte de plus ou moins 5 %, seede sur l'id : ca casse la
  // platitude d'un bloc sans casser la coherence de l'archetype
  const shade = 0.95 + hash01(b.id, 29) * 0.1;
  scratchTint.setHex(base).multiplyScalar(shade);
  // La matiere IGN (tuile, ardoise, zinc) passe avant la toiture generique de
  // l'archetype : un faubourg n'est pas tout en tuile, un centre pas tout en zinc.
  scratchRoof.setHex(b.landmark?.roof ?? b.roofColour ?? style.roof).multiplyScalar(shade);
  return { tint: scratchTint, roofTint: scratchRoof };
}

/** Plein detail et detail reduit : meme geometrie, le reduit perd son socle. */
function emitDetailed(
  b: FlatBuilding,
  lod: Lod,
  W: Buf,
  S: Buf,
  R: { pos: number[]; col: number[] },
  style: ArchetypeStyle,
  scratch: THREE.Vector2[],
): { shop: boolean; sloped: boolean; insetFail: boolean } {
  const { tint, roofTint } = tintsOf(b, style);
  const ring = b.ring;
  const n = ring.length;
  const h = b.height;
  const foot = footingOf(b);
  // sol sous l'angle i, dans le repere local du batiment
  const ground = (i: number) => foot.g[i % n] - foot.y0;
  const W0 = W.pos.length;
  const S0 = S.pos.length;
  const R0 = R.pos.length;

  // Variante de facade : tiree par batiment, guidee par sa hauteur, son age et
  // son emprise (lib/facadeVariants.ts). Deux voisins du meme archetype ne
  // portent donc plus la meme facade.
  const layer = variantFor({
    id: b.id,
    archetype: b.archetype,
    levels: Math.max(1, Math.round(h / FLOOR)),
    year: b.year,
    area: b.area,
  });
  const variant = VARIANTS[layer];
  const tex = { ...tileOf(variant), patch: LAYER_PATCH_UV };
  const glowGain = variant.glow ?? style.glow;
  const W_fac = (W.fac ??= []);
  const facade = () => W_fac.push(layer, glowGain, layer, glowGain, layer, glowGain, layer, glowGain, layer, glowGain, layer, glowGain);

  // Le socle commercant n'existe qu'au plein detail : c'est un signal de vie a
  // hauteur de rue, invisible passe 300 m, donc c'est la premiere chose qu'on
  // laisse tomber.
  // ...et seulement s'il reste un etage au dessus de la vitrine la plus haute
  // perchee : en pente, la vitrine amont commence plus haut que l'aval.
  const shop = lod === Lod.Full && b.shopFront && h > GF_SHOP * 1.3 + (foot.max - foot.y0);
  const base0 = shop ? GF_SHOP : 0;
  // Reference des rangees de fenetres : le sol le plus bas (+ la vitrine). Une
  // seule par batiment, sinon les etages se decaleraient d'un mur a l'autre.
  const yRef = foot.min - foot.y0 + base0;
  // pied de mur a l'angle i : sur la vitrine, ou enterre de SINK
  // Plafonne sous le toit : un repere pose au pied de sa facade peut avoir, a
  // l'arriere, un sol plus haut que lui (la Bourse du Travail, 15 m de haut sur
  // 18 m de denivele). Il y est enterre en entier, et le mur ne doit pas
  // s'inverser.
  const foot0 = (i: number) => Math.min(h - 0.1, shop ? ground(i) + GF_SHOP : ground(i) - SINK);

  // Decalage de tuile propre au batiment, en nombres entiers de travees et
  // d'etages : chaque emprise tire sa propre trame de fenetres allumees de la
  // meme texture. Sans ca, tous les batiments d'un archetype montraient la
  // meme facade repetee tous les 18,6 m, le premier truc qui trahit le procedu-
  // ral. L'offset entier garde les niveaux alignes et les fenetres entieres aux
  // angles ; le RepeatWrapping fait le reste.
  const du = Math.floor(hash01(b.id, 41) * variant.bays) / variant.bays;
  const dv = Math.floor(hash01(b.id, 43) * 6) / 6;
  // meme principe pour la devanture : chaque commerce tire sa rangee dans
  // l'atlas des devantures et part d'une travee a lui
  const sdu = Math.floor(hash01(b.id, 47) * SHOP_BAYS) / SHOP_BAYS;
  const srow = Math.floor(hash01(b.id, 53) * SHOP_VARIANTS) % SHOP_VARIANTS;
  const sv0 = srow / SHOP_VARIANTS;
  const sv1 = (srow + 1) / SHOP_VARIANTS;

  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;

    const nx = dy / len;
    const ny = -dx / len;
    const px = p.x;
    const pz = -p.y;
    const qx = q.x;
    const qz = -q.y;

    if (shop) {
      const su0 = run / SHOP_TILE_U + sdu;
      const su1 = (run + len) / SHOP_TILE_U + sdu;
      const gp = ground(i);
      const gq = ground(i + 1);
      const lp = gp - SINK;
      const lq = gq - SINK;
      const tp = gp + GF_SHOP;
      const tq = gq + GF_SHOP;
      S.pos.push(px, lp, pz, qx, lq, qz, qx, tq, qz, px, lp, pz, qx, tq, qz, px, tp, pz);
      for (let k = 0; k < 6; k++) {
        S.norm.push(nx, 0, -ny);
        S.col.push(tint.r * 0.5, tint.g * 0.5, tint.b * 0.5);
      }
      S.uv.push(su0, sv0, su1, sv0, su1, sv1, su0, sv0, su1, sv1, su0, sv1);
    }

    const u0 = run / tex.tileU + du;
    const u1 = (run + len) / tex.tileU + du;
    run += len;
    const v = dv + (h - yRef) / tex.tileV;
    const bp = foot0(i);
    const bq = foot0(i + 1);
    const vp = dv + (bp - yRef) / tex.tileV;
    const vq = dv + (bq - yRef) / tex.tileV;

    W.pos.push(px, bp, pz, qx, bq, qz, qx, h, qz, px, bp, pz, qx, h, qz, px, h, pz);
    facade();

    // Un clocher ou un chevalement n'a pas de rangees de fenetres allumees :
    // ses murs pointent sur le carre de mur nu, ce qui laisse une masse sombre.
    if (b.unlit) {
      const [qu, qv] = tex.patch;
      for (let k = 0; k < 6; k++) {
        W.norm.push(nx, 0, -ny);
        const f = ramp(k < 2 || k === 3 ? Math.max(0, base0) : h, h) * 0.72;
        W.col.push(tint.r * f, tint.g * f, tint.b * f);
      }
      W.uv.push(qu, qv, qu, qv, qu, qv, qu, qv, qu, qv, qu, qv);
      continue;
    }

    // Rampe verticale sur la couleur de sommet. Une hemisphereLight seule ne
    // degrade rien sur un mur : sa normale est horizontale, elle recoit donc
    // partout le meme melange ciel/sol.
    const hs = [bp, bq, h, bp, h, h];
    for (let k = 0; k < 6; k++) {
      W.norm.push(nx, 0, -ny);
      const f = ramp(Math.max(0, hs[k]), h);
      W.col.push(tint.r * f, tint.g * f, tint.b * f);
    }
    W.uv.push(u0, vp, u1, vq, u1, v, u0, vp, u1, v, u0, v);
  }

  // --- couronnement ---------------------------------------------------------
  // CONSERVE au detail reduit, et ce n'est pas negociable : a moyenne distance
  // c'est la silhouette qui porte l'identite, pas la couleur. Mesure a l'appui,
  // le zinc du centre et la tuile du faubourg ne sont plus qu'a dE2000 5,6 a
  // 700 m et 3,8 a 1 000 m. Sans la coiffe, pierre et faubourg deviennent le
  // meme prisme beige.
  const wantSlope = b.sloped;
  const top = wantSlope ? insetRing(ring, b.area) : null;
  const sloped = wantSlope && top !== null;
  const insetFail = wantSlope && !sloped;

  const [pu, pv] = tex.patch;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    const nx = dy / len;
    const ny = -dx / len;

    const hp = sloped ? top![i] : p;
    const hq = sloped ? top![(i + 1) % n] : q;
    const rise = sloped ? (b.roofRise ?? ROOF_RISE) : PARAPET;

    W.pos.push(
      p.x, h, -p.y,
      q.x, h, -q.y,
      hq.x, h + rise, -hq.y,
      p.x, h, -p.y,
      hq.x, h + rise, -hq.y,
      hp.x, h + rise, -hp.y,
    );
    facade();
    for (let k = 0; k < 6; k++) {
      W.norm.push(nx, 0, -ny);
      if (sloped) W.col.push(roofTint.r, roofTint.g, roofTint.b);
      else W.col.push(tint.r * 1.25, tint.g * 1.25, tint.b * 1.22);
    }
    W.uv.push(pu, pv, pu, pv, pu, pv, pu, pv, pu, pv, pu, pv);
  }

  // --- toiture --------------------------------------------------------------
  const cap = sloped ? top! : ring;
  const capY = sloped ? h + (b.roofRise ?? ROOF_RISE) : h;
  scratch.length = 0;
  for (let i = 0; i < n; i++) scratch.push(new THREE.Vector2(ring[i].x, ring[i].y));
  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(scratch, []);
  } catch {
    faces = [];
  }
  for (const [ia, ib, ic] of faces) {
    for (const idx of [ia, ib, ic]) {
      const p = cap[idx];
      R.pos.push(p.x, capY, -p.y);
      R.col.push(roofTint.r, roofTint.g, roofTint.b);
    }
  }

  // --- encombrement de toit, au plein detail seulement ---------------------
  if (lod === Lod.Full && !b.landmark && !b.unlit && b.family === Family.None) {
    emitRoofClutter(b, sloped ? top! : ring, capY, sloped, R, roofTint);
  }

  // du repere local au monde : tout ce que ce batiment vient d'ecrire monte a Y0
  liftFrom(W.pos, W0, foot.y0);
  liftFrom(S.pos, S0, foot.y0);
  liftFrom(R.pos, R0, foot.y0);

  return { shop, sloped, insetFail };
}

// Cheminees sur les toits en pente, antennes et edicules sur les toits plats.
// C'est ce qui casse la regle droite des corniches vues de pres, et le trait
// encre les detache sur le ciel. Au plein detail seulement : passe 300 m, ce
// ne sont plus que quelques pixels.
function emitRoofClutter(
  b: FlatBuilding,
  cap: { x: number; y: number }[],
  capY: number,
  sloped: boolean,
  R: { pos: number[]; col: number[] },
  roofTint: THREE.Color,
) {
  const n = cap.length;
  if (n < 3 || b.area < 40) return;
  let cx = 0;
  let cy = 0;
  for (const p of cap) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  // un element pour 150 m2 de toit, trois au plus
  const count = Math.min(3, 1 + Math.floor(b.area / 150));
  for (let k = 0; k < count; k++) {
    const i = Math.floor(hash01(b.id, 61 + k) * n) % n;
    // un peu en retrait du bord, vers le centre du toit
    const t = 0.18 + hash01(b.id, 67 + k) * 0.2;
    const x = cap[i].x + (cx - cap[i].x) * t;
    const y = cap[i].y + (cy - cap[i].y) * t;
    const rot = hash01(b.id, 71 + k) * Math.PI;
    if (sloped) {
      // souche de cheminee en brique sombre, coiffee d'un chapeau clair
      pushBox(R, x, y, 0.8, 0.55, capY - 0.2, capY + 1.3, rot, 0.34, 0.2, 0.16);
      pushBox(R, x, y, 0.95, 0.7, capY + 1.3, capY + 1.45, rot, 0.52, 0.5, 0.47);
    } else if (hash01(b.id, 73 + k) < 0.55) {
      // antenne : un mat et deux brins
      const mh = 2.2 + hash01(b.id, 79 + k) * 1.6;
      pushBox(R, x, y, 0.08, 0.08, capY, capY + mh, rot, 0.2, 0.2, 0.22);
      pushBox(R, x, y, 1.4, 0.06, capY + mh * 0.7, capY + mh * 0.7 + 0.06, rot, 0.2, 0.2, 0.22);
      pushBox(R, x, y, 0.9, 0.06, capY + mh * 0.9, capY + mh * 0.9 + 0.06, rot, 0.2, 0.2, 0.22);
    } else {
      // edicule d'ascenseur ou de ventilation, dans le ton du toit
      pushBox(R, x, y, 2.2, 1.6, capY, capY + 1.6, rot, roofTint.r * 1.3, roofTint.g * 1.3, roofTint.b * 1.3);
    }
  }
}

/** Pave oriente, en triangles simples (x, y du plan ; la hauteur en metres). */
function pushBox(
  R: { pos: number[]; col: number[] },
  x: number,
  y: number,
  w: number,
  d: number,
  y0: number,
  y1: number,
  rot: number,
  r: number,
  g: number,
  bl: number,
) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corner = (u: number, v: number): [number, number] => [
    x + u * c - v * s,
    -(y + u * s + v * c),
  ];
  const q = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
  const tri = (a: number[], b2: number[], c2: number[]) => {
    R.pos.push(...a, ...b2, ...c2);
    for (let k = 0; k < 3; k++) R.col.push(r, g, bl);
  };
  for (let i = 0; i < 4; i++) {
    const [ax, az] = q[i];
    const [bx, bz] = q[(i + 1) % 4];
    tri([ax, y0, az], [bx, y0, bz], [bx, y1, bz]);
    tri([ax, y0, az], [bx, y1, bz], [ax, y1, az]);
  }
  tri([q[0][0], y1, q[0][1]], [q[1][0], y1, q[1][1]], [q[2][0], y1, q[2][1]]);
  tri([q[0][0], y1, q[0][1]], [q[2][0], y1, q[2][1]], [q[3][0], y1, q[3][1]]);
}

/**
 * Silhouette : une boite a la vraie hauteur. Le sommet est retreci sur les
 * archetypes a toit en pente, ce qui rend la coiffe plat/pente pour zero
 * triangle de plus : c'est le seul canal d'identite qui survive au dela de
 * 700 m, ou la couleur ne compte plus.
 */
function emitSilhouette(b: FlatBuilding, style: ArchetypeStyle, B: Buf) {
  const { tint, roofTint } = tintsOf(b, style);
  const foot = footingOf(b);
  const B0 = B.pos.length;
  const low = foot.min - foot.y0 - SINK; // pied de la boite, sous l'angle le plus bas
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of b.ring) {
    if (p.x < minx) minx = p.x;
    if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.y > maxy) maxy = p.y;
  }
  const h = b.height;
  // contour au sol, en sens trigo dans le repere metrique
  const base: [number, number][] = [
    [minx, miny],
    [maxx, miny],
    [maxx, maxy],
    [minx, maxy],
  ];
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const k = b.sloped ? 0.72 : 1; // retrecissement du sommet = pente fakee
  const top = base.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as [number, number]);

  const lo = ramp(0, h);
  const hi = ramp(h, h);
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = base[i];
    const [bx, by] = base[(i + 1) % 4];
    const [tax, tay] = top[i];
    const [tbx, tby] = top[(i + 1) % 4];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    const nx = dy / len;
    const ny = -dx / len;
    B.pos.push(ax, low, -ay, bx, low, -by, tbx, h, -tby, ax, low, -ay, tbx, h, -tby, tax, h, -tay);
    const f = [lo, lo, hi, lo, hi, hi];
    for (let j = 0; j < 6; j++) {
      B.norm.push(nx, 0, -ny);
      B.col.push(tint.r * f[j], tint.g * f[j], tint.b * f[j]);
    }
  }
  // dessus, en couleur de toit : c'est lui qui donne la lecture zinc/tuile
  const [t0, t1, t2, t3] = top;
  B.pos.push(
    t0[0], h, -t0[1], t2[0], h, -t2[1], t1[0], h, -t1[1],
    t0[0], h, -t0[1], t3[0], h, -t3[1], t2[0], h, -t2[1],
  );
  for (let j = 0; j < 6; j++) {
    B.norm.push(0, 1, 0);
    B.col.push(roofTint.r, roofTint.g, roofTint.b);
  }
  liftFrom(B.pos, B0, foot.y0);
}

function toGeometry(b: Buf, withUv: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
  if (withUv) g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.fac) g.setAttribute("aFacade", new THREE.Float32BufferAttribute(b.fac, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  return g;
}

// --- kits de famille --------------------------------------------------------
//
// Un clocher, une toiture en sheds ou une cage d'ascenseur ne sont pas des
// reperes bespoke : ce sont des silhouettes de FAMILLE posees sur environ
// 1 100 emprises (voir src/lib/families.ts). A ce nombre, il n'est pas question
// de les construire une fois pour toutes comme les six monuments de
// Landmarks.tsx : elles passent par les tuiles, donc par le streaming, et
// suivent le meme niveau de detail que le reste.
//
// Les kits n'ecrivent que dans des tampons pleins (teinte par sommet, aucune
// texture) et lumineux, ce qui les rend fusionnables tels quels dans les
// tampons de la tuile : un draw call de plus par tuile pour les lumieres, zero
// pour la masse.

/** Ce que le kit doit savoir du batiment, au dela de son emprise. */
function kitContext(b: FlatBuilding, far: boolean) {
  const note = NOTABLE.get(b.id);
  return { far, mh: note?.mh ?? false, religion: note?.religion, id: b.id };
}

/** Pose les kits de toutes les emprises a famille d'une tuile dans un tampon. */
function emitFamilies(list: FlatBuilding[], far: boolean, e: Emit): boolean {
  let any = false;
  for (const b of list) {
    if (b.family === Family.None || !b.frame || b.landmark?.replaceBase) continue;
    const kit = kitFor(b.family);
    if (!kit) continue;
    // le kit se construit de 0 a la hauteur du batiment, comme ses murs : il
    // monte au meme niveau de reference Y0
    const from = [e.walls.pos.length, e.roofs.pos.length, e.glow.pos.length];
    kit(e, b.frame, b.frame, kitContext(b, far));
    const y0 = footingOf(b).y0;
    liftFrom(e.walls.pos, from[0], y0);
    liftFrom(e.roofs.pos, from[1], y0);
    liftFrom(e.glow.pos, from[2], y0);
    any = true;
  }
  return any;
}

/** Recopie un tampon de kit dans un tampon de tuile (position et couleur). */
function appendPlain(dst: { pos: number[]; col: number[] }, src: KitBuf) {
  for (let i = 0; i < src.pos.length; i++) dst.pos.push(src.pos[i]);
  for (let i = 0; i < src.col.length; i++) dst.col.push(src.col[i]);
}

/** Idem, en gardant les normales du kit : la silhouette ne les recalcule pas. */
function appendWithNormals(dst: Buf, src: KitBuf) {
  for (let i = 0; i < src.pos.length; i++) dst.pos.push(src.pos[i]);
  for (let i = 0; i < src.norm.length; i++) dst.norm.push(src.norm[i]);
  for (let i = 0; i < src.col.length; i++) dst.col.push(src.col[i]);
}

export type TileGeometry = {
  lod: Lod;
  /** tous les murs de la tuile, toutes variantes confondues : un seul draw call */
  walls: THREE.BufferGeometry | null;
  shop: THREE.BufferGeometry | null;
  roofs: THREE.BufferGeometry | null;
  /** silhouette : tout l'archetype confondu dans un seul maillage */
  box: THREE.BufferGeometry | null;
  /** beffrois, verrieres, horloges, feux de balisage : un seul maillage additif */
  glow: THREE.BufferGeometry | null;
  triangles: number;
};

function buildTile(list: FlatBuilding[], lod: Lod): TileGeometry {
  const scratch: THREE.Vector2[] = [];

  if (lod === Lod.Silhouette) {
    const B = newBuf();
    for (const b of list) {
      if (b.landmark?.replaceBase) continue; // rendu par Landmarks.tsx
      emitSilhouette(b, STYLES[b.archetype], B);
    }
    // Au dela de 700 m on garde la masse des kits, pas leurs details : une
    // fleche d'eglise ou une cheminee d'usine sur la ligne d'horizon est
    // exactement ce qui fait reconnaitre la ville, et ca ne coute que quelques
    // dizaines de triangles par emprise. Les lumieres, elles, sont abandonnees.
    const far = newEmit();
    if (emitFamilies(list, true, far)) {
      appendWithNormals(B, far.roofs);
      appendWithNormals(B, far.walls);
    }
    const box = toGeometry(B, false);
    return {
      lod,
      walls: null,
      shop: null,
      roofs: null,
      box,
      glow: null,
      triangles: B.pos.length / 9,
    };
  }

  const wallBuf = newBuf();
  const shopBuf = newBuf();
  const roof = { pos: [] as number[], col: [] as number[] };
  const glowBuf = { pos: [] as number[], col: [] as number[] };

  for (const b of list) {
    if (b.landmark?.replaceBase) continue; // rendu par Landmarks.tsx
    emitDetailed(b, lod, wallBuf, shopBuf, roof, STYLES[b.archetype], scratch);
  }

  const near = newEmit();
  if (emitFamilies(list, false, near)) {
    // Les volumes pleins rejoignent les toits (memes normales recalculees,
    // meme materiau), les elements lumineux leur propre tampon. Un kit qui
    // ecrirait des murs textures atterrit ici sans sa texture : c'est voulu,
    // une famille se pose en volumes pleins, pas en facades.
    appendPlain(roof, near.roofs);
    appendPlain(roof, near.walls);
    appendPlain(glowBuf, near.glow);
  }

  const out = wallBuf.pos.length ? toGeometry(wallBuf, true) : null;
  let triangles = wallBuf.pos.length / 9;

  let roofs: THREE.BufferGeometry | null = null;
  if (roof.pos.length) {
    roofs = new THREE.BufferGeometry();
    roofs.setAttribute("position", new THREE.Float32BufferAttribute(roof.pos, 3));
    roofs.setAttribute("color", new THREE.Float32BufferAttribute(roof.col, 3));
    roofs.computeVertexNormals();
    roofs.computeBoundingSphere();
    triangles += roof.pos.length / 9;
  }

  const shop = shopBuf.pos.length ? toGeometry(shopBuf, true) : null;
  if (shop) triangles += shopBuf.pos.length / 9;



  // Les lumieres des kits sont additives et non eclairees : ni normales ni UV.
  let glow: THREE.BufferGeometry | null = null;
  if (glowBuf.pos.length) {
    glow = new THREE.BufferGeometry();
    glow.setAttribute("position", new THREE.Float32BufferAttribute(glowBuf.pos, 3));
    glow.setAttribute("color", new THREE.Float32BufferAttribute(glowBuf.col, 3));
    glow.computeBoundingSphere();
    triangles += glowBuf.pos.length / 9;
  }

  return { lod, walls: out, shop, roofs, box: null, glow, triangles };
}

function disposeTile(t: TileGeometry) {
  t.walls?.dispose();
  t.shop?.dispose();
  t.roofs?.dispose();
  t.box?.dispose();
  t.glow?.dispose();
}

// --- composant --------------------------------------------------------------

export function Buildings({ buildings }: { buildings: FlatBuilding[] }) {
  // Un seul materiau de murs pour toute la ville : ses vingt-quatre variantes
  // sont les calques d'un tableau de textures.
  const wallMat = useMemo(() => makeFacadeMaterial(getFacadeArray()), []);
  useEffect(() => () => wallMat.dispose(), [wallMat]);
  const shopTex = useMemo(() => getShopTexture(), []);

  // Index des tuiles : une seule passe sur les emprises, aucune geometrie.
  const index = useMemo(() => {
    const t0 = performance.now();
    const map = new Map<number, FlatBuilding[]>();
    const refs: TileRef[] = [];
    for (const b of buildings) {
      const tx = Math.floor(b.cx / TILE);
      const ty = Math.floor(b.cy / TILE);
      const key = tileKey(tx, ty);
      let list = map.get(key);
      if (!list) {
        map.set(key, (list = []));
        refs.push({ tx, ty });
      }
      list.push(b);
    }
    const fam = [0, 0, 0, 0, 0];
    for (const b of buildings) fam[b.family]++;
    console.log(
      `batiments: ${buildings.length} emprises indexees en ${refs.length} tuiles de ${TILE} m, ` +
        `${Math.round(performance.now() - t0)} ms (geometrie construite a la demande)`,
    );
    console.log(
      `familles: ${fam[Family.Culte]} culte, ${fam[Family.Halle]} halle, ` +
        `${fam[Family.Gare]} gare, ${fam[Family.Ensemble]} grand ensemble`,
    );
    return { map, refs };
  }, [buildings]);

  const resident = useRef(new Map<number, TileGeometry>());
  // Liberation differee d'un tick. Disposer dans le meme tick que le
  // remplacement laisserait un maillage monte pointer sur une geometrie deja
  // liberee jusqu'au prochain rendu de React : on ajoute d'abord, on retire au
  // tour suivant, jamais l'inverse.
  const pending = useRef<TileGeometry[]>([]);
  const [, bump] = useState(0);
  const acc = useRef(0);
  const logged = useRef(false);

  // Liberation a la sortie : sans ca, changer de jeu de batiments ou couper la
  // couche laisserait tous les tampons sur le GPU.
  useEffect(() => {
    const held = resident.current;
    const queued = pending.current;
    return () => {
      for (const t of held.values()) disposeTile(t);
      for (const t of queued) disposeTile(t);
      held.clear();
      queued.length = 0;
    };
  }, [index]);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 1 / STREAM_HZ) return;
    acc.current = 0;

    // Ce qui a ete remplace au tick precedent a maintenant ete demonte par
    // React, on peut liberer sans laisser de trou.
    if (pending.current.length) {
      for (const t of pending.current) disposeTile(t);
      pending.current.length = 0;
    }

    const cur = new Map<number, Lod>();
    for (const [k, t] of resident.current) cur.set(k, t.lod);

    const editing = useStore.getState().mode === "edit";
    const px = editing ? editView.x : car.x;
    const py = editing ? editView.y : car.y;
    const vx = editing ? 0 : Math.cos(car.heading) * car.speed;
    const vy = editing ? 0 : Math.sin(car.heading) * car.speed;
    const plan = planStreaming(index.refs, px, py, vx, vy, cur);

    let changed = false;

    // On construit AVANT de liberer : une tuile qui monte de niveau ne doit
    // jamais laisser un trou d'une frame, meme si le budget est atteint.
    for (const item of plan.load.slice(0, BUILD_BUDGET)) {
      const list = index.map.get(item.key);
      if (!list) continue;
      const built = buildTile(list, item.lod);
      const old = resident.current.get(item.key);
      resident.current.set(item.key, built);
      if (old) pending.current.push(old);
      changed = true;
    }

    for (const key of plan.drop) {
      const t = resident.current.get(key);
      if (!t) continue;
      pending.current.push(t);
      resident.current.delete(key);
      changed = true;
    }

    if (changed) bump((v) => v + 1);

    if (!logged.current && plan.load.length === 0) {
      logged.current = true;
      let tris = 0;
      let meshes = 0;
      for (const t of resident.current.values()) {
        tris += t.triangles;
        meshes +=
          (t.walls ? 1 : 0) +
          (t.shop ? 1 : 0) +
          (t.roofs ? 1 : 0) +
          (t.box ? 1 : 0) +
          (t.glow ? 1 : 0);
      }
      console.log(
        `streaming stabilise: ${resident.current.size} tuiles residentes ` +
          `(plein ${plan.counts[0]}, reduit ${plan.counts[1]}, silhouette ${plan.counts[2]}), ` +
          `${meshes} maillages, ${Math.round(tris / 1000)}k triangles`,
      );
    }
  });

  const tiles = [...resident.current.entries()];

  return (
    <group>
      {tiles.map(([key, t]) => (
        <group key={key}>
          {t.walls && <mesh geometry={t.walls} material={wallMat} />}
          {t.shop && (
            <mesh geometry={t.shop}>
              <meshLambertMaterial
                map={shopTex.map}
                emissiveMap={shopTex.emissiveMap}
                emissive={0xffffff}
                emissiveIntensity={3.1}
                vertexColors
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          {t.roofs && (
            <mesh geometry={t.roofs}>
              <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
            </mesh>
          )}
          {t.box && (
            <mesh geometry={t.box}>
              {/* silhouette : ni texture ni emissif, un seul draw call par tuile */}
              <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
            </mesh>
          )}
          {t.glow && (
            <mesh geometry={t.glow}>
              {/* beffrois et verrieres : couleurs HDR, hors tone mapping, pour
                  passer le seuil du bloom comme les kits bespoke */}
              <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

