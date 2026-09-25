import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { car, input, stepCar, stepCarFrozen } from "../lib/car";
import type { RoadGraph } from "../lib/graph";
import { countdownLeft, session } from "../lib/session";
import { useStore } from "../state/store";
import { CarMesh, pulseBrake, useCarLights } from "./CarMesh";
import { bang } from "../lib/bangs";

const PUSH_INTERVAL = 0.06;
const LOCAL_COLOR = 0xff5d3b;

const carMotion = () => car;

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function Car({ graph }: { graph: RoadGraph }) {
  const body = useRef<THREE.Group>(null);
  const acc = useRef(0);
  const lap = useRef(0);
  const frames = useRef(0);
  // onomatopees : ZOOOM au passage des 150 km/h, rearme sous 120 ; BONK en
  // sortant de la chaussee a vitesse
  const zoomArmed = useRef(true);
  const wasOff = useRef(false);
  const { headMat, tailMat } = useCarLights();
  // tangage affiche, lisse : le profil change de pente tous les 8 m, et suivre
  // chaque cassure a la lettre faisait vibrer la caisse
  const pitch = useRef(0);
  // Altitude affichee. Le profil est une ligne par rue : quand la voiture coupe
  // un virage a 6 m de l'axe, passer d'une rue a l'autre du carrefour decale
  // l'altitude de 10 a 20 cm d'un coup. On la filtre, mais en anticipant la
  // vitesse verticale : un simple lissage laisserait la caisse s'enfoncer de
  // 20 cm dans une cote a 170 km/h.
  const shownZ = useRef(NaN);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const s = useStore.getState();
    if (countdownLeft() > 0) {
      stepCarFrozen(graph, dt);
    } else {
      if (session.goAt > 0) {
        session.goAt = 0;
        if (!s.running && s.checkpoints.length >= 2) {
          s.startRace();
          lap.current = 0;
        }
      }
      stepCar(graph, dt);
      if (!s.running && s.checkpoints.length >= 2 && Math.abs(car.speed) > 1) {
        s.startRace();
        lap.current = 0;
      }
    }

    if (s.running) lap.current += dt;

    const cp = s.checkpoints[s.nextCp];
    let dist = 0;
    let bearing = 0;
    if (cp) {
      const dx = cp.x - car.x;
      const dy = cp.y - car.y;
      dist = Math.hypot(dx, dy);
      bearing = wrap(Math.atan2(dy, dx) - car.heading);
      if (dist < cp.radius && s.running) {
        const closing = s.nextCp === 0;
        s.passCheckpoint();
        if (closing) lap.current = 0;
      }
    }

    if (body.current) {
      const zNow = Number.isFinite(car.z) ? car.z : 0;
      if (!Number.isFinite(shownZ.current) || Math.abs(zNow - shownZ.current) > 3) shownZ.current = zNow;
      shownZ.current += car.vz * dt;
      shownZ.current += (zNow - shownZ.current) * (1 - Math.exp(-20 * dt));
      const z = shownZ.current;
      pitch.current += (car.pitch - pitch.current) * (1 - Math.exp(-(car.air ? 2 : 12) * dt));
      body.current.position.set(car.x, 0.35 + z, -car.y);
      // cap, puis tangage autour de l'essieu, puis roulis : l'ordre compte, sinon
      // le tangage s'appliquerait dans le repere du monde et non de la caisse
      body.current.rotation.order = "YZX";
      body.current.rotation.y = car.heading;
      body.current.rotation.z = pitch.current;
      body.current.rotation.x = -car.steer * Math.min(1, Math.abs(car.speed) / 30) * 0.12;
    }

    const kmh = Math.abs(car.speed) * 3.6;
    if (zoomArmed.current && kmh > 150) {
      bang("zoom");
      zoomArmed.current = false;
    } else if (kmh < 120) zoomArmed.current = true;
    if (car.offroad && !wasOff.current && kmh > 40) bang("offroad");
    wasOff.current = car.offroad;

    pulseBrake(tailMat, input.brake > 0 || (input.handbrake && Math.abs(car.speed) > 1), dt);

    acc.current += dt;
    frames.current++;
    if (acc.current >= PUSH_INTERVAL) {
      const fps = frames.current / acc.current;
      acc.current = 0;
      frames.current = 0;
      s.setTele(
        {
          fps,
          speedKmh: car.speed * 3.6,
          roadName: car.roadName,
          roadType: car.roadType,
          offroad: car.offroad,
          cpDist: dist,
          cpBearing: bearing,
        },
        lap.current,
      );
    }
  });

  return (
    <group ref={body}>
      <CarMesh color={LOCAL_COLOR} headMat={headMat} tailMat={tailMat} headlights motion={carMotion} />
    </group>
  );
}
