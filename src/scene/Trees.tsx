import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { rand01 } from "../lib/features";

// Arbres OSM, en InstancedMesh.
//
// Saint-Etienne en a 4260 taggees a l'unite plus 153 alignements (tree_row),
// echantillonnes tous les 9 m dans features.ts. A ce volume, un mesh par arbre
// tuerait le fps : trois InstancedMesh suffisent, une pour le tronc et deux
// pour les volumes de feuillage.
//
// La variation d'echelle et de rotation est seedee sur l'index, jamais sur
// Math.random : la ville doit etre la meme a chaque chargement, et surtout
// identique d'une frame a l'autre.

const TRUNK_H = 2.6;
const TRUNK_R = 0.17;
const CROWN_R = 2.1; // rayon du volume bas du feuillage

const TRUNK = 0x2a2318;
// Deux verts differents : un feuillage d'une seule couleur lit comme une bille.
// Assez clairs pour rester du feuillage : plus sombres, les couronnes proches
// de la camera lisaient comme des trous noirs decoupes dans la ville, soit
// exactement ce qu'on est en train de corriger au sol.
const LEAF_LOW = 0x3c4a2c;
const LEAF_HIGH = 0x4a5735;

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
  high: THREE.BufferGeometry;
};

type TreeMats = {
  trunk: THREE.MeshLambertMaterial;
  low: THREE.MeshLambertMaterial;
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
  radii: { trunk: number; low: number; high: number };
}) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const low = useRef<THREE.InstancedMesh>(null);
  const high = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!trunks.current || !low.current || !high.current) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    indices.forEach((treeIdx, instIdx) => {
      const t = trees[treeIdx];
      const i = treeIdx;
      const s = 0.7 + rand01(i * 3 + 1) * 0.55;
      const slim = 0.85 + rand01(i * 7 + 3) * 0.4;
      const rot = rand01(i * 11 + 5) * Math.PI * 2;
      const z = -t.y;

      e.set(0, rot, 0);
      q.setFromEuler(e);

      pos.set(t.x, (TRUNK_H * s) / 2, z);
      scl.set(s, s, s);
      trunks.current!.setMatrixAt(instIdx, m.compose(pos, q, scl));

      pos.set(t.x, TRUNK_H * s + CROWN_R * s * 0.35, z);
      scl.set(s * slim, s * 0.82, s * slim);
      low.current!.setMatrixAt(instIdx, m.compose(pos, q, scl));

      const lean = (rand01(i * 13 + 7) - 0.5) * 1.1;
      pos.set(
        t.x + lean,
        TRUNK_H * s + CROWN_R * s * 1.15,
        z + (rand01(i * 17 + 9) - 0.5) * 1.1,
      );
      scl.set(s * 0.95, s * 0.95, s * 0.95);
      high.current!.setMatrixAt(instIdx, m.compose(pos, q, scl));
    });

    for (const r of [trunks, low, high]) {
      if (r.current) r.current.instanceMatrix.needsUpdate = true;
    }

    fitInstancedBounds(trunks.current, radii.trunk);
    fitInstancedBounds(low.current, radii.low);
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
      low: new THREE.IcosahedronGeometry(CROWN_R, 0),
      high: new THREE.IcosahedronGeometry(CROWN_R * 0.68, 0),
    }),
    [],
  );

  const materials = useMemo(
    () => ({
      trunk: new THREE.MeshLambertMaterial({ color: TRUNK }),
      low: new THREE.MeshLambertMaterial({ color: LEAF_LOW, flatShading: true }),
      high: new THREE.MeshLambertMaterial({ color: LEAF_HIGH, flatShading: true }),
    }),
    [],
  );

  const radii = useMemo(() => {
    geo.trunk.computeBoundingSphere();
    geo.low.computeBoundingSphere();
    geo.high.computeBoundingSphere();
    return {
      trunk: geo.trunk.boundingSphere!.radius,
      low: geo.low.boundingSphere!.radius,
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
