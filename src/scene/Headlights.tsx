import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { car } from "../lib/car";
import { zAt } from "../lib/elev";

// Faisceau projete au sol devant la voiture. La chaussee est en
// MeshBasicMaterial et n'est donc eclairee par aucune lumiere : on triche avec
// un quad additif texture, c'est le truc arcade classique.
//
// En relief, un plan unique de 46 m rentre dans la colline en descente (crete
// convexe) ou vole au-dessus (concave). On le decoupe et chaque sommet lit zAt.

const LENGTH = 46;
const WIDTH = 24;
const SEGS = 10;
const BUMPER = 1.6;
const PX = 256;

function makeBeamTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = PX;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(PX, PX);
  const d = img.data;

  for (let j = 0; j < PX; j++) {
    const lateral = (j / (PX - 1)) * 2 - 1;
    for (let i = 0; i < PX; i++) {
      const u = i / (PX - 1);
      const spread = 0.1 + 0.62 * u;
      const halfW = 0.14 + 0.5 * u;
      let v = 0;
      for (const side of [-1, 1]) {
        const dx = (lateral - side * spread) / halfW;
        v += Math.exp(-dx * dx * 2.2);
      }
      const near = Math.min(1, u / 0.07);
      const far = Math.pow(Math.max(0, 1 - u), 1.7);
      const a = Math.min(1, v * 0.62) * near * far;
      const o = (j * PX + i) * 4;
      d[o] = 255;
      d[o + 1] = 244;
      d[o + 2] = 214;
      d[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Headlights() {
  const beam = useMemo(makeBeamTexture, []);
  const mesh = useRef<THREE.Mesh>(null);
  const rest = useMemo(() => {
    const g = new THREE.PlaneGeometry(LENGTH, WIDTH, SEGS, 1);
    const src = g.getAttribute("position");
    const xy = new Float32Array(src.count * 2);
    for (let i = 0; i < src.count; i++) {
      xy[i * 2] = src.getX(i);
      xy[i * 2 + 1] = src.getY(i);
    }
    return { g, xy, n: src.count };
  }, []);

  useFrame(() => {
    const attr = rest.g.getAttribute("position");
    const hx = Math.cos(car.heading);
    const hy = Math.sin(car.heading);
    const nx = -hy;
    const ny = hx;
    const xy = rest.xy;
    for (let i = 0; i < rest.n; i++) {
      const along = (xy[i * 2] + LENGTH / 2) + BUMPER;
      const lat = xy[i * 2 + 1];
      const x = car.x + hx * along + nx * lat;
      const y = car.y + hy * along + ny * lat;
      attr.setXYZ(i, x, zAt(x, y) + 0.06, -y);
    }
    attr.needsUpdate = true;
    rest.g.computeBoundingSphere();
  });

  return (
    <mesh ref={mesh} geometry={rest.g} frustumCulled={false}>
      <meshBasicMaterial
        map={beam}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        fog={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}
