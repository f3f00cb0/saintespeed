import { useMemo } from "react";
import * as THREE from "three";
import { FLOOR, insetRing, type FlatBuilding } from "../lib/buildings";
import {
  ARCHETYPE_COUNT,
  ARCHETYPE_NAMES,
  Archetype,
  STYLES,
  hash01,
  type ArchetypeStyle,
} from "../lib/archetypes";

// Facades procedurales : aucune texture n'est embarquee, tout est peint dans un
// canvas au demarrage. Une texture par archetype, la couleur du mur venant du
// vertex color, la trame de fenetres de la texture.
//
// Les UV sont en metres et pas normalisees, ce qui aligne les rangees de
// fenetres sur les etages quelle que soit la taille du batiment. La tuile
// horizontale vaut "bays" travees, elle change donc d'un archetype a l'autre :
// c'est ce qui donne au grand ensemble sa trame serree et a l'atelier ses
// grandes ouvertures, gratuitement, sans texture plus lourde.
//
// Changement par rapport a la version precedente : le rez-de-chaussee n'est
// plus une rangee de la tuile. Il etait repete verticalement par le
// RepeatWrapping, et la vitrine reapparaissait donc au sixieme etage sur les
// batiments de plus de 18,6 m, soit 189 emprises mesurees. La tuile ne contient
// plus que des etages courants, tous interchangeables, et le socle commercant
// est une geometrie separee posee sur les seuls batiments que la donnee OSM
// designe comme commercants.

const FLOORS_PER_TILE = 6;
const TILE_V = FLOOR * FLOORS_PER_TILE; // 18,6 m de haut par tuile
const CELL_PX = 96; // un etage et une travee font 3,1 m, la texture reste carree
const CHUNK = 400; // taille des paquets de geometrie, en metres

// Coin de mur nu reserve en haut a gauche de chaque texture. L'acrotere et les
// bandeaux de toit y pointent pour ne pas heriter de fenetres.
const PATCH_PX = 12;

const PARAPET = 0.75; // bandeau vertical des toits plats
const ROOF_RISE = 1.9; // hauteur du bandeau incline des toits en pente

function seeded(seed: number): number {
  let x = (seed | 0) ^ 0x85ebca6b;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

type Painted = {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  /** Largeur d'une tuile en metres, propre a l'archetype. */
  tileU: number;
  /** Point UV du carre de mur nu. */
  patch: [number, number];
};

// --- une texture d'archetype ------------------------------------------------
// Uniquement des etages courants : "bays" travees de large sur FLOORS_PER_TILE
// etages de haut, toutes les rangees interchangeables.
function paintArchetype(style: ArchetypeStyle): Painted {
  const w = style.bays * CELL_PX;
  const h = FLOORS_PER_TILE * CELL_PX;

  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = w;
  albedo.height = glow.height = h;
  const a = albedo.getContext("2d")!;
  const g = glow.getContext("2d")!;

  a.fillStyle = "#ffffff"; // blanc : la couleur vient du vertex color
  a.fillRect(0, 0, w, h);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, w, h);

  const [winW, winH] = style.win;

  for (let iy = 0; iy < FLOORS_PER_TILE; iy++) {
    for (let ix = 0; ix < style.bays; ix++) {
      const ox = ix * CELL_PX;
      const oy = iy * CELL_PX;
      const seed = ix * 73 + iy * 149 + style.bays * 1013;

      // variation de ton d'une travee a l'autre, casse l'aplat
      a.fillStyle = `rgba(0,0,0,${(0.02 + seeded(seed * 3) * 0.05).toFixed(3)})`;
      a.fillRect(ox, oy, CELL_PX, CELL_PX);

      // nez de dalle en bas de chaque etage, donne la lecture horizontale
      a.fillStyle = "rgba(0,0,0,0.20)";
      a.fillRect(ox, oy + CELL_PX * 0.94, CELL_PX, CELL_PX * 0.06);

      const lit = seeded(seed) < style.litRatio;
      const ww = CELL_PX * winW;
      const wh = CELL_PX * winH;
      const wx = ox + (CELL_PX - ww) / 2;
      const wy = oy + CELL_PX * 0.22;

      // encadrement : linteau pierre sur la brique, tableau sombre ailleurs
      a.fillStyle = style.frame;
      a.globalAlpha = 0.55;
      a.fillRect(wx - CELL_PX * 0.03, wy - CELL_PX * 0.04, ww + CELL_PX * 0.06, wh + CELL_PX * 0.08);
      a.globalAlpha = 1;

      const [glass, halo] = style.warm[Math.floor(seeded(seed * 5) * style.warm.length) % style.warm.length];
      a.fillStyle = lit ? glass : style.dark;
      a.fillRect(wx, wy, ww, wh);

      // meneau vertical, casse le cote "trou rectangulaire"
      a.fillStyle = lit ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.45)";
      a.fillRect(wx + ww / 2 - CELL_PX * 0.012, wy, CELL_PX * 0.024, wh);
      // appui de fenetre
      a.fillStyle = "rgba(255,255,255,0.10)";
      a.fillRect(wx - CELL_PX * 0.02, wy + wh, ww + CELL_PX * 0.04, CELL_PX * 0.025);

      if (lit) {
        // intensite variable d'une fenetre a l'autre : sans ca on obtient une
        // grille de lampes identiques une fois le bloom applique
        g.fillStyle = halo;
        g.globalAlpha = 0.4 + seeded(seed * 17) * 0.45;
        g.fillRect(wx, wy, ww, wh);
        g.globalAlpha = 1;
      }
    }
  }

  // carre de mur nu, peint en dernier pour qu'aucune fenetre ne l'entame
  a.fillStyle = "rgba(0,0,0,0.10)";
  a.fillRect(0, 0, PATCH_PX, PATCH_PX);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, PATCH_PX, PATCH_PX);

  const map = new THREE.CanvasTexture(albedo);
  const emissiveMap = new THREE.CanvasTexture(glow);
  for (const t of [map, emissiveMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
  }

  // le canvas est retourne a l'echantillonnage, le coin haut gauche est donc
  // en haut de l'espace UV
  return {
    map,
    emissiveMap,
    tileU: style.bays * FLOOR,
    patch: [PATCH_PX / 2 / w, 1 - PATCH_PX / 2 / h],
  };
}

// --- socle commercant -------------------------------------------------------
// Une seule texture pour toute la ville : la vitrine se lit pareil quel que
// soit l'archetype au dessus, et ca evite cinq materiaux de plus.
const SHOP_BAYS = 3;
const SHOP_TILE_U = SHOP_BAYS * FLOOR;

function paintShopFront(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const w = SHOP_BAYS * CELL_PX;
  const h = CELL_PX;
  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = w;
  albedo.height = glow.height = h;
  const a = albedo.getContext("2d")!;
  const g = glow.getContext("2d")!;

  a.fillStyle = "#2a2620"; // base sombre du socle
  a.fillRect(0, 0, w, h);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, w, h);

  for (let ix = 0; ix < SHOP_BAYS; ix++) {
    const ox = ix * CELL_PX;
    const seed = ix * 977 + 31;
    // Toutes les vitrines ne sont pas allumees, mais la majorite l'est : c'est
    // le niveau de la rue, c'est lui qui donne la vie a hauteur de voiture.
    const lit = seeded(seed) < 0.72;
    const wx = ox + CELL_PX * 0.1;
    const wy = h * 0.28;
    const ww = CELL_PX * 0.8;
    const wh = h * 0.5;

    a.fillStyle = lit ? "#ffca7a" : "#1b1913";
    a.fillRect(wx, wy, ww, wh);
    // montant central de la devanture
    a.fillStyle = "rgba(0,0,0,0.35)";
    a.fillRect(wx + ww / 2 - CELL_PX * 0.015, wy, CELL_PX * 0.03, wh);
    // bandeau d'enseigne au dessus
    a.fillStyle = "#211d18";
    a.fillRect(ox, h * 0.06, CELL_PX, h * 0.16);

    if (lit) {
      g.fillStyle = "#ffca7a";
      g.globalAlpha = 0.7 + seeded(seed * 7) * 0.3;
      g.fillRect(wx, wy, ww, wh);
      g.globalAlpha = 1;
    }
  }

  const map = new THREE.CanvasTexture(albedo);
  const emissiveMap = new THREE.CanvasTexture(glow);
  for (const t of [map, emissiveMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { map, emissiveMap };
}

// --- geometrie --------------------------------------------------------------

type Buf = { pos: number[]; norm: number[]; uv: number[]; col: number[] };
const newBuf = (): Buf => ({ pos: [], norm: [], uv: [], col: [] });

type Chunk = {
  /** un tampon de murs par archetype, cree a la demande */
  wall: Map<Archetype, Buf>;
  shop: Buf;
  roof: { pos: number[]; col: number[] };
};

function newChunk(): Chunk {
  return { wall: new Map(), shop: newBuf(), roof: { pos: [], col: [] } };
}

// pied de facade dans l'ombre, couronnement expose
function ramp(y: number, h: number): number {
  return 0.62 + 0.38 * Math.min(1, y / Math.max(h, 9));
}

function buildChunks(buildings: FlatBuilding[]) {
  const chunks = new Map<string, Chunk>();
  const tint = new THREE.Color();
  const roofTint = new THREE.Color();
  const scratch: THREE.Vector2[] = [];
  const painted: Painted[] = [];
  for (let i = 0; i < ARCHETYPE_COUNT; i++) painted.push(paintArchetype(STYLES[i as Archetype]));

  let shopCount = 0;
  let slopedCount = 0;
  let insetFallback = 0;

  for (const b of buildings) {
    const style = STYLES[b.archetype];
    const tex = painted[b.archetype];
    const key = `${Math.floor(b.cx / CHUNK)}:${Math.floor(b.cy / CHUNK)}`;
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, (chunk = newChunk()));
    let W = chunk.wall.get(b.archetype);
    if (!W) chunk.wall.set(b.archetype, (W = newBuf()));

    // --- teinte -------------------------------------------------------------
    // Priorite a la couleur OSM quand elle existe, puis au reglage bespoke du
    // repere, puis a la palette de l'archetype tiree au hash de l'id.
    let base = b.landmark?.wall ?? style.wall[Math.floor(hash01(b.id, 13) * style.wall.length) % style.wall.length];
    if (b.colour) {
      try {
        base = new THREE.Color().setStyle(b.colour).getHex();
      } catch {
        /* valeur OSM libre, on garde la palette */
      }
    }
    tint.setHex(base);
    // decalage de clarte de plus ou moins 5 %, seede sur l'id : ca casse la
    // platitude d'un bloc sans casser la coherence de l'archetype
    const shade = 0.95 + hash01(b.id, 29) * 0.1;
    tint.multiplyScalar(shade);
    roofTint.setHex(b.landmark?.roof ?? style.roof).multiplyScalar(shade);

    const ring = b.ring;
    const n = ring.length;
    const h = b.height;

    // Le socle commercant occupe le premier niveau ; le mur courant demarre
    // au dessus. Un batiment trop bas pour avoir un etage garde son socle seul.
    const shop = b.shopFront && h > FLOOR * 1.35;
    const base0 = shop ? FLOOR : 0;
    if (shop) shopCount++;

    // --- murs ---------------------------------------------------------------
    let run = 0; // distance parcourue le long du contour, pour l'UV
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;

      // normale sortante d'un contour en sens trigo
      const nx = dy / len;
      const ny = -dx / len;
      const px = p.x;
      const pz = -p.y;
      const qx = q.x;
      const qz = -q.y;

      if (shop) {
        const u0 = run / SHOP_TILE_U;
        const u1 = (run + len) / SHOP_TILE_U;
        const S = chunk.shop;
        S.pos.push(px, 0, pz, qx, 0, qz, qx, FLOOR, qz, px, 0, pz, qx, FLOOR, qz, px, FLOOR, pz);
        for (let k = 0; k < 6; k++) {
          S.norm.push(nx, 0, -ny);
          // le socle reste sombre, sa vie vient de l'emissif
          S.col.push(tint.r * 0.5, tint.g * 0.5, tint.b * 0.5);
        }
        S.uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      }

      const u0 = run / tex.tileU;
      const u1 = (run + len) / tex.tileU;
      run += len;
      const v = (h - base0) / TILE_V;

      // deux triangles : (p bas, q bas, q haut) et (p bas, q haut, p haut)
      W.pos.push(px, base0, pz, qx, base0, qz, qx, h, qz, px, base0, pz, qx, h, qz, px, h, pz);
      // Un clocher ou un chevalement n'a pas de rangees de fenetres allumees :
      // ses murs pointent sur le carre de mur nu, ce qui laisse une masse
      // sombre, exactement la silhouette verticale attendue.
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
      // partout le meme melange ciel/sol. C'est cette rampe qui fait lire le
      // volume, pied sombre et couronnement clair.
      const hs = [base0, base0, h, base0, h, h];
      for (let k = 0; k < 6; k++) {
        W.norm.push(nx, 0, -ny);
        const f = ramp(hs[k], h);
        W.col.push(tint.r * f, tint.g * f, tint.b * f);
      }
      W.uv.push(u0, 0, u1, 0, u1, v, u0, 0, u1, v, u0, v);
    }

    // --- couronnement -------------------------------------------------------
    // Sans bandeau au bord du toit, un batiment n'est qu'un polygone extrude et
    // la silhouette est trop nette contre le ciel. Le centre et le faubourg
    // recoivent une pente fakee, le grand ensemble et le moderne un acrotere
    // droit : la silhouette aide autant que la couleur a distinguer les strates.
    let cap = ring;
    let capY = h;
    const wantSlope = b.sloped;
    const top = wantSlope ? insetRing(ring, b.area) : null;
    const sloped = wantSlope && top !== null;
    if (wantSlope && !sloped) insetFallback++;
    if (sloped) slopedCount++;

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

      // bord haut du bandeau : rentre et sureleve si le toit est en pente,
      // strictement vertical sinon
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
        if (sloped) {
          // toiture : la couleur de toit, pas celle du mur
          W.col.push(roofTint.r, roofTint.g, roofTint.b);
        } else {
          // l'acrotere est plus clair que la facade, il accroche le ciel
          W.col.push(tint.r * 1.25, tint.g * 1.25, tint.b * 1.22);
        }
      }
      // UV bloquees sur le carre de mur nu, pour ne coller aucune fenetre ici
      W.uv.push(pu, pv, pu, pv, pu, pv, pu, pv, pu, pv, pu, pv);
    }
    if (sloped) {
      cap = top!;
      capY = h + ROOF_RISE;
    }

    // --- toiture ------------------------------------------------------------
    scratch.length = 0;
    for (let i = 0; i < n; i++) scratch.push(new THREE.Vector2(ring[i].x, ring[i].y));
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(scratch, []);
    } catch {
      faces = [];
    }
    const R = chunk.roof;
    for (const [ia, ib, ic] of faces) {
      for (const idx of [ia, ib, ic]) {
        // Le retrait est une bijection sommet a sommet, la triangulation du
        // contour d'origine reste donc valable sur le contour rentre.
        const p = cap[idx];
        R.pos.push(p.x, capY, -p.y);
        R.col.push(roofTint.r, roofTint.g, roofTint.b);
      }
    }
  }

  const geom = (b: Buf) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    return g;
  };

  const out: {
    key: string;
    walls: { archetype: Archetype; geometry: THREE.BufferGeometry }[];
    shop: THREE.BufferGeometry | null;
    roofs: THREE.BufferGeometry;
  }[] = [];

  for (const [key, c] of chunks) {
    const walls = [];
    for (const [archetype, buf] of c.wall) {
      if (!buf.pos.length) continue;
      walls.push({ archetype, geometry: geom(buf) });
    }
    if (!walls.length) continue;

    const roofs = new THREE.BufferGeometry();
    roofs.setAttribute("position", new THREE.Float32BufferAttribute(c.roof.pos, 3));
    roofs.setAttribute("color", new THREE.Float32BufferAttribute(c.roof.col, 3));
    roofs.computeVertexNormals();
    roofs.computeBoundingSphere();

    out.push({ key, walls, shop: c.shop.pos.length ? geom(c.shop) : null, roofs });
  }

  return { chunks: out, painted, stats: { shopCount, slopedCount, insetFallback } };
}

export function Buildings({ buildings }: { buildings: FlatBuilding[] }) {
  const shopTex = useMemo(paintShopFront, []);
  const built = useMemo(() => {
    const t0 = performance.now();
    const b = buildChunks(buildings);
    const tris = b.chunks.reduce(
      (a, c) =>
        a +
        c.walls.reduce((w, x) => w + x.geometry.attributes.position.count / 3, 0) +
        (c.shop ? c.shop.attributes.position.count / 3 : 0) +
        c.roofs.attributes.position.count / 3,
      0,
    );
    const meshes = b.chunks.reduce((a, c) => a + c.walls.length + (c.shop ? 1 : 0) + 1, 0);
    const perArchetype = new Map<number, number>();
    for (const x of buildings) perArchetype.set(x.archetype, (perArchetype.get(x.archetype) || 0) + 1);
    console.log(
      `batiments: ${buildings.length} volumes, ${b.chunks.length} paquets, ${meshes} maillages, ` +
        `${Math.round(tris / 1000)}k triangles, ${Math.round(performance.now() - t0)} ms\n` +
        `  archetypes: ` +
        [...perArchetype]
          .sort((x, y) => y[1] - x[1])
          .map(([a, v]) => `${ARCHETYPE_NAMES[a]} ${v}`)
          .join(", ") +
        `\n  rez commercants: ${b.stats.shopCount}, toits en pente: ${b.stats.slopedCount}` +
        (b.stats.insetFallback ? `, retrait de toit abandonne: ${b.stats.insetFallback}` : ""),
    );
    return b;
  }, [buildings]);

  return (
    <group>
      {built.chunks.map((c) => (
        <group key={c.key}>
          {c.walls.map((w) => (
            <mesh key={w.archetype} geometry={w.geometry}>
              <meshLambertMaterial
                map={built.painted[w.archetype].map}
                emissiveMap={built.painted[w.archetype].emissiveMap}
                emissive={0xffffff}
                emissiveIntensity={STYLES[w.archetype].glow}
                vertexColors
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
          {c.shop && (
            <mesh geometry={c.shop}>
              {/* la vitrine est plus lumineuse que les fenetres du dessus :
                  c'est elle qui fait la vie a hauteur de rue */}
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
          <mesh geometry={c.roofs}>
            <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
