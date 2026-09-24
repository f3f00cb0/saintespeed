import { useCallback, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { onPeers, peerListKey, peers, samplePeer } from "../lib/peers";
import { CarMesh, pulseBrake, useCarLights } from "./CarMesh";

// Bulle de BD au dessus de chaque autre pilote : son nom, et son chrono quand il
// roule. C'est du DOM (drei Html), donc hors de la passe de dessin : elle reste
// nette et lisible. Elle ne tourne pas avec la voiture et s'efface au loin,
// ou elle ne serait plus qu'une tache sur la ville.
const BUBBLE_Y = 3.4;
const BUBBLE_FAR = 240;

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function RemoteCar({ id }: { id: string }) {
  const body = useRef<THREE.Group>(null);
  const label = useRef<THREE.Group>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const { headMat, tailMat } = useCarLights();
  const peer = peers.get(id);
  const color = peer?.color ?? 0x5ec8e0;
  const motion = useCallback(() => peers.get(id), [id]);

  useFrame(({ camera }, dt) => {
    const p = peers.get(id);
    if (!p || !body.current) return;
    samplePeer(p, performance.now());
    body.current.position.set(p.x, 0.35, -p.y);
    label.current?.position.set(p.x, BUBBLE_Y, -p.y);
    if (bubble.current) {
      const d = camera.position.distanceTo(body.current.position);
      bubble.current.style.opacity = String(1 - Math.min(1, Math.max(0, (d - BUBBLE_FAR * 0.7) / (BUBBLE_FAR * 0.3))));
    }
    if (time.current) time.current.textContent = p.running ? fmt(p.lapTime) : "";
    body.current.rotation.y = p.heading;
    body.current.rotation.x = -p.steer * Math.min(1, Math.abs(p.speed) / 30) * 0.12;
    pulseBrake(tailMat, p.brake > 0.2, dt);
  });

  return (
    <>
      <group ref={body}>
        <CarMesh color={color} headMat={headMat} tailMat={tailMat} motion={motion} />
      </group>
      <group ref={label}>
        <Html center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <div ref={bubble} className="peer-bubble" style={{ ["--peer" as string]: "#" + color.toString(16).padStart(6, "0") }}>
            <b>{peer?.name ?? "pilote"}</b>
            <span ref={time} />
          </div>
        </Html>
      </group>
    </>
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
