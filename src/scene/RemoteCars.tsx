import { useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { onPeers, peerListKey, peers, samplePeer } from "../lib/peers";
import { CarMesh, pulseBrake, useCarLights } from "./CarMesh";

function RemoteCar({ id }: { id: string }) {
  const body = useRef<THREE.Group>(null);
  const { headMat, tailMat } = useCarLights();
  const peer = peers.get(id);
  const color = peer?.color ?? 0x5ec8e0;

  useFrame((_, dt) => {
    const p = peers.get(id);
    if (!p || !body.current) return;
    samplePeer(p, performance.now());
    body.current.position.set(p.x, 0.35, -p.y);
    body.current.rotation.y = p.heading;
    body.current.rotation.x = -p.steer * Math.min(1, Math.abs(p.speed) / 30) * 0.12;
    pulseBrake(tailMat, p.brake > 0.2, dt);
  });

  return (
    <group ref={body}>
      <CarMesh color={color} headMat={headMat} tailMat={tailMat} />
    </group>
  );
}

export function RemoteCars() {
  const key = useSyncExternalStore(onPeers, peerListKey, peerListKey);
  if (!key) return null;
  return (
    <group>
      {key.split(",").map((id) => (
        <RemoteCar key={id} id={id} />
      ))}
    </group>
  );
}
