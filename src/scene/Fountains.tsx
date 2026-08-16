import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { zAt } from "../lib/elev";

// Fontaines OSM. Elles sont posees exactement la ou on veut que le regard
// s'arrete : au milieu des places. Une vasque sombre et un plan d'eau qui
// accroche le bloom suffisent, a cette echelle personne ne demande un jet.
//
// Le rayon vient du bassin cartographie, il n'est plus constant : une fontaine
// de place et une fontaine a boire ne font pas la meme tache au sol. Les
// bassins sont des ways dans OSM, et ne prendre que les noeuds ratait
// justement les trois qui comptent, celle de la place du Peuple et les deux
// devant la cathedrale a Jean Jaures.

const BASIN_R = 1;
const BASIN_H = 0.6;
const WATER_Y = BASIN_H * 0.82;

const STONE = 0x3b3a32;
const WATER = 0x2c4a63;

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
  // sur le mesh : c'est mesh.boundingSphere que le frustum culling consulte
  mesh.boundingSphere = new THREE.Sphere(center, radius);
}

export function Fountains({ points }: { points: { x: number; y: number; r: number }[] }) {
  const basins = useRef<THREE.InstancedMesh>(null);
  const water = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!basins.current || !water.current) return;
    const m = new THREE.Matrix4();
    const flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const s = new THREE.Vector3();
    points.forEach((p, i) => {
      // le cylindre et le disque sont unitaires, l'echelle porte le rayon reel
      const gz = zAt(p.x, p.y);
      s.set(p.r, 1, p.r);
      basins.current!.setMatrixAt(
        i,
        m.makeTranslation(p.x, gz + BASIN_H / 2, -p.y).scale(s),
      );
      s.set(p.r * 0.82, p.r * 0.82, 1);
      water.current!.setMatrixAt(
        i,
        m.copy(flat).setPosition(p.x, gz + WATER_Y, -p.y).scale(s),
      );
    });
    basins.current.instanceMatrix.needsUpdate = true;
    water.current.instanceMatrix.needsUpdate = true;

    const basinGeo = basins.current.geometry;
    const waterGeo = water.current.geometry;
    basinGeo.computeBoundingSphere();
    waterGeo.computeBoundingSphere();
    fitInstancedBounds(basins.current, basinGeo.boundingSphere!.radius);
    fitInstancedBounds(water.current, waterGeo.boundingSphere!.radius);
  }, [points]);

  if (!points.length) return null;

  return (
    <group>
      <instancedMesh ref={basins} args={[undefined, undefined, points.length]} frustumCulled>
        <cylinderGeometry args={[BASIN_R, BASIN_R * 1.05, BASIN_H, 12]} />
        <meshLambertMaterial color={STONE} />
      </instancedMesh>

      <instancedMesh ref={water} args={[undefined, undefined, points.length]} frustumCulled>
        <circleGeometry args={[BASIN_R * 0.9, 12]} />
        <meshBasicMaterial color={WATER} />
      </instancedMesh>
    </group>
  );
}
