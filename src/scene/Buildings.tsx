import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FLOOR, insetRing, type FlatBuilding } from "../lib/buildings";
import { Archetype, STYLES, hash01, type ArchetypeStyle } from "../lib/archetypes";
import { car } from "../lib/car";
import { editView } from "../lib/editView";
import { useStore } from "../state/store";
import { Lod, TILE, planStreaming, tileKey, type TileRef } from "../lib/streaming";
import { TILE_V, SHOP_TILE_U, FLOORS_PER_TILE } from "../lib/facades";
import { getFacadeTextures, getShopTexture, type Painted } from "../lib/facadeTextures";
import { Family } from "../lib/families";
import { kitFor } from "../lib/familyKits";
import { newEmit, type Buf as KitBuf, type Emit } from "../lib/landmarkGeometry";
import { NOTABLE } from "../lib/notable";
import { addY, elevReady, zAt } from "../lib/elev";

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

type Buf = { pos: number[]; norm: number[]; uv: number[]; col: number[] };
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
  scratchRoof.setHex(b.landmark?.roof ?? style.roof).multiplyScalar(shade);
  return { tint: scratchTint, roofTint: scratchRoof };
}

/** Plein detail et detail reduit : meme geometrie, le reduit perd son socle. */
function emitDetailed(
  b: FlatBuilding,
  lod: Lod,
  W: Buf,
  S: Buf,
  R: { pos: number[]; col: number[] },
  tex: Painted,
  style: ArchetypeStyle,
  scratch: THREE.Vector2[],
): { shop: boolean; sloped: boolean; insetFail: boolean } {
  const { tint, roofTint } = tintsOf(b, style);
  const ring = b.ring;
  const n = ring.length;
  const h = b.height;

  // Le socle commercant n'existe qu'au plein detail : c'est un signal de vie a
  // hauteur de rue, invisible passe 300 m, donc c'est la premiere chose qu'on
  // laisse tomber.
  const shop = lod === Lod.Full && b.shopFront && h > FLOOR * 1.35;
  const base0 = shop ? FLOOR : 0;

  // Decalage de tuile propre au batiment, en nombres entiers de travees et
  // d'etages : chaque emprise tire sa propre trame de fenetres allumees de la
  // meme texture. Sans ca, tous les batiments d'un archetype montraient la
  // meme facade repetee tous les 18,6 m, le premier truc qui trahit le procedu-
  // ral. L'offset entier garde les niveaux alignes et les fenetres entieres aux
  // angles ; le RepeatWrapping fait le reste.
  const du = Math.floor(hash01(b.id, 41) * style.bays) / style.bays;
  const dv = Math.floor(hash01(b.id, 43) * FLOORS_PER_TILE) / FLOORS_PER_TILE;

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
      const su0 = run / SHOP_TILE_U;
      const su1 = (run + len) / SHOP_TILE_U;
      S.pos.push(px, 0, pz, qx, 0, qz, qx, FLOOR, qz, px, 0, pz, qx, FLOOR, qz, px, FLOOR, pz);
      for (let k = 0; k < 6; k++) {
        S.norm.push(nx, 0, -ny);
        S.col.push(tint.r * 0.5, tint.g * 0.5, tint.b * 0.5);
      }
      S.uv.push(su0, 0, su1, 0, su1, 1, su0, 0, su1, 1, su0, 1);
    }

    const u0 = run / tex.tileU + du;
    const u1 = (run + len) / tex.tileU + du;
    run += len;
    const v = dv + (h - base0) / TILE_V;

    W.pos.push(px, base0, pz, qx, base0, qz, qx, h, qz, px, base0, pz, qx, h, qz, px, h, pz);

    // Un clocher ou un chevalement n'a pas de rangees de fenetres allumees :
    // ses murs pointent sur le carre de mur nu, ce qui laisse une masse sombre.
    if (b.unlit) {
      const [qu, qv] = tex.patch;
      for (let k = 0; k < 6; k++) {
        W.norm.push(nx, 0, -ny);
        const f = ramp(k < 2 || k === 3 ? base0 : h, h) * 0.72;
        W.col.push(tint.r * f, tint.g * f, tint.b * f);
      }
      W.uv.push(qu, qv, qu, qv, qu, qv, qu, qv, qu, qv, qu, qv);
      continue;
    }

    // Rampe verticale sur la couleur de sommet. Une hemisphereLight seule ne
    // degrade rien sur un mur : sa normale est horizontale, elle recoit donc
    // partout le meme melange ciel/sol.
    const hs = [base0, base0, h, base0, h, h];
    for (let k = 0; k < 6; k++) {
      W.norm.push(nx, 0, -ny);
      const f = ramp(hs[k], h);
      W.col.push(tint.r * f, tint.g * f, tint.b * f);
    }
    W.uv.push(u0, dv, u1, dv, u1, v, u0, dv, u1, v, u0, v);
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
    const rise = sloped ? ROOF_RISE : PARAPET;

    W.pos.push(
      p.x, h, -p.y,
      q.x, h, -q.y,
      hq.x, h + rise, -hq.y,
      p.x, h, -p.y,
      hq.x, h + rise, -hq.y,
      hp.x, h + rise, -hp.y,
    );
    for (let k = 0; k < 6; k++) {
      W.norm.push(nx, 0, -ny);
      if (sloped) W.col.push(roofTint.r, roofTint.g, roofTint.b);
      else W.col.push(tint.r * 1.25, tint.g * 1.25, tint.b * 1.22);
    }
    W.uv.push(pu, pv, pu, pv, pu, pv, pu, pv, pu, pv, pu, pv);
  }

  // --- toiture --------------------------------------------------------------
  const cap = sloped ? top! : ring;
  const capY = sloped ? h + ROOF_RISE : h;
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

  return { shop, sloped, insetFail };
}

/**
 * Silhouette : une boite a la vraie hauteur. Le sommet est retreci sur les
 * archetypes a toit en pente, ce qui rend la coiffe plat/pente pour zero
 * triangle de plus : c'est le seul canal d'identite qui survive au dela de
 * 700 m, ou la couleur ne compte plus.
 */
function emitSilhouette(b: FlatBuilding, style: ArchetypeStyle, B: Buf) {
  const { tint, roofTint } = tintsOf(b, style);
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
    B.pos.push(ax, 0, -ay, bx, 0, -by, tbx, h, -tby, ax, 0, -ay, tbx, h, -tby, tax, h, -tay);
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
}

function toGeometry(b: Buf, withUv: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
  if (withUv) g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Jupe sous le prisme, cote aval : sans ca l'immeuble flotte au-dessus de la pente. */
function emitSkirt(b: FlatBuilding, z0: number, buf: Buf, tex?: Painted, rgb?: THREE.Color) {
  if (!elevReady()) return;
  const ring = b.ring;
  const n = ring.length;
  const cr = (rgb?.r ?? 0.18) * 0.38;
  const cg = (rgb?.g ?? 0.17) * 0.38;
  const cb = (rgb?.b ?? 0.16) * 0.38;
  const pu = tex?.patch[0] ?? 0;
  const pv = tex?.patch[1] ?? 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const zp = zAt(p.x, p.y);
    const zq = zAt(q.x, q.y);
    if (zp >= z0 - 0.08 && zq >= z0 - 0.08) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    const nx = dy / len;
    const ny = -dx / len;
    const yp = Math.min(zp, z0);
    const yq = Math.min(zq, z0);
    buf.pos.push(
      p.x, yp, -p.y,
      q.x, yq, -q.y,
      q.x, z0, -q.y,
      p.x, yp, -p.y,
      q.x, z0, -q.y,
      p.x, z0, -p.y,
    );
    for (let k = 0; k < 6; k++) {
      buf.norm.push(nx, 0, -ny);
      buf.col.push(cr, cg, cb);
      if (tex) buf.uv.push(pu, pv);
    }
  }
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
    const iR = e.roofs.pos.length;
    const iW = e.walls.pos.length;
    const iG = e.glow.pos.length;
    kit(e, b.frame, b.frame, kitContext(b, far));
    const z0 = zAt(b.cx, b.cy);
    addY(e.roofs.pos, z0, iR);
    addY(e.walls.pos, z0, iW);
    addY(e.glow.pos, z0, iG);
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
  walls: { archetype: Archetype; geometry: THREE.BufferGeometry }[];
  shop: THREE.BufferGeometry | null;
  roofs: THREE.BufferGeometry | null;
  /** silhouette : tout l'archetype confondu dans un seul maillage */
  box: THREE.BufferGeometry | null;
  /** beffrois, verrieres, horloges, feux de balisage : un seul maillage additif */
  glow: THREE.BufferGeometry | null;
  triangles: number;
};

function buildTile(list: FlatBuilding[], lod: Lod, painted: Painted[]): TileGeometry {
  const scratch: THREE.Vector2[] = [];

  if (lod === Lod.Silhouette) {
    const B = newBuf();
    for (const b of list) {
      if (b.landmark?.replaceBase) continue; // rendu par Landmarks.tsx
      const i0 = B.pos.length;
      emitSilhouette(b, STYLES[b.archetype], B);
      const z0 = zAt(b.cx, b.cy);
      addY(B.pos, z0, i0);
      emitSkirt(b, z0, B);
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
    return { lod, walls: [], shop: null, roofs: null, box, glow: null, triangles: B.pos.length / 9 };
  }

  const walls = new Map<Archetype, Buf>();
  const shopBuf = newBuf();
  const roof = { pos: [] as number[], col: [] as number[] };
  const glowBuf = { pos: [] as number[], col: [] as number[] };

  for (const b of list) {
    if (b.landmark?.replaceBase) continue; // rendu par Landmarks.tsx
    let W = walls.get(b.archetype);
    if (!W) walls.set(b.archetype, (W = newBuf()));
    const iW = W.pos.length;
    const iS = shopBuf.pos.length;
    const iR = roof.pos.length;
    emitDetailed(b, lod, W, shopBuf, roof, painted[b.archetype], STYLES[b.archetype], scratch);
    const z0 = zAt(b.cx, b.cy);
    addY(W.pos, z0, iW);
    addY(shopBuf.pos, z0, iS);
    addY(roof.pos, z0, iR);
    emitSkirt(b, z0, W, painted[b.archetype], tintsOf(b, STYLES[b.archetype]).tint);
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

  const out: TileGeometry["walls"] = [];
  let triangles = 0;
  for (const [archetype, buf] of walls) {
    if (!buf.pos.length) continue;
    out.push({ archetype, geometry: toGeometry(buf, true) });
    triangles += buf.pos.length / 9;
  }

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
  for (const w of t.walls) w.geometry.dispose();
  t.shop?.dispose();
  t.roofs?.dispose();
  t.box?.dispose();
  t.glow?.dispose();
}

// --- composant --------------------------------------------------------------

export function Buildings({ buildings }: { buildings: FlatBuilding[] }) {
  const painted = useMemo(() => getFacadeTextures(), []);
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
      const built = buildTile(list, item.lod, painted);
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
        meshes += t.walls.length + (t.shop ? 1 : 0) + (t.roofs ? 1 : 0) + (t.box ? 1 : 0) + (t.glow ? 1 : 0);
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
          {t.walls.map((w) => (
            <mesh key={w.archetype} geometry={w.geometry}>
              <meshLambertMaterial
                map={painted[w.archetype].map}
                emissiveMap={painted[w.archetype].emissiveMap}
                emissive={0xffffff}
                emissiveIntensity={STYLES[w.archetype].glow}
                vertexColors
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
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

