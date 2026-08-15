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
// Deux maillages fusionnes, donc deux draw calls pour toute la zone.
//
// Meme boite que les lampadaires (src/scene/Lamps.tsx) : c'est un detail de
// proximite, qui ne se lit qu'a hauteur de voiture. Mesure du harnais :
// 96 000 triangles dans la boite contre 269 000 sur la ville entiere, pour
// quelque chose d'invisible au-dela de quelques dizaines de metres.
const AREA = 2600;

// L'asphalte rendu tombe vers #31342e (palette de classe ramenee vers
// NIGHT_ASPHALT dans Roads.tsx). Le trottoir doit s'en detacher sans devenir
// une source de lumiere : un ton plus clair et un rien plus froid pour le
// beton, une bordure plus sombre. C'est le CONTRASTE entre les deux qui dessine
// la ligne de bordure, pas la valeur absolue.
const TOP_COLOR = 0x3d3e37;
const CURB_COLOR = 0x24251f;

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
  const { top, curb } = useMemo(() => {
    const m = buildSidewalks(ways, proj, graph, walls, centre, AREA, sides);
    const s = m.stats;
    console.log(
      `trottoirs: ${s.posed} cotes poses sur ${s.segments} segments, ` +
        `${s.skippedNoRoom} sans place, ${s.skippedJunction} au carrefour, ` +
        `${s.narrowed} rabotes sur la facade, ${s.corners} raccords d'angle, ` +
        `${s.fromTag} decides par OSM, ${s.deniedByTag} refuses par OSM, ` +
        `${Math.round(s.triangles / 1000)}k triangles, ${s.ms} ms`,
    );
    const geo = (arr: Float32Array) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    };
    return { top: geo(m.top), curb: geo(m.curb) };
  }, [ways, proj, graph, walls, centre, sides]);

  if (top.attributes.position.count === 0) return null;

  return (
    <group>
      {/* DoubleSide obligatoire : les bandes de gauche et de droite s'enroulent
          en sens inverse, une seule orientation en rendait la moitie invisible */}
      <mesh geometry={top} renderOrder={20}>
        <meshBasicMaterial color={TOP_COLOR} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={curb} renderOrder={21}>
        <meshBasicMaterial color={CURB_COLOR} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
