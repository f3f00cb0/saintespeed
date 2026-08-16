import { useMemo } from "react";
import * as THREE from "three";
import { AREA_BASE, type FlatFence } from "../lib/features";
import { liftGeometry } from "../lib/elev";

// Clotures, haies et murets qui ceinturent les espaces ouverts.
//
// C'est le canal le plus discriminant d'un jardin, et le plus sous-exploite :
// un jardin ceinture de grilles ne ressemble a rien d'autre, et ca se lit de
// loin, avant tout detail. Un parc, lui, est ouvert : ne rien dessiner autour
// est une information au meme titre.
//
// Ne sont dans le cache que les clotures au contact d'un espace ouvert, filtre
// fait a la generation : sur 99 km de barrieres cartographiees dans la bbox,
// 27 km seulement longent un parc, un jardin ou une place.

type Spec = { h: number; half: number; color: number };

// Hauteurs volontairement modestes : ces objets doivent se lire comme une
// ceinture, pas comme un mur d'enceinte qui masquerait la place.
const SPECS: Record<FlatFence["kind"], Spec> = {
  f: { h: 1.15, half: 0, color: 0x1c1f24 }, // grille, un simple plan sombre
  h: { h: 1.5, half: 0.45, color: 0x1e2a1b }, // haie : du volume, c'est vegetal
  w: { h: 1.0, half: 0.2, color: 0x3b382f }, // muret de pierre
};

/**
 * Extrude une polyligne en ruban vertical. A half=0 on sort un simple plan, ce
 * qui suffit pour une grille ; au dela on ajoute les deux joues et le dessus,
 * pour qu'une haie garde du volume vue de trois quarts.
 */
function ribbon(pts: { x: number; y: number }[], half: number, h: number, y0: number): number[] {
  const pos: number[] = [];
  const quad = (
    ax: number, az: number, bx: number, bz: number,
    ay0: number, ay1: number,
  ) => {
    pos.push(ax, ay0, az, bx, ay0, bz, bx, ay1, bz, ax, ay0, az, bx, ay1, bz, ax, ay1, az);
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    dx /= len;
    dy /= len;
    const nx = -dy * half;
    const ny = dx * half;

    if (half <= 0) {
      quad(a.x, -a.y, b.x, -b.y, y0, y0 + h);
      continue;
    }

    // joue gauche, joue droite
    quad(a.x + nx, -(a.y + ny), b.x + nx, -(b.y + ny), y0, y0 + h);
    quad(a.x - nx, -(a.y - ny), b.x - nx, -(b.y - ny), y0, y0 + h);
    // dessus
    const t = y0 + h;
    pos.push(
      a.x + nx, t, -(a.y + ny), b.x + nx, t, -(b.y + ny), b.x - nx, t, -(b.y - ny),
      a.x + nx, t, -(a.y + ny), b.x - nx, t, -(b.y - ny), a.x - nx, t, -(a.y - ny),
    );
  }
  return pos;
}

export function Fences({ fences }: { fences: FlatFence[] }) {
  const layers = useMemo(() => {
    const t0 = performance.now();
    const buckets = new Map<FlatFence["kind"], number[]>();
    let metres = 0;

    for (const f of fences) {
      const spec = SPECS[f.kind];
      if (!spec) continue;
      for (let i = 0; i < f.pts.length - 1; i++)
        metres += Math.hypot(f.pts[i + 1].x - f.pts[i].x, f.pts[i + 1].y - f.pts[i].y);
      const pos = ribbon(f.pts, spec.half, spec.h, AREA_BASE);
      if (!pos.length) continue;
      let bucket = buckets.get(f.kind);
      if (!bucket) buckets.set(f.kind, (bucket = []));
      for (const v of pos) bucket.push(v);
    }

    const out: { kind: FlatFence["kind"]; geometry: THREE.BufferGeometry; color: number }[] = [];
    for (const [kind, pos] of buckets) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geometry.computeVertexNormals();
      liftGeometry(geometry);
      out.push({ kind, geometry, color: SPECS[kind].color });
    }

    const tris = out.reduce((a, x) => a + x.geometry.attributes.position.count / 3, 0);
    console.log(
      `clotures: ${fences.length} lignes, ${Math.round(metres / 1000)} km, ` +
        `${out.length} couches, ${Math.round(tris / 1000)}k triangles, ` +
        `${Math.round(performance.now() - t0)} ms`,
    );
    return out;
  }, [fences]);

  return (
    <group>
      {layers.map((l) => (
        <mesh key={l.kind} geometry={l.geometry}>
          {/* Lambert et non basic : une ceinture doit prendre la lumiere du
              ciel pour se detacher du sol, sinon elle disparait dans l'aplat */}
          <meshLambertMaterial color={l.color} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
