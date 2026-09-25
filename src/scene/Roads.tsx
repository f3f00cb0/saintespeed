import { useMemo } from "react";
import * as THREE from "three";
import { LAYER_STEP, specFor, type Way } from "../lib/osm";
import type { Projector } from "../lib/project";
import type { RoadGraph } from "../lib/graph";
import { elevation, roadY, terrainY } from "../lib/elevation";
import { SAMPLE } from "../lib/roadProfile";

// Classes qui recoivent un axe discontinu. Les pointilles qui defilent sont le
// repere de vitesse le plus efficace, et ca ne coute que de la geometrie.
const MARKED = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const DASH = 3; // longueur du trait, en metres
const GAP = 4.5;
const MARK_W = 0.18; // demi-largeur du trait
const MARK_COLOR = 0xd8d2be;
const EDGE_W = 0.12; // demi-largeur d'une rive
const EDGE_INSET = 0.35; // retrait depuis le bord de chaussee
const EDGE_COLOR = 0xd8d2be;

// Tuile d'asphalte en metres : les UV du ruban sont en metres, divisees ici.
const ASPHALT_TILE = 8;

// La palette de l'etape 0 est calee pour une vue ortho de dessus, ou le clair
// sert a lire la hierarchie. De nuit et en vue basse, une chaussee claire
// devient l'objet le plus lumineux de la scene. On garde donc la palette comme
// source de verite et on la ramene vers l'asphalte au rendu, ce qui preserve la
// hierarchie relative sans eclairer la ville par le sol.
const NIGHT_ASPHALT = 0x2a2b24;
const NIGHT_MIX = 0.78;
const NIGHT_MIX_MARKS = 0.42; // les traits doivent rester lisibles
const NIGHT_MIX_EDGES = 0.55; // rives : un poil plus sombres que l'axe

function nightTint(hex: number, mix = NIGHT_MIX): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(NIGHT_ASPHALT), mix);
}

/** Grain + stries longitudinales. Presque blanc : la teinte vient du materiau. */
function paintAsphalt(): HTMLCanvasElement {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // x = le long de la voie (stries), y = en travers
      let h = (x * 374761393 + y * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const n = ((h >>> 0) % 1000) / 1000;
      const streak = Math.sin(x * 0.11) * 10 + Math.sin(x * 0.37 + y * 0.02) * 6;
      const v = Math.max(160, Math.min(255, 210 + n * 28 + streak));
      const o = (y * size + x) * 4;
      d[o] = v;
      d[o + 1] = v - 1;
      d[o + 2] = v - 3;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeAsphaltTexture() {
  const t = new THREE.CanvasTexture(paintAsphalt());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Les tampons portent des triplets (x, altitude, y nord) : avec le relief, un
// ruban n'est plus a hauteur constante. Sans relief l'altitude vaut 0 partout
// et le rendu est celui d'avant, au sommet pres.

/** Quad centre sur l'axe a -> b, de demi-largeur (hx, hy), altitudes za et zb. */
function pushQuad(
  pos: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  hx: number,
  hy: number,
) {
  pos.push(
    ax + hx, az, ay + hy, bx + hx, bz, by + hy, bx - hx, bz, by - hy,
    ax + hx, az, ay + hy, bx - hx, bz, by - hy, ax - hx, az, ay - hy,
  );
}

function toRibbonGeo(arr: number[], h: number, uv?: number[]): THREE.BufferGeometry {
  const pos = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    pos[i] = arr[i];
    pos[i + 1] = arr[i + 1] + h;
    pos[i + 2] = -arr[i + 2]; // metres nord -> -z three.js
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (uv && uv.length) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

type Layer = {
  type: string;
  geometry: THREE.BufferGeometry;
  color: number;
  textured: boolean;
};

function layerRank(type: string): number {
  if (type.endsWith("-marks")) return specFor(type.replace("-marks", "")).z + 0.5;
  if (type.endsWith("-edges")) return specFor(type.replace("-edges", "")).z + 0.3;
  return specFor(type).z;
}

type Lift = (s: number) => number;
const FLAT: Lift = () => 0;

/**
 * Altitude le long d'un segment de way, en metres depuis a. Le segment est un
 * edge du graphe (memes points, meme projection) : on lit son profil en long,
 * dans le bon sens. Faute d'edge (segment de moins de 5 cm), le terrain.
 */
function liftOf(g: RoadGraph | null, ax: number, ay: number, bx: number, by: number, len: number): Lift {
  if (!elevation.on || !g) return FLAT;
  const na = g.findNode(ax, ay);
  const nb = g.findNode(bx, by);
  const e = na && nb ? g.edgeBetween(na.id, nb.id) : undefined;
  if (!e) {
    const za = terrainY(ax, ay);
    const zb = terrainY(bx, by);
    return (s) => za + ((zb - za) * s) / len;
  }
  const forward = e.a === na!.id;
  return (s) => roadY(e.id, forward ? s / len : 1 - s / len);
}

// Extrusion des ways en rubans, une geometrie fusionnee par classe de route
// pour garder le nombre de draw calls au plancher. Un carre par sommet bouche
// les encoches dans les virages et les carrefours.
function buildRibbons(ways: Way[], proj: Projector, g: RoadGraph | null): Layer[] {
  const buckets = new Map<string, number[]>();
  const uvBuckets = new Map<string, number[]>();
  const markBuckets = new Map<string, number[]>();
  const edgeBuckets = new Map<string, number[]>();

  for (const w of ways) {
    const type = w.type || "inconnu";
    let arr = buckets.get(type);
    if (!arr) {
      buckets.set(type, (arr = []));
      uvBuckets.set(type, []);
    }
    const uv = uvBuckets.get(type)!;
    const half = specFor(w.type).w / 2;
    const width = half * 2;

    const marked = MARKED.has(type);
    let marks: number[] | undefined;
    let edges: number[] | undefined;
    if (marked) {
      marks = markBuckets.get(type);
      if (!marks) markBuckets.set(type, (marks = []));
      edges = edgeBuckets.get(type);
      if (!edges) edgeBuckets.set(type, (edges = []));
    }
    let run = 0; // distance parcourue depuis le debut de l'axe

    const P = w.pts.map((p) => proj.project(p[0], p[1]));
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      dx /= len;
      dy /= len;
      const nx = -dy * half;
      const ny = dx * half;

      const v0 = 0;
      const v1 = width / ASPHALT_TILE;

      // Ruban du segment, recoupe tous les SAMPLE metres quand le relief est
      // actif : un segment OSM peut faire 100 m, et un quad droit couperait la
      // colline qu'il gravit. Sans relief, un seul quad comme avant.
      const lift = liftOf(g, a.x, a.y, b.x, b.y, len);
      const pieces = lift === FLAT ? 1 : Math.max(1, Math.ceil(len / SAMPLE));
      for (let k = 0; k < pieces; k++) {
        const s0 = (len * k) / pieces;
        const s1 = (len * (k + 1)) / pieces;
        const z0 = lift(s0);
        const z1 = lift(s1);
        pushQuad(arr, a.x + dx * s0, a.y + dy * s0, z0, a.x + dx * s1, a.y + dy * s1, z1, nx, ny);
        const u0 = (run + s0) / ASPHALT_TILE;
        const u1 = (run + s1) / ASPHALT_TILE;
        uv.push(u0, v1, u1, v1, u1, v0, u0, v1, u1, v0, u0, v0);
      }

      // patch de jonction sur le sommet d'arrivee, a l'altitude du noeud : elle
      // est commune a toutes les rues qui s'y croisent, pas de marche
      const ex = dx * half;
      const ey = dy * half;
      const zb = lift(len);
      pushQuad(arr, b.x - ex, b.y - ey, zb, b.x + ex, b.y + ey, zb, nx, ny);
      const up = (run + len - half) / ASPHALT_TILE;
      const uq = (run + len + half) / ASPHALT_TILE;
      uv.push(up, v1, uq, v1, uq, v0, up, v1, uq, v0, up, v0);

      if (marks && edges) {
        const period = DASH + GAP;
        const mx = -dy * MARK_W;
        const my = dx * MARK_W;
        for (let t = Math.floor(run / period) * period; t < run + len; t += period) {
          const d0 = Math.max(t, run);
          const d1 = Math.min(t + DASH, run + len);
          if (d1 <= d0) continue;
          const s0 = d0 - run;
          const s1 = d1 - run;
          pushQuad(marks, a.x + dx * s0, a.y + dy * s0, lift(s0), a.x + dx * s1, a.y + dy * s1, lift(s1), mx, my);
        }

        const eoff = half - EDGE_INSET;
        if (eoff > EDGE_W + 0.2) {
          const hx = -dy * EDGE_W;
          const hy = dx * EDGE_W;
          for (const side of [-1, 1] as const) {
            const ox = -dy * side * eoff;
            const oy = dx * side * eoff;
            for (let k = 0; k < pieces; k++) {
              const s0 = (len * k) / pieces;
              const s1 = (len * (k + 1)) / pieces;
              pushQuad(
                edges,
                a.x + dx * s0 + ox, a.y + dy * s0 + oy, lift(s0),
                a.x + dx * s1 + ox, a.y + dy * s1 + oy, lift(s1),
                hx, hy,
              );
            }
          }
        }
      }
      run += len;
    }
  }

  const out: Layer[] = [];
  for (const [type, arr] of buckets) {
    if (!arr.length) continue;
    const spec = specFor(type);
    out.push({
      type,
      geometry: toRibbonGeo(arr, spec.z * LAYER_STEP, uvBuckets.get(type)),
      color: nightTint(spec.c).getHex(),
      textured: true,
    });
  }

  for (const [type, arr] of edgeBuckets) {
    if (!arr.length) continue;
    const spec = specFor(type);
    out.push({
      type: type + "-edges",
      geometry: toRibbonGeo(arr, spec.z * LAYER_STEP + 0.015),
      color: nightTint(EDGE_COLOR, NIGHT_MIX_EDGES).getHex(),
      textured: false,
    });
  }

  // marquages : juste au dessus du ruban de leur propre classe
  for (const [type, arr] of markBuckets) {
    if (!arr.length) continue;
    const spec = specFor(type);
    out.push({
      type: type + "-marks",
      geometry: toRibbonGeo(arr, spec.z * LAYER_STEP + 0.02),
      color: nightTint(MARK_COLOR, NIGHT_MIX_MARKS).getHex(),
      textured: false,
    });
  }

  // les gros axes dessines en dernier passent devant
  out.sort((a, b) => layerRank(a.type) - layerRank(b.type));
  return out;
}

export function Roads({ ways, proj, graph }: { ways: Way[]; proj: Projector; graph: RoadGraph | null }) {
  const asphaltMap = useMemo(makeAsphaltTexture, []);
  const layers = useMemo(() => {
    const l = buildRibbons(ways, proj, graph);
    const marks = l.filter((x) => x.type.endsWith("-marks"));
    const edges = l.filter((x) => x.type.endsWith("-edges"));
    const tris = l.reduce((a, x) => a + x.geometry.attributes.position.count / 3, 0);
    console.log(
      `routes: ${l.length} couches, ${Math.round(tris / 1000)}k triangles, ` +
        `marquages sur ${marks.map((m) => m.type.replace("-marks", "")).join(", ") || "aucune classe"} ` +
        `(${marks.reduce((a, m) => a + m.geometry.attributes.position.count / 6, 0)} traits), ` +
        `rives sur ${edges.map((e) => e.type.replace("-edges", "")).join(", ") || "aucune classe"}`,
    );
    return l;
  }, [ways, proj, graph]);

  // Fond sombre sous la ville. Avec le relief, il descend sous le point le plus
  // bas du terrain, sinon il couperait les rues des vallons.
  const floorY = elevation.on && elevation.relief ? elevation.relief.meta.min - elevation.z0 - 2 : -0.4;

  return (
    <group>
      <mesh position={[0, floorY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40000, 40000]} />
        <meshBasicMaterial color={0x141509} />
      </mesh>
      {layers.map((l, i) => (
        <mesh key={l.type} geometry={l.geometry} renderOrder={i}>
          <meshBasicMaterial
            color={l.color}
            map={l.textured ? asphaltMap : undefined}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
