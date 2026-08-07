import { useMemo } from "react";
import * as THREE from "three";
import { areaSpec, type AreaKind, type FlatArea } from "../lib/features";

// Surfaces au sol : places pietonnes, parcs, parkings, eau.
//
// C'est la couche qui bouche les trous. Une place n'est pas une ligne, donc
// l'import "routes seules" la laissait en noir : Jean Moulin et l'Hotel de
// Ville etaient des cratieres au milieu de la ville. Ici chaque polygone OSM
// devient un mesh plat, triangule a la preparation (features.ts).
//
// Une geometrie fusionnee par nature de sol, donc une poignee de draw calls
// pour plusieurs milliers de polygones.

function merge(areas: FlatArea[]) {
  const buckets = new Map<AreaKind, FlatArea[]>();
  for (const a of areas) {
    let list = buckets.get(a.kind);
    if (!list) buckets.set(a.kind, (list = []));
    list.push(a);
  }

  const out: { kind: AreaKind; geometry: THREE.BufferGeometry; color: number; z: number }[] = [];
  for (const [kind, list] of buckets) {
    let n = 0;
    for (const a of list) n += a.pos.length;
    const pos = new Float32Array(n);
    let o = 0;
    for (const a of list) {
      pos.set(a.pos, o);
      o += a.pos.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.computeBoundingSphere();
    const spec = areaSpec(kind);
    out.push({ kind, geometry, color: spec.c, z: spec.z });
  }

  // le rang de dessin double la separation en hauteur : sur deux surfaces
  // quasi coplanaires, c'est lui qui tranche
  out.sort((a, b) => a.z - b.z);
  return out;
}

export function Ground({ areas }: { areas: FlatArea[] }) {
  const layers = useMemo(() => {
    const t0 = performance.now();
    const l = merge(areas);
    const tris = l.reduce((a, x) => a + x.geometry.attributes.position.count / 3, 0);
    console.log(
      `sols: ${areas.length} surfaces, ${l.length} couches, ${Math.round(tris / 1000)}k triangles, ` +
        `${Math.round(performance.now() - t0)} ms (` +
        l.map((x) => x.kind).join(", ") +
        ")",
    );
    return l;
  }, [areas]);

  return (
    <group>
      {layers.map((l, i) => (
        <mesh key={l.kind} geometry={l.geometry} renderOrder={-100 + i}>
          {/* basic, comme les routes : de nuit la teinte est deja calee, on ne
              veut pas qu'une place pietonne devienne la source de lumiere de la
              scene sous la hemisphereLight */}
          <meshBasicMaterial color={l.color} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
