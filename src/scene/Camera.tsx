import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { car } from "../lib/car";
import type { WallIndex } from "../lib/buildings";
import { zAt } from "../lib/elev";

const DIST = 14; // recul derriere la voiture
const HEIGHT = 6.2;
const LOOK_AHEAD = 14;
const FOV_BASE = 68;
const FOV_MAX = 88; // s'ouvre avec la vitesse, ca donne le grisant
const MIN_DIST = 5.2; // en dessous le cadrage devient inutilisable
const SKIN = 1.2; // marge devant le mur touche
const CLEAR = 2.2; // ne jamais passer sous le MNT, surtout en descente
const targetScratch = new THREE.Vector3();
const lookAtScratch = new THREE.Vector3();

export function ChaseCamera({ walls }: { walls: WallIndex | null }) {
  const { camera } = useThree();
  const pos = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const boom = useRef(1); // fraction de bras de camera actuellement disponible
  const ready = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const cx = Math.cos(car.heading);
    const cy = Math.sin(car.heading);
    const v = Math.abs(car.speed);

    const back = DIST + v * 0.16;
    const tx = car.x - cx * back;
    const ty = car.y - cy * back;
    // hauteur lue AU POINT CAMERA, pas a la voiture : en descente le recul
    // est en amont, 14 m a 12 % = 1,7 m dans la colline si on garde z(voiture).
    const wantY = zAt(tx, ty) + HEIGHT + v * 0.03;

    let allowed = 1;
    if (walls) {
      const hit = walls.clear(car.x, car.y, tx, ty, wantY);
      if (hit < 1) {
        const d = Math.max(MIN_DIST, hit * back - SKIN);
        allowed = Math.min(1, d / back);
      }
    }
    const rate = allowed < boom.current ? 30 : 3.5;
    boom.current += (allowed - boom.current) * (1 - Math.exp(-rate * dt));

    const eff = back * boom.current;
    const bx = car.x - cx * eff;
    const by = car.y - cy * eff;
    const camH = 4.2 + (HEIGHT + v * 0.03 - 4.2) * boom.current;
    targetScratch.set(bx, zAt(bx, by) + camH, -by);

    const ahead = LOOK_AHEAD * (0.28 + 0.72 * boom.current);
    const lx = car.x + cx * ahead;
    const ly = car.y + cy * ahead;
    lookAtScratch.set(lx, zAt(lx, ly) + 1.6, -ly);

    if (!ready.current) {
      pos.current.copy(targetScratch);
      look.current.copy(lookAtScratch);
      ready.current = true;
    } else {
      pos.current.lerp(targetScratch, 1 - Math.exp(-7 * dt));
      look.current.lerp(lookAtScratch, 1 - Math.exp(-11 * dt));
    }

    if (walls) {
      const camX = pos.current.x;
      const camY = -pos.current.z;
      const hit = walls.clear(car.x, car.y, camX, camY, pos.current.y);
      if (hit < 1) {
        const dx = camX - car.x;
        const dy = camY - car.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-3) {
          const f = Math.max(MIN_DIST, hit * d - SKIN) / d;
          pos.current.x = car.x + dx * f;
          pos.current.z = -(car.y + dy * f);
        }
      }
    }

    // le lerp et le recul anti-mur peuvent encore enfoncer dans le MNT
    const gx = pos.current.x;
    const gy = -pos.current.z;
    pos.current.y = Math.max(pos.current.y, zAt(gx, gy) + CLEAR);

    camera.position.copy(pos.current);
    camera.lookAt(look.current);

    const cam = camera as THREE.PerspectiveCamera;
    const fov = FOV_BASE + (FOV_MAX - FOV_BASE) * Math.min(1, v / 45);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-4 * dt));
      cam.updateProjectionMatrix();
    }
  });

  return null;
}
