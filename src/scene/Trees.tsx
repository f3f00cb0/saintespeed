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

export function Trees({ trees }: { trees: { x: number; y: number }[] }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const low = useRef<THREE.InstancedMesh>(null);
  const high = useRef<THREE.InstancedMesh>(null);

  // geometries partagees, construites une fois
  const geo = useMemo(
    () => ({
      trunk: new THREE.CylinderGeometry(TRUNK_R * 0.8, TRUNK_R, TRUNK_H, 5),
      // peu de segments : de nuit et en mouvement, personne ne compte les faces
      low: new THREE.IcosahedronGeometry(CROWN_R, 0),
      high: new THREE.IcosahedronGeometry(CROWN_R * 0.68, 0),
    }),
    [],
  );

  useLayoutEffect(() => {
    if (!trunks.current || !low.current || !high.current) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    trees.forEach((t, i) => {
      // trois tirages independants : taille, elancement, orientation
      const s = 0.7 + rand01(i * 3 + 1) * 0.55; // de l'arbuste au platane de boulevard
      const slim = 0.85 + rand01(i * 7 + 3) * 0.4;
      const rot = rand01(i * 11 + 5) * Math.PI * 2;
      const z = -t.y;

      e.set(0, rot, 0);
      q.setFromEuler(e);

      pos.set(t.x, (TRUNK_H * s) / 2, z);
      scl.set(s, s, s);
      trunks.current!.setMatrixAt(i, m.compose(pos, q, scl));

      // volume bas : legerement aplati, il porte la silhouette
      pos.set(t.x, TRUNK_H * s + CROWN_R * s * 0.35, z);
      scl.set(s * slim, s * 0.82, s * slim);
      low.current!.setMatrixAt(i, m.compose(pos, q, scl));

      // volume haut : decale, c'est ce decalage qui casse la boule parfaite
      const lean = (rand01(i * 13 + 7) - 0.5) * 1.1;
      pos.set(
        t.x + lean,
        TRUNK_H * s + CROWN_R * s * 1.15,
        z + (rand01(i * 17 + 9) - 0.5) * 1.1,
      );
      scl.set(s * 0.95, s * 0.95, s * 0.95);
      high.current!.setMatrixAt(i, m.compose(pos, q, scl));
    });

    for (const r of [trunks, low, high]) {
      if (r.current) r.current.instanceMatrix.needsUpdate = true;
    }
  }, [trees]);

  if (!trees.length) return null;

  return (
    <group>
      <instancedMesh
        ref={trunks}
        args={[geo.trunk, undefined, trees.length]}
        frustumCulled={false}
      >
        <meshLambertMaterial color={TRUNK} />
      </instancedMesh>

      <instancedMesh ref={low} args={[geo.low, undefined, trees.length]} frustumCulled={false}>
        <meshLambertMaterial color={LEAF_LOW} flatShading />
      </instancedMesh>

      <instancedMesh ref={high} args={[geo.high, undefined, trees.length]} frustumCulled={false}>
        <meshLambertMaterial color={LEAF_HIGH} flatShading />
      </instancedMesh>
    </group>
  );
}
