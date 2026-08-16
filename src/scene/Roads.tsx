import { useMemo } from "react";
import * as THREE from "three";
import { LAYER_STEP, specFor, type Way } from "../lib/osm";
import type { Projector } from "../lib/project";
import { elevReady, liftGeometry } from "../lib/elev";

// Classes qui recoivent un axe discontinu. Les pointilles qui defilent sont le
// repere de vitesse le plus efficace, et ca ne coute que de la geometrie.
const MARKED = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const DASH = 3; // longueur du trait, en metres
const GAP = 4.5;
const MARK_W = 0.18; // demi-largeur du trait
const MARK_COLOR = 0xd8d2be;

// La palette de l'etape 0 est calee pour une vue ortho de dessus, ou le clair
// sert a lire la hierarchie. De nuit et en vue basse, une chaussee claire
// devient l'objet le plus lumineux de la scene. On garde donc la palette comme
// source de verite et on la ramene vers l'asphalte au rendu, ce qui preserve la
// hierarchie relative sans eclairer la ville par le sol.
const NIGHT_ASPHALT = 0x2a2b24;
const NIGHT_MIX = 0.78;
const NIGHT_MIX_MARKS = 0.42; // les traits doivent rester lisibles

function nightTint(hex: number, mix = NIGHT_MIX): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(NIGHT_ASPHALT), mix);
}

/** Sur un MNT, un segment OSM de 80 m est une corde : on le decoupe pour suivre la pente. */
function densify(P: { x: number; y: number }[], step = 5): { x: number; y: number }[] {
  if (!elevReady() || P.length < 2) return P;
  const out: { x: number; y: number }[] = [P[0]];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

// Extrusion des ways en rubans, une geometrie fusionnee par classe de route
// pour garder le nombre de draw calls au plancher. Un carre par sommet bouche
// les encoches dans les virages et les carrefours.
function buildRibbons(ways: Way[], proj: Projector) {
  const buckets = new Map<string, number[]>();
  const markBuckets = new Map<string, number[]>();

  for (const w of ways) {
    const type = w.type || "inconnu";
    let arr = buckets.get(type);
    if (!arr) buckets.set(type, (arr = []));
    const half = specFor(w.type).w / 2;

    const marked = MARKED.has(type);
    let marks: number[] | undefined;
    if (marked) {
      marks = markBuckets.get(type);
      if (!marks) markBuckets.set(type, (marks = []));
    }
    let run = 0; // distance parcourue depuis le debut de l'axe

    const P = densify(w.pts.map((p) => proj.project(p[0], p[1])));
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      dx /= len;
      dy /= len;
      const nx = -dy * half;
      const ny = dx * half;

      // ruban du segment
      arr.push(
        a.x + nx, a.y + ny, b.x + nx, b.y + ny, b.x - nx, b.y - ny,
        a.x + nx, a.y + ny, b.x - nx, b.y - ny, a.x - nx, a.y - ny,
      );

      // patch de jonction sur le sommet d'arrivee
      const ex = dx * half;
      const ey = dy * half;
      const px = b.x;
      const py = b.y;
      arr.push(
        px - ex + nx, py - ey + ny, px + ex + nx, py + ey + ny, px + ex - nx, py + ey - ny,
        px - ex + nx, py - ey + ny, px + ex - nx, py + ey - ny, px - ex - nx, py - ey - ny,
      );

      // axe discontinu, continu d'un segment a l'autre du meme axe
      if (marks) {
        const period = DASH + GAP;
        const mx = -dy * MARK_W;
        const my = dx * MARK_W;
        for (let t = Math.floor(run / period) * period; t < run + len; t += period) {
          const d0 = Math.max(t, run);
          const d1 = Math.min(t + DASH, run + len);
          if (d1 <= d0) continue;
          const s0 = d0 - run;
          const s1 = d1 - run;
          const ax = a.x + dx * s0;
          const ay = a.y + dy * s0;
          const bx = a.x + dx * s1;
          const by = a.y + dy * s1;
          marks.push(
            ax + mx, ay + my, bx + mx, by + my, bx - mx, by - my,
            ax + mx, ay + my, bx - mx, by - my, ax - mx, ay - my,
          );
        }
      }
      run += len;
    }
  }

  const out: { type: string; geometry: THREE.BufferGeometry; color: number }[] = [];
  for (const [type, arr] of buckets) {
    if (!arr.length) continue;
    const spec = specFor(type);
    const pos = new Float32Array((arr.length / 2) * 3);
    const h = spec.z * LAYER_STEP;
    for (let i = 0, j = 0; i < arr.length; i += 2, j += 3) {
      pos[j] = arr[i];
      pos[j + 1] = h;
      pos[j + 2] = -arr[i + 1]; // metres nord -> -z three.js
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    liftGeometry(geometry);
    // un cran au-dessus du MNT : sans ca la corde du sol passe devant le ruban
    const py = geometry.getAttribute("position").array as Float32Array;
    for (let k = 1; k < py.length; k += 3) py[k] += 0.08;
    out.push({ type, geometry, color: nightTint(spec.c).getHex() });
  }

  // marquages : juste au dessus du ruban de leur propre classe
  for (const [type, arr] of markBuckets) {
    if (!arr.length) continue;
    const spec = specFor(type);
    const pos = new Float32Array((arr.length / 2) * 3);
    const h = spec.z * LAYER_STEP + 0.02;
    for (let i = 0, j = 0; i < arr.length; i += 2, j += 3) {
      pos[j] = arr[i];
      pos[j + 1] = h;
      pos[j + 2] = -arr[i + 1];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    liftGeometry(geometry);
    const py = geometry.getAttribute("position").array as Float32Array;
    for (let k = 1; k < py.length; k += 3) py[k] += 0.08;
    out.push({ type: type + "-marks", geometry, color: nightTint(MARK_COLOR, NIGHT_MIX_MARKS).getHex() });
  }

  // les gros axes dessines en dernier passent devant
  out.sort((a, b) => {
    const za = specFor(a.type.replace("-marks", "")).z + (a.type.endsWith("-marks") ? 0.5 : 0);
    const zb = specFor(b.type.replace("-marks", "")).z + (b.type.endsWith("-marks") ? 0.5 : 0);
    return za - zb;
  });
  return out;
}

export function Roads({ ways, proj }: { ways: Way[]; proj: Projector }) {
  const layers = useMemo(() => {
    const l = buildRibbons(ways, proj);
    const marks = l.filter((x) => x.type.endsWith("-marks"));
    const tris = l.reduce((a, x) => a + x.geometry.attributes.position.count / 3, 0);
    console.log(
      `routes: ${l.length} couches, ${Math.round(tris / 1000)}k triangles, ` +
        `marquages sur ${marks.map((m) => m.type.replace("-marks", "")).join(", ") || "aucune classe"} ` +
        `(${marks.reduce((a, m) => a + m.geometry.attributes.position.count / 6, 0)} traits)`,
    );
    return l;
  }, [ways, proj]);

  return (
    <group>
      {layers.map((l, i) => (
        <mesh key={l.type} geometry={l.geometry} renderOrder={20 + i}>
          <meshBasicMaterial
            color={l.color}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      ))}
    </group>
  );
}
