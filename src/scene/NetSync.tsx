import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { car, input } from "../lib/car";
import { sendPose, startNet } from "../lib/net";
import { useStore } from "../state/store";

const HZ = 15;

export function NetSync() {
  const acc = useRef(0);

  useEffect(() => {
    startNet();
  }, []);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 1 / HZ) return;
    acc.current = 0;
    const s = useStore.getState();
    sendPose({
      x: car.x,
      y: car.y,
      heading: car.heading,
      speed: car.speed,
      steer: car.steer,
      brake: input.brake,
      nextCp: s.nextCp,
      lapTime: s.lapTime,
      running: s.running,
    });
  });

  return null;
}
