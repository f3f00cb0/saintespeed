import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { car } from "../lib/car";
import type { WallIndex } from "../lib/buildings";

const DIST = 14; // recul derriere la voiture
const HEIGHT = 6.2;
const LOOK_AHEAD = 14;
const FOV_BASE = 68;
const FOV_MAX = 88; // s'ouvre avec la vitesse, ca donne le grisant
const MIN_DIST = 5.2; // en dessous le cadrage devient inutilisable
const SKIN = 1.2; // marge devant le mur touche
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

    // plus on va vite, plus la camera recule et se leve
    const back = DIST + v * 0.16;
    const wantY = HEIGHT + v * 0.03;

    // Bras de camera : on teste le trajet voiture -> camera contre les murs et
    // on rentre la camera devant l'obstacle. Sans ca elle traverse les
    // immeubles des qu'on longe une facade ou qu'on sort d'une rue etroite.
    let allowed = 1;
    if (walls) {
      const tx = car.x - cx * back;
      const ty = car.y - cy * back;
      const hit = walls.clear(car.x, car.y, tx, ty, wantY);
      if (hit < 1) {
        const d = Math.max(MIN_DIST, hit * back - SKIN);
        allowed = Math.min(1, d / back);
      }
    }
    // on rentre vite pour ne pas traverser, on ressort doucement
    const rate = allowed < boom.current ? 30 : 3.5;
    boom.current += (allowed - boom.current) * (1 - Math.exp(-rate * dt));

    const eff = back * boom.current;
    // Rentree, la camera monte au lieu de descendre : de pres et bas elle
    // perd la voiture, de pres et haut elle la surplombe et reste lisible.
    targetScratch.set(
      car.x - cx * eff,
      4.2 + (wantY - 4.2) * boom.current,
      -(car.y - cy * eff),
    );
    // le point vise se rapproche avec le bras, sinon la voiture sort du cadre
    const ahead = LOOK_AHEAD * (0.28 + 0.72 * boom.current);
    lookAtScratch.set(car.x + cx * ahead, 1.6, -(car.y + cy * ahead));

    if (!ready.current) {
      pos.current.copy(targetScratch);
      look.current.copy(lookAtScratch);
      ready.current = true;
    } else {
      // lissage exponentiel, independant du framerate
      pos.current.lerp(targetScratch, 1 - Math.exp(-7 * dt));
      look.current.lerp(lookAtScratch, 1 - Math.exp(-11 * dt));
    }

    // Verrou dur apres lissage : pendant que la camera rattrape sa cible elle
    // peut encore traverser un mur, on la reprojette donc devant l'obstacle.
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
