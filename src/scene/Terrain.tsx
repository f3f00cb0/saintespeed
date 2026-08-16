import { useMemo } from "react";
import * as THREE from "three";
import { elevMeta, elevReady, zAt } from "../lib/elev";

// Sol de la ville, drapé sur le MNT. Meme pas que la grille IGN (16 m) : un
// cran sur deux laissait des triangles de 32 m passer AU-DESSUS de la chaussee
// en descente (l'Eternite a -16 %). C'est le « noir de base » qui mangait la
// texture. On enfonce aussi un peu le MNT pour garder la corde sous le ruban.

const STRIDE = 1;
const COLOR = 0x141509;
const SKIRT = -20;
const BIAS = -0.7;

export function Terrain() {
  const geometry = useMemo(() => {
    const m = elevMeta();
    if (!m || !elevReady()) return null;
    const nx = Math.floor((m.nx - 1) / STRIDE) + 1;
    const ny = Math.floor((m.ny - 1) / STRIDE) + 1;
    const nGrid = nx * ny;
    const nSkirt = nx * 2 + ny * 2;
    const pos = new Float32Array((nGrid + nSkirt) * 3);

    const put = (i: number, x: number, y: number, z: number) => {
      const o = i * 3;
      pos[o] = x;
      pos[o + 1] = z;
      pos[o + 2] = -y;
    };

    const gx = (i: number) => m.x0 + Math.min(i * STRIDE, m.nx - 1) * m.dx;
    const gy = (j: number) => m.y0 + Math.min(j * STRIDE, m.ny - 1) * m.dy;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = gx(i);
        const y = gy(j);
        put(j * nx + i, x, y, zAt(x, y) + BIAS);
      }
    }

    let s = nGrid;
    const south: number[] = [];
    const north: number[] = [];
    const west: number[] = [];
    const east: number[] = [];
    for (let i = 0; i < nx; i++) {
      south.push(s);
      put(s++, gx(i), gy(0), SKIRT);
    }
    for (let i = 0; i < nx; i++) {
      north.push(s);
      put(s++, gx(i), gy(ny - 1), SKIRT);
    }
    for (let j = 0; j < ny; j++) {
      west.push(s);
      put(s++, gx(0), gy(j), SKIRT);
    }
    for (let j = 0; j < ny; j++) {
      east.push(s);
      put(s++, gx(nx - 1), gy(j), SKIRT);
    }

    const nFaces = (nx - 1) * (ny - 1) + (nx - 1) * 2 + (ny - 1) * 2;
    const idx = new Uint32Array(nFaces * 6);
    let t = 0;
    const tri = (a: number, b: number, c: number) => {
      idx[t++] = a;
      idx[t++] = b;
      idx[t++] = c;
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        tri(a, c, b);
        tri(b, c, d);
      }
    }
    for (let i = 0; i < nx - 1; i++) {
      const a = i;
      const b = i + 1;
      tri(a, b, south[i]);
      tri(b, south[i + 1], south[i]);
      const na = (ny - 1) * nx + i;
      const nb = na + 1;
      tri(na, north[i], nb);
      tri(nb, north[i], north[i + 1]);
    }
    for (let j = 0; j < ny - 1; j++) {
      const a = j * nx;
      const b = a + nx;
      tri(a, west[j], b);
      tri(b, west[j], west[j + 1]);
      const ea = j * nx + (nx - 1);
      const eb = ea + nx;
      tri(ea, eb, east[j]);
      tri(eb, east[j + 1], east[j]);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    console.log(`terrain: ${nx}×${ny}, ${Math.round(idx.length / 3 / 1000)}k triangles`);
    return g;
  }, []);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={-120}>
      <meshBasicMaterial color={COLOR} />
    </mesh>
  );
}
