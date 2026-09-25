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
  frameOf, newEmit, toGeometry, type Anchor, type Buf as KitBuf, type Tint,
} from "../lib/landmarkGeometry";
import { LANDMARK_KITS, SYNTHETIC_LANDMARKS } from "../lib/landmarks";
import { SINK, footingOf } from "../lib/footing";
import { surfaceY } from "../lib/elevation";

const tintOf = (hex: number): Tint => {
  const c = new THREE.Color(hex);
  return { r: c.r, g: c.g, b: c.b };
};

type Built = {
  key: string;
  /** niveau de pose sur le relief, y three.js */
  y: number;
  archetype: Archetype;
  walls: THREE.BufferGeometry | null;
  roofs: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
};

/**
 * Socle d'un repere qui remplace son batiment (Zenith, chevalement, auvents de
 * quai). Son kit part de 0, pose au pied de sa facade ; mais sans murs extrudes
 * descendus a chaque angle, l'arriere flottait la ou le sol baisse : 4,8 m sous
 * le Zenith. Un soubassement de pierre sombre suit donc l'emprise, du sol de
 * chaque angle (60 cm dessous) jusqu'au niveau du kit. En repere local du
 * groupe, deja monte au niveau de reference.
 */
function plinth(R: KitBuf, b: FlatBuilding, tint: Tint) {
  const foot = footingOf(b);
  const n = b.ring.length;
  const r = tint.r * 0.45;
  const g = tint.g * 0.45;
  const bl = tint.b * 0.45;
  for (let i = 0; i < n; i++) {
    const p = b.ring[i];
    const q = b.ring[(i + 1) % n];
    const lp = foot.g[i] - foot.y0 - SINK;
    const lq = foot.g[(i + 1) % n] - foot.y0 - SINK;
    if (lp >= 0 && lq >= 0) continue; // le sol est deja au niveau du kit
    const top = 0.05;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const nz = dx / len;
    R.pos.push(
      p.x, Math.min(lp, top), -p.y, q.x, Math.min(lq, top), -q.y, q.x, top, -q.y,
      p.x, Math.min(lp, top), -p.y, q.x, top, -q.y, p.x, top, -p.y,
    );
    for (let k = 0; k < 6; k++) {
      R.norm.push(nx, 0, nz);
      R.col.push(r, g, bl);
    }
  }
}

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
      if (b.landmark.replaceBase) plinth(e.roofs, b, tint);
      const tris = (e.walls.pos.length + e.roofs.pos.length + e.glow.pos.length) / 9;
      if (tris === 0) console.warn(`repere ${b.id}: kit vide (aucune geometrie)`);
      // Le kit monte au niveau de reference du repere : le sol devant sa
      // facade principale (lib/footing.ts), le meme que ses murs extrudes.
      const foot = footingOf(b);
      out.push({
        key: `lm-${b.id}`,
        y: foot.y0,
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
        y: surfaceY(p.x, p.y),
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
        <group key={m.key} position={[0, m.y, 0]}>
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
