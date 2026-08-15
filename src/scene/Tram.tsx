import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

// Le tram, signature stephanoise.
//
// 128 troncons railway=tram dans la bbox. Deux rails clairs sur une plateforme
// sombre, plus les poteaux de catenaire instancies : c'est la seule chose qui,
// sur une capture, dit "Saint-Etienne" et pas "une ville francaise".
//
// Ecartement metrique : Saint-Etienne est l'un des rares reseaux francais a
// 1000 mm, pas au standard 1435. La voie est donc visiblement etroite, et c'est
// juste.
const GAUGE = 1.0;
const RAIL_W = 0.14;
const BED_W = 2.9;

// Les routes montent jusqu'au rang 6 (0.36 m). La plateforme passe juste au
// dessus : le tram est dans la rue, il doit se lire par dessus la chaussee.
const BED_Y = 0.38;
const RAIL_Y = 0.41;

const BED_COLOR = 0x22231c;
const RAIL_COLOR = 0x8f8f7e; // acier poli, il accroche la lumiere

const POLE_SPACING = 25;
const POLE_H = 6.4;
const POLE_OFFSET = 2.6; // du milieu de voie au poteau
const POLE_COLOR = 0x2e2f28;

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

// Ruban plat le long d'une polyligne, a une demi-largeur et un decalage
// lateral donnes. Sert aux rails comme a la plateforme.
function ribbon(
  lines: { x: number; y: number }[][],
  half: number,
  offset: number,
  y: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const P of lines) {
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      dx /= len;
      dy /= len;
      // normale a gauche du sens de marche
      const ox = -dy * offset;
      const oy = dx * offset;
      const nx = -dy * half;
      const ny = dx * half;

      const ax = a.x + ox;
      const ay = a.y + oy;
      const bx = b.x + ox;
      const by = b.y + oy;

      pos.push(
        ax + nx, y, -(ay + ny), bx + nx, y, -(by + ny), bx - nx, y, -(by - ny),
        ax + nx, y, -(ay + ny), bx - nx, y, -(by - ny), ax - nx, y, -(ay - ny),
      );
      // patch de jonction : sans lui, chaque changement de direction ouvre une
      // encoche dans le rail
      const ex = dx * half;
      const ey = dy * half;
      pos.push(
        bx - ex + nx, y, -(by - ey + ny), bx + ex + nx, y, -(by + ey + ny),
        bx + ex - nx, y, -(by + ey - ny),
        bx - ex + nx, y, -(by - ey + ny), bx + ex - nx, y, -(by + ey - ny),
        bx - ex - nx, y, -(by - ey - ny),
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  return g;
}

// un poteau tous les 25 m, du meme cote de la voie
function placePoles(lines: { x: number; y: number }[][]) {
  const poles: { x: number; y: number }[] = [];
  for (const P of lines) {
    let run = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      dx /= len;
      dy /= len;
      let next = Math.ceil(run / POLE_SPACING) * POLE_SPACING;
      while (next < run + len) {
        const s = next - run;
        poles.push({
          x: a.x + dx * s - dy * POLE_OFFSET,
          y: a.y + dy * s + dx * POLE_OFFSET,
        });
        next += POLE_SPACING;
      }
      run += len;
    }
  }
  return poles;
}

export function Tram({ lines }: { lines: { x: number; y: number }[][] }) {
  const built = useMemo(() => {
    if (!lines.length) return null;
    const t0 = performance.now();
    const bed = ribbon(lines, BED_W / 2, 0, BED_Y);
    const railL = ribbon(lines, RAIL_W / 2, GAUGE / 2, RAIL_Y);
    const railR = ribbon(lines, RAIL_W / 2, -GAUGE / 2, RAIL_Y);
    const poles = placePoles(lines);
    console.log(
      `tram: ${lines.length} troncons, ${poles.length} poteaux de catenaire, ` +
        `${Math.round(performance.now() - t0)} ms`,
    );
    return { bed, railL, railR, poles };
  }, [lines]);

  const poleGeo = useMemo(() => new THREE.BoxGeometry(0.18, POLE_H, 0.18), []);
  const poleRadius = useMemo(() => {
    poleGeo.computeBoundingSphere();
    return poleGeo.boundingSphere!.radius;
  }, [poleGeo]);

  const poles = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!built || !poles.current) return;
    const m = new THREE.Matrix4();
    built.poles.forEach((p, i) => {
      poles.current!.setMatrixAt(i, m.makeTranslation(p.x, POLE_H / 2, -p.y));
    });
    poles.current.instanceMatrix.needsUpdate = true;
    fitInstancedBounds(poles.current, poleRadius);
  }, [built, poleRadius]);

  if (!built) return null;

  return (
    <group>
      <mesh geometry={built.bed} renderOrder={10}>
        <meshBasicMaterial color={BED_COLOR} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={built.railL} renderOrder={11}>
        <meshBasicMaterial color={RAIL_COLOR} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={built.railR} renderOrder={11}>
        <meshBasicMaterial color={RAIL_COLOR} side={THREE.DoubleSide} />
      </mesh>

      <instancedMesh
        ref={poles}
        args={[poleGeo, undefined, built.poles.length]}
        frustumCulled
      >
        <meshLambertMaterial color={POLE_COLOR} />
      </instancedMesh>
    </group>
  );
}
