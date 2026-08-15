import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { car, input, stepCar, stepCarFrozen } from "../lib/car";
import type { RoadGraph } from "../lib/graph";
import { countdownLeft, session } from "../lib/session";
import { useStore } from "../state/store";
import { CarMesh, pulseBrake, useCarLights } from "./CarMesh";

const PUSH_INTERVAL = 0.06;
const LOCAL_COLOR = 0xff5d3b;

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
  const { headMat, tailMat } = useCarLights();

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
      body.current.position.set(car.x, 0.35, -car.y);
      body.current.rotation.y = car.heading;
      body.current.rotation.x = -car.steer * Math.min(1, Math.abs(car.speed) / 30) * 0.12;
    }

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
      <CarMesh color={LOCAL_COLOR} headMat={headMat} tailMat={tailMat} headlights />
    </group>
  );
}
