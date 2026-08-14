// Rendu des reperes : les monuments dont la silhouette est reprisee a la main
// (src/lib/landmarks.ts), poses sur leur emprise OSM reelle, plus le stade
// Geoffroy-Guichard qui n'existe pas comme building dans OSM.
//
// Chaque kit produit jusqu'a trois maillages : murs textures (la meme facade
// que les batiments courants), volumes pleins (toits, voutes, chevalement) et
// elements lumineux (horloges, croix, projecteurs). Peu de reperes, donc peu de
// draw calls : on les construit une fois, pas de streaming.

import { useMemo } from "react";
import * as THREE from "three";
import { Archetype, STYLES } from "../lib/archetypes";
import type { FlatBuilding } from "../lib/buildings";
import type { Projector } from "../lib/project";
import { getFacadeTextures } from "../lib/facadeTextures";
import {
  frameOf, newEmit, toGeometry, type Anchor, type Tint,
} from "../lib/landmarkGeometry";
import { LANDMARK_KITS, SYNTHETIC_LANDMARKS } from "../lib/landmarks";

const tintOf = (hex: number): Tint => {
  const c = new THREE.Color(hex);
  return { r: c.r, g: c.g, b: c.b };
};

type Built = {
  key: string;
  archetype: Archetype;
  walls: THREE.BufferGeometry | null;
  roofs: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
};

export function Landmarks({ buildings, proj }: { buildings: FlatBuilding[]; proj: Projector }) {
  const painted = useMemo(() => getFacadeTextures(), []);

  const built = useMemo(() => {
    const out: Built[] = [];

    // reperes sur emprise OSM
    for (const b of buildings) {
      const kit = LANDMARK_KITS.get(b.id);
      if (!kit || !b.landmark) continue;
      const frame = frameOf(b.ring, b.height, b.landmark.rot);
      const style = STYLES[b.archetype];
      const tint = tintOf(b.landmark.wall ?? style.wall[0]);
      const roofTint = tintOf(b.landmark.roof ?? style.roof);

      const e = newEmit();
      kit(e, frame, painted[b.archetype], tint, roofTint, frame);
      const tris = (e.walls.pos.length + e.roofs.pos.length + e.glow.pos.length) / 9;
      if (tris === 0) console.warn(`repere ${b.id}: kit vide (aucune geometrie)`);
      out.push({
        key: `lm-${b.id}`,
        archetype: b.archetype,
        walls: toGeometry(e.walls, true),
        roofs: toGeometry(e.roofs, false),
        glow: toGeometry(e.glow, false),
      });
    }

    // reperes synthetiques (stade)
    for (const syn of SYNTHETIC_LANDMARKS) {
      const p = proj.project(syn.lon, syn.lat);
      const anchor: Anchor = { x: p.x, y: p.y, rot: syn.rot };
      const e = newEmit();
      syn.build(e, anchor, painted[0], { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 },
        { w: 0, d: 0, area: 0, height: 0, minx: 0, maxx: 0, miny: 0, maxy: 0 });
      out.push({
        key: syn.key,
        archetype: Archetype.Pierre,
        walls: toGeometry(e.walls, true),
        roofs: toGeometry(e.roofs, false),
        glow: toGeometry(e.glow, false),
      });
    }

    let totalTris = 0, nGlow = 0;
    for (const m of out) {
      if (m.walls) totalTris += m.walls.attributes.position.count / 3;
      if (m.roofs) totalTris += m.roofs.attributes.position.count / 3;
      if (m.glow) { totalTris += m.glow.attributes.position.count / 3; nGlow++; }
    }
    console.log(
      `reperes: ${out.length} kits (${out.length - SYNTHETIC_LANDMARKS.length} sur emprise, ` +
        `${SYNTHETIC_LANDMARKS.length} synthetique), ${Math.round(totalTris)} tris, ${nGlow} maillages lumineux`,
    );

    return out;
  }, [buildings, proj, painted]);

  return (
    <group>
      {built.map((m) => (
        <group key={m.key}>
          {m.walls && (
            <mesh geometry={m.walls}>
              <meshLambertMaterial
                map={painted[m.archetype].map}
                emissiveMap={painted[m.archetype].emissiveMap}
                emissive={0xffffff}
                emissiveIntensity={STYLES[m.archetype].glow}
                vertexColors
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          {m.roofs && (
            <mesh geometry={m.roofs}>
              <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
            </mesh>
          )}
          {m.glow && (
            <mesh geometry={m.glow}>
              <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
