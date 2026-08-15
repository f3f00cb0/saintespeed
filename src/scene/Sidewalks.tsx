import { useMemo } from "react";
import * as THREE from "three";
import { buildSidewalks } from "../lib/sidewalks";
import type { RoadGraph } from "../lib/graph";
import type { WallIndex } from "../lib/buildings";
import type { Way } from "../lib/osm";
import type { Projector } from "../lib/project";

// Trottoirs et bordures. La geometrie est calculee dans src/lib/sidewalks.ts,
// qui est pur et se rejoue donc dans Node : c'est la qu'on verifie qu'aucune
// bande ne tombe sur une chaussee voisine ni dans une facade.
//
// Trois maillages fusionnes : dalle, rive sombre, face de bordure.
//
// Meme boite que les lampadaires (src/scene/Lamps.tsx) : c'est un detail de
// proximite, qui ne se lit qu'a hauteur de voiture.
const AREA = 2600;

const TOP_COLOR = 0x5c5d54;
const LIP_COLOR = 0x3a3b34;
const CURB_COLOR = 0x2e2f29;

export function Sidewalks({
  ways,
  proj,
  graph,
  walls,
  centre,
  sides,
}: {
  ways: Way[];
  proj: Projector;
  graph: RoadGraph;
  walls: WallIndex | null;
  centre: { x: number; y: number };
  /** Cote releve dans OSM, quand il l'est. Prime sur la regle geometrique. */
  sides: Map<number, number> | null;
}) {
  const { top, lip, curb } = useMemo(() => {
    const m = buildSidewalks(ways, proj, graph, walls, centre, AREA, sides);
    const s = m.stats;
    console.log(
      `trottoirs: ${s.posed} cotes poses sur ${s.segments} segments, ` +
        `${s.skippedNoRoom} sans place, ${s.skippedJunction} au carrefour, ` +
        `${s.skippedOverlap} chevauchement chaussee, ${s.narrowed} rabotes sur la facade, ` +
        `${s.fromTag} decides par OSM, ${s.deniedByTag} refuses par OSM, ` +
        `${Math.round(s.triangles / 1000)}k triangles, ${s.ms} ms`,
    );
    const geo = (arr: Float32Array) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      g.computeBoundingSphere();
      return g;
    };
    return { top: geo(m.top), lip: geo(m.lip), curb: geo(m.curb) };
  }, [ways, proj, graph, walls, centre, sides]);

  if (top.attributes.position.count === 0) return null;

  return (
    <group>
      <mesh geometry={lip} renderOrder={24}>
        <meshBasicMaterial color={LIP_COLOR} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={top} renderOrder={25}>
        <meshBasicMaterial color={TOP_COLOR} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={curb} renderOrder={26}>
        <meshBasicMaterial color={CURB_COLOR} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
