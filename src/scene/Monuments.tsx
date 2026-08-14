import { useMemo } from "react";
import * as THREE from "three";
import { MONUMENT_POINTS, POINT_KIND_NAMES } from "../lib/monumentPoints";
import { kitForPointKind, PLACE_MONUMENTS } from "../lib/monuments";
import { newEmit, toGeometry } from "../lib/landmarkGeometry";
import type { Projector } from "../lib/project";

// Les objets ponctuels de l'espace public : croix de chemin, monuments aux
// morts, steles, bustes, statues. 55 objets releves dans l'export patrimoine et
// filtres a la generation (src/lib/monumentPoints.ts).
//
// TOUT est fusionne en deux maillages, un plein et un lumineux, et c'est le
// point d'architecture qui compte : passes par le mecanisme des reperes, ces 55
// objets auraient coute jusqu'a 150 draw calls, contre 194 pour la ville
// entiere. Ils en coutent deux.
//
// Construits une fois, hors streaming : quelques milliers de triangles pour
// toute la ville, et un objet de 3 m qui apparaitrait par tuiles se verrait.

/** Deux objets a moins de 5 m sont le meme : les places traitees a la main
 *  priment sur la typologie generique. */
const MERGE_DIST = 5;

export function Monuments({ proj }: { proj: Projector }) {
  const built = useMemo(() => {
    const t0 = performance.now();
    const e = newEmit();

    // Ce qui est deja pose individuellement (place Jean-Jaures) ne doit pas
    // etre double par sa typologie.
    const placed = PLACE_MONUMENTS.map((m) => proj.project(m.lon, m.lat));

    let posed = 0;
    let skipped = 0;
    const byKind = new Array(POINT_KIND_NAMES.length).fill(0);

    for (const [lon, lat, kind, name] of MONUMENT_POINTS) {
      const p = proj.project(lon, lat);
      if (placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < MERGE_DIST)) {
        skipped++;
        continue;
      }
      // graine stable tiree des coordonnees : le fichier genere ne porte pas
      // d'id OSM, et deux relances doivent donner la meme ville
      const seed = (Math.round(lon * 1e5) ^ Math.round(lat * 1e5)) | 0;
      const kit = kitForPointKind(kind, seed);
      if (!kit) continue;
      const anchor = { x: p.x, y: p.y, rot: (seed % 360) * (Math.PI / 180) };
      const dims = { w: 0, d: 0, area: 0, height: 0, minx: 0, maxx: 0, miny: 0, maxy: 0 };
      kit(e, anchor, null as never, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, dims);
      posed++;
      byKind[kind]++;
      void name;
    }

    const solid = toGeometry(e.roofs, false);
    const glow = toGeometry(e.glow, false);
    const tris = (e.roofs.pos.length + e.glow.pos.length) / 9;
    console.log(
      `objets d'espace public: ${posed} poses (${byKind
        .map((n, i) => `${POINT_KIND_NAMES[i]} ${n}`)
        .join(", ")}), ${skipped} deja traites a la main, ` +
        `${Math.round(tris)} tris en ${solid ? 1 : 0}+${glow ? 1 : 0} maillages, ` +
        `${Math.round(performance.now() - t0)} ms`,
    );
    return { solid, glow };
  }, [proj]);

  return (
    <group>
      {built.solid && (
        <mesh geometry={built.solid}>
          <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
        </mesh>
      )}
      {built.glow && (
        <mesh geometry={built.glow}>
          <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
