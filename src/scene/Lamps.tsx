import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { specFor, type Way } from "../lib/osm";
import type { Projector } from "../lib/project";
import type { RoadGraph } from "../lib/graph";

// Lampadaires le long des axes. Trois maillages instancies : le mat, la tete
// lumineuse, et une flaque de lumiere additive au sol. C'est la flaque qui fait
// tout le travail d'ambiance, le reste n'est que silhouette.

const LIT = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
]);
const SPACING = 38; // un lampadaire tous les 38 m, alternes d'un cote a l'autre
const POST_H = 8;
const GLOW_R = 11;
const WARM = 0xd49a52;

// on n'eclaire que la zone jouable, inutile de meubler toute la ville
const AREA = 2600;
// assez large pour limiter le nombre de draw calls (chaque secteur visible
// en coute un par geometrie), assez fin pour culler ce qui est hors champ
const SECTOR_SIZE = 500;

function sectorKey(x: number, y: number): string {
  return `${Math.floor(x / SECTOR_SIZE)}:${Math.floor(y / SECTOR_SIZE)}`;
}

function partitionIndices(items: { x: number; y: number }[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    const key = sectorKey(items[i].x, items[i].y);
    let arr = map.get(key);
    if (!arr) map.set(key, (arr = []));
    arr.push(i);
  }
  return map;
}

function fitInstancedBounds(mesh: THREE.InstancedMesh, baseRadius: number) {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    pos.setFromMatrixPosition(m);
    const r = baseRadius * m.getMaxScaleOnAxis();
    min.x = Math.min(min.x, pos.x - r);
    min.y = Math.min(min.y, pos.y - r);
    min.z = Math.min(min.z, pos.z - r);
    max.x = Math.max(max.x, pos.x + r);
    max.y = Math.max(max.y, pos.y + r);
    max.z = Math.max(max.z, pos.z + r);
  }

  const center = new THREE.Vector3(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    (min.z + max.z) / 2,
  );
  const radius = center.distanceTo(max);
  // sur le mesh, pas sur la geometrie : elle est partagee entre secteurs et
  // c'est mesh.boundingSphere que le frustum culling consulte en priorite
  mesh.boundingSphere = new THREE.Sphere(center, radius);
}

function makeGlowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, "rgba(255,196,120,0.40)");
  grad.addColorStop(0.3, "rgba(255,170,90,0.15)");
  grad.addColorStop(0.65, "rgba(255,150,70,0.04)");
  grad.addColorStop(1.0, "rgba(255,150,70,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Un mat est decale depuis l'axe de sa propre rue. Des qu'une rue etroite
// croise un boulevard large, ce decalage tombe en pleine chaussee voisine : on
// teste donc chaque position contre le reseau et on pousse le mat plus loin,
// ou on l'abandonne.
const PUSH = [0, 1.6, 3.2, 5]; // essais successifs vers l'exterieur
const CLEARANCE = 0.8; // marge au dela du bord de chaussee

function placeLamps(
  ways: Way[],
  proj: Projector,
  centre: { x: number; y: number },
  graph: RoadGraph,
) {
  const lamps: { x: number; y: number }[] = [];
  let rejected = 0;

  for (const w of ways) {
    if (!w.type || !LIT.has(w.type)) continue;
    const off = specFor(w.type).w / 2 + 1.1;
    const P = w.pts.map((p) => proj.project(p[0], p[1]));

    let run = 0;
    let side = 1;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      dx /= len;
      dy /= len;

      let next = Math.ceil(run / SPACING) * SPACING;
      while (next < run + len) {
        const s = next - run;
        // le mat se pose au bord de la chaussee, alternativement a gauche et a
        // droite pour eviter un alignement de poteaux
        const bx = a.x + dx * s;
        const by = a.y + dy * s;
        if (Math.abs(bx - centre.x) < AREA && Math.abs(by - centre.y) < AREA) {
          let placed = false;
          for (const extra of PUSH) {
            const d = off + extra;
            const px = bx - dy * d * side;
            const py = by + dx * d * side;
            const hit = graph.nearestEdge(px, py, 40);
            if (!hit || hit.dist > hit.edge.halfWidth + CLEARANCE) {
              lamps.push({ x: px, y: py });
              placed = true;
              break;
            }
          }
          if (!placed) rejected++;
        }
        side = -side;
        next += SPACING;
      }
      run += len;
    }
  }
  console.log(`lampadaires: ${lamps.length} poses, ${rejected} abandonnes (sur chaussee)`);
  return lamps;
}

type LampGeo = {
  post: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  pool: THREE.BufferGeometry;
};

type LampMats = {
  post: THREE.MeshLambertMaterial;
  head: THREE.MeshBasicMaterial;
  pool: THREE.MeshBasicMaterial;
};

function LampSector({
  indices,
  lamps,
  geo,
  materials,
  radii,
}: {
  indices: number[];
  lamps: { x: number; y: number }[];
  geo: LampGeo;
  materials: LampMats;
  radii: { post: number; head: number; pool: number };
}) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    indices.forEach((lampIdx, instIdx) => {
      const l = lamps[lampIdx];
      posts.current?.setMatrixAt(instIdx, m.makeTranslation(l.x, POST_H / 2, -l.y));
      heads.current?.setMatrixAt(instIdx, m.makeTranslation(l.x, POST_H, -l.y));
      if (pools.current) {
        m.copy(flat).setPosition(l.x, 0.45, -l.y);
        pools.current.setMatrixAt(instIdx, m);
      }
    });
    for (const r of [posts, heads, pools]) {
      if (r.current) r.current.instanceMatrix.needsUpdate = true;
    }
    if (posts.current) fitInstancedBounds(posts.current, radii.post);
    if (heads.current) fitInstancedBounds(heads.current, radii.head);
    if (pools.current) fitInstancedBounds(pools.current, radii.pool);
  }, [indices, lamps, radii]);

  const count = indices.length;
  return (
    <>
      <instancedMesh ref={posts} args={[geo.post, materials.post, count]} frustumCulled />
      <instancedMesh ref={heads} args={[geo.head, materials.head, count]} frustumCulled />
      <instancedMesh ref={pools} args={[geo.pool, materials.pool, count]} frustumCulled />
    </>
  );
}

export function Lamps({
  ways,
  proj,
  centre,
  graph,
}: {
  ways: Way[];
  proj: Projector;
  centre: { x: number; y: number };
  graph: RoadGraph;
}) {
  const glowTex = useMemo(makeGlowTexture, []);
  const lamps = useMemo(() => placeLamps(ways, proj, centre, graph), [ways, proj, centre, graph]);
  const sectors = useMemo(() => partitionIndices(lamps), [lamps]);
  const sectorKeys = useMemo(() => Array.from(sectors.keys()), [sectors]);

  const geo = useMemo(
    () => ({
      post: new THREE.BoxGeometry(0.22, POST_H, 0.22),
      head: new THREE.BoxGeometry(0.8, 0.18, 0.3),
      pool: new THREE.PlaneGeometry(GLOW_R, GLOW_R),
    }),
    [],
  );

  const materials = useMemo(
    () => ({
      post: new THREE.MeshLambertMaterial({ color: 0x33342b }),
      head: new THREE.MeshBasicMaterial({ color: WARM }),
      pool: new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    }),
    [glowTex],
  );

  const radii = useMemo(() => {
    geo.post.computeBoundingSphere();
    geo.head.computeBoundingSphere();
    geo.pool.computeBoundingSphere();
    return {
      post: geo.post.boundingSphere!.radius,
      head: geo.head.boundingSphere!.radius,
      pool: geo.pool.boundingSphere!.radius,
    };
  }, [geo]);

  if (!lamps.length) return null;

  return (
    <group>
      {sectorKeys.map((key) => (
        <LampSector
          key={key}
          indices={sectors.get(key)!}
          lamps={lamps}
          geo={geo}
          materials={materials}
          radii={radii}
        />
      ))}
    </group>
  );
}
