import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { rand01 } from "../lib/features";

// Arbres OSM, en InstancedMesh.
//
// Saint-Etienne en a 4260 taggees a l'unite plus 153 alignements (tree_row),
// echantillonnes tous les 9 m dans features.ts. A ce volume, un mesh par arbre
// tuerait le fps : quatre InstancedMesh suffisent, une pour le tronc et trois
// pour les volumes de feuillage. Le troisieme volume, decale, casse la lecture
// en bille que deux icosaedres empiles donnaient encore de pres.
//
// La variation d'echelle et de rotation est seedee sur l'index, jamais sur
// Math.random : la ville doit etre la meme a chaque chargement, et surtout
// identique d'une frame a l'autre.

const TRUNK_H = 2.6;
const TRUNK_R = 0.17;
const CROWN_R = 2.1; // rayon du volume bas du feuillage

const TRUNK = 0x2a2318;
// Des verts varies : un feuillage d'une seule couleur lit comme une bille.
// Assez clairs pour rester du feuillage : plus sombres, les couronnes proches
// de la camera lisaient comme des trous noirs decoupes dans la ville, soit
// exactement ce qu'on est en train de corriger au sol.
//
// Chaque arbre tire sa teinte : les trois volumes gardent leur ecart de valeur
// (bas sombre, haut clair), mais l'essence change d'un arbre a l'autre. Un
// arbre sur sept a deja tourne : fin septembre, les platanes et les tilleuls
// des cours jaunissent, et dans la nuit dessinee ces taches d'ocre sont ce qui
// fait lire un alignement comme une rangee d'arbres et non un mur vert.
const GREENS = [0x3c4a2c, 0x35482f, 0x46502a, 0x31423a];
const AUTUMN = [0x6e5a26, 0x74421f, 0x7d6a2a];
const AUTUMN_SHARE = 0.15;

/** Feuillage cabosse : chaque sommet de l'icosaedre est pousse d'un bruit fixe. */
function lumpy(radius: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // la cle est la position : les copies d'un meme sommet bougent ensemble,
    // sinon la coque se dechire
    const key = Math.round(v.x * 100) * 73856093 ^ Math.round(v.y * 100) * 19349663 ^ Math.round(v.z * 100) * 83492791;
    const k = 0.82 + rand01(Math.abs(key) % 100000) * 0.36;
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

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

// Bounding sphere couvrant toutes les instances : position + rayon geometrie echelle.
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

type TreeGeo = {
  trunk: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  mid: THREE.BufferGeometry;
  high: THREE.BufferGeometry;
};

type TreeMats = {
  trunk: THREE.MeshLambertMaterial;
  low: THREE.MeshLambertMaterial;
  mid: THREE.MeshLambertMaterial;
  high: THREE.MeshLambertMaterial;
};

function TreeSector({
  indices,
  trees,
  geo,
  materials,
  radii,
}: {
  indices: number[];
  trees: { x: number; y: number }[];
  geo: TreeGeo;
  materials: TreeMats;
  radii: { trunk: number; low: number; mid: number; high: number };
}) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const low = useRef<THREE.InstancedMesh>(null);
  const mid = useRef<THREE.InstancedMesh>(null);
  const high = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!trunks.current || !low.current || !mid.current || !high.current) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    const col = new THREE.Color();
    indices.forEach((treeIdx, instIdx) => {
      const t = trees[treeIdx];
      const i = treeIdx;
      const autumn = rand01(i * 29 + 11) < AUTUMN_SHARE;
      const pal = autumn ? AUTUMN : GREENS;
      col.setHex(pal[Math.floor(rand01(i * 31 + 13) * pal.length) % pal.length]);
      // bas a l'ombre, haut dans la lumiere : l'ecart de valeur d'avant
      low.current!.setColorAt(instIdx, col.clone().multiplyScalar(0.9));
      mid.current!.setColorAt(instIdx, col);
      high.current!.setColorAt(instIdx, col.clone().multiplyScalar(1.12));
      const s = 0.7 + rand01(i * 3 + 1) * 0.55;
      const slim = 0.85 + rand01(i * 7 + 3) * 0.4;
      const rot = rand01(i * 11 + 5) * Math.PI * 2;
      const z = -t.y;
      const base = TRUNK_H * s;

      e.set(0, rot, 0);
      q.setFromEuler(e);

      pos.set(t.x, (TRUNK_H * s) / 2, z);
      scl.set(s, s, s);
      trunks.current!.setMatrixAt(instIdx, m.compose(pos, q, scl));

      // masse horizontale, pas une boule : Y ~ 0,55-0,7
      pos.set(t.x, base + CROWN_R * s * 0.28, z);
      scl.set(s * slim, s * 0.62, s * slim);
      low.current!.setMatrixAt(instIdx, m.compose(pos, q, scl));

      const side = (rand01(i * 19 + 2) - 0.5) * 1.6;
      const sideZ = (rand01(i * 23 + 4) - 0.5) * 1.6;
      pos.set(t.x + side, base + CROWN_R * s * 0.55, z + sideZ);
      scl.set(s * 0.72, s * 0.55, s * 0.72);
      mid.current!.setMatrixAt(instIdx, m.compose(pos, q, scl));

      const lean = (rand01(i * 13 + 7) - 0.5) * 1.1;
      pos.set(
        t.x + lean,
        base + CROWN_R * s * 0.95,
        z + (rand01(i * 17 + 9) - 0.5) * 1.1,
      );
      scl.set(s * 0.9, s * 0.58, s * 0.9);
      high.current!.setMatrixAt(instIdx, m.compose(pos, q, scl));
    });

    for (const r of [trunks, low, mid, high]) {
      if (r.current) r.current.instanceMatrix.needsUpdate = true;
    }
    for (const r of [low, mid, high]) {
      if (r.current?.instanceColor) r.current.instanceColor.needsUpdate = true;
    }

    fitInstancedBounds(trunks.current, radii.trunk);
    fitInstancedBounds(low.current, radii.low);
    fitInstancedBounds(mid.current, radii.mid);
    fitInstancedBounds(high.current, radii.high);
  }, [indices, trees, radii]);

  const count = indices.length;
  return (
    <>
      <instancedMesh
        ref={trunks}
        args={[geo.trunk, materials.trunk, count]}
        frustumCulled
      />
      <instancedMesh ref={low} args={[geo.low, materials.low, count]} frustumCulled />
      <instancedMesh ref={mid} args={[geo.mid, materials.mid, count]} frustumCulled />
      <instancedMesh ref={high} args={[geo.high, materials.high, count]} frustumCulled />
    </>
  );
}

export function Trees({ trees }: { trees: { x: number; y: number }[] }) {
  const sectors = useMemo(() => partitionIndices(trees), [trees]);
  const sectorKeys = useMemo(() => Array.from(sectors.keys()), [sectors]);

  const geo = useMemo(
    () => ({
      trunk: new THREE.CylinderGeometry(TRUNK_R * 0.8, TRUNK_R, TRUNK_H, 5),
      low: lumpy(CROWN_R),
      mid: lumpy(CROWN_R * 0.78),
      high: lumpy(CROWN_R * 0.68),
    }),
    [],
  );

  const materials = useMemo(
    () => ({
      trunk: new THREE.MeshLambertMaterial({ color: TRUNK }),
      // blanc : la teinte vient de la couleur d'instance
      low: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      mid: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      high: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    }),
    [],
  );

  const radii = useMemo(() => {
    geo.trunk.computeBoundingSphere();
    geo.low.computeBoundingSphere();
    geo.mid.computeBoundingSphere();
    geo.high.computeBoundingSphere();
    return {
      trunk: geo.trunk.boundingSphere!.radius,
      low: geo.low.boundingSphere!.radius,
      mid: geo.mid.boundingSphere!.radius,
      high: geo.high.boundingSphere!.radius,
    };
  }, [geo]);

  if (!trees.length) return null;

  return (
    <group>
      {sectorKeys.map((key) => (
        <TreeSector
          key={key}
          indices={sectors.get(key)!}
          trees={trees}
          geo={geo}
          materials={materials}
          radii={radii}
        />
      ))}
    </group>
  );
}
