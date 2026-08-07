import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";

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
      s.set(p.r, 1, p.r);
      basins.current!.setMatrixAt(
        i,
        m.makeTranslation(p.x, BASIN_H / 2, -p.y).scale(s),
      );
      water.current!.setMatrixAt(
        i,
        m.copy(flat).setPosition(p.x, WATER_Y, -p.y).scale(new THREE.Vector3(p.r * 0.82, p.r * 0.82, 1)),
      );
    });
    basins.current.instanceMatrix.needsUpdate = true;
    water.current.instanceMatrix.needsUpdate = true;
  }, [points]);

  if (!points.length) return null;

  return (
    <group>
      <instancedMesh
        ref={basins}
        args={[undefined, undefined, points.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[BASIN_R, BASIN_R * 1.05, BASIN_H, 12]} />
        <meshLambertMaterial color={STONE} />
      </instancedMesh>

      <instancedMesh ref={water} args={[undefined, undefined, points.length]} frustumCulled={false}>
        <circleGeometry args={[BASIN_R * 0.9, 12]} />
        <meshBasicMaterial color={WATER} />
      </instancedMesh>
    </group>
  );
}
