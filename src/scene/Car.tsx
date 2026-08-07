import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { car, input, stepCar } from "../lib/car";
import type { RoadGraph } from "../lib/graph";
import { useStore } from "../state/store";
import { Headlights } from "./Headlights";

const PUSH_INTERVAL = 0.06; // s entre deux mises a jour du HUD

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

  // Materiaux partages par les deux optiques de chaque paire. Les valeurs
  // depassent 1 volontairement : c'est ce qui les fait passer le seuil de
  // luminance du bloom.
  const headMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial();
    m.color.setRGB(3.4, 3.15, 2.5);
    return m;
  }, []);
  const tailMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial();
    m.color.setRGB(1.1, 0.07, 0.045);
    return m;
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30); // pas de saut de physique sur un freeze
    stepCar(graph, dt);


    const s = useStore.getState();

    // depart automatique au premier coup d'accelerateur
    if (!s.running && Math.abs(car.speed) > 1) {
      s.startRace();
      lap.current = 0;
    }
    if (s.running) lap.current += dt;

    // checkpoint courant
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

    // mesh
    if (body.current) {
      body.current.position.set(car.x, 0.35, -car.y);
      body.current.rotation.y = car.heading;
      // roulis a l'appui, ca vend le virage
      body.current.rotation.x = -car.steer * Math.min(1, Math.abs(car.speed) / 30) * 0.12;
    }

    // feux stop : rouge sombre au roule, incandescent au freinage
    {
      const on = input.brake > 0 || (input.handbrake && Math.abs(car.speed) > 1);
      const want = on ? 6 : 1.1;
      const c = tailMat.color;
      c.r += (want - c.r) * Math.min(1, dt * 18);
      c.g = c.r * 0.06;
      c.b = c.r * 0.04;
    }

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
      {/* caisse, orientee +X = avant */}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[4.3, 0.75, 1.85]} />
        <meshLambertMaterial color={0xff5d3b} />
      </mesh>
      {/* habitacle */}
      <mesh position={[-0.35, 0.72, 0]}>
        <boxGeometry args={[2.0, 0.62, 1.6]} />
        <meshLambertMaterial color={0x24251c} />
      </mesh>
      {/* nez */}
      <mesh position={[2.0, 0.2, 0]}>
        <boxGeometry args={[0.35, 0.4, 1.6]} />
        <meshLambertMaterial color={0x8a8578} />
      </mesh>
      {/* optiques avant */}
      {[0.58, -0.58].map((z) => (
        <mesh key={z} position={[2.16, 0.24, z]} material={headMat}>
          <boxGeometry args={[0.1, 0.26, 0.44]} />
        </mesh>
      ))}
      {/* feux arriere */}
      {[0.62, -0.62].map((z) => (
        <mesh key={z} position={[-2.18, 0.26, z]} material={tailMat}>
          <boxGeometry args={[0.1, 0.2, 0.42]} />
        </mesh>
      ))}
      <Headlights />
      {/* roues */}
      {[
        [1.35, 0.95],
        [1.35, -0.95],
        [-1.35, 0.95],
        [-1.35, -0.95],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, -0.1, z]}>
          <boxGeometry args={[1.0, 0.62, 0.34]} />
          <meshLambertMaterial color={0x14150f} />
        </mesh>
      ))}
    </group>
  );
}
