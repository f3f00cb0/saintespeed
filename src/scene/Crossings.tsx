import { useMemo } from "react";
import * as THREE from "three";
import { buildCrossings } from "../lib/crossings";
import type { RoadGraph } from "../lib/graph";
import type { Crossing } from "../lib/voirie";

// Passages pietons. La geometrie est dans src/lib/crossings.ts, qui est pur et
// se rejoue donc dans Node : c'est la qu'on verifie qu'aucune bande ne deborde
// de la chaussee.
//
// Un seul maillage fusionne, donc un draw call pour toute la zone.
//
// Meme boite que les trottoirs et les lampadaires : un marquage au sol ne se lit
// qu'a quelques dizaines de metres.
const AREA = 2600;

// Meme traitement que l'axe discontinu de Roads.tsx : la palette est calee pour
// une vue de jour, on la ramene vers l'asphalte au rendu pour que le marquage
// reste lisible sans devenir la source de lumiere de la scene. Le passage est
// un poil plus clair que l'axe : c'est de la peinture large, rechargee souvent,
// et c'est ce qui doit accrocher l'oeil a l'approche d'un carrefour.
const NIGHT_ASPHALT = 0x2a2b24;
const PAINT = 0xd8d2be;
const MIX = 0.36;

export function Crossings({
  crossings,
  graph,
  centre,
}: {
  crossings: Crossing[];
  graph: RoadGraph;
  centre: { x: number; y: number };
}) {
  const geometry = useMemo(() => {
    const m = buildCrossings(crossings, graph, centre, AREA);
    const s = m.stats;
    console.log(
      `passages pietons: ${s.posed} poses sur ${s.marked} marques dans OSM ` +
        `(${s.outsideArea} hors boite, ${s.offRoad} hors chaussee, ${s.noRoad} sans route, ` +
        `${s.merged} doublons noeud/ligne), ${s.bands} bandes, ` +
        `${Math.round(s.triangles / 1000)}k triangles, ${s.ms} ms`,
    );
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
    g.computeBoundingSphere();
    return g;
  }, [crossings, graph, centre]);

  if (geometry.attributes.position.count === 0) return null;

  return (
    <mesh geometry={geometry} renderOrder={22}>
      <meshBasicMaterial
        color={new THREE.Color(PAINT).lerp(new THREE.Color(NIGHT_ASPHALT), MIX)}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
