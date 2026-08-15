import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../state/store";
import type { Checkpoint } from "../lib/race";

const ACTIVE = 0xff5d3b;
const IDLE = 0x4a5450;
const START = 0xe0b15e;

function Gate({
  cp,
  active,
  isStart,
  selected,
}: {
  cp: Checkpoint;
  active: boolean;
  isStart: boolean;
  selected: boolean;
}) {
  const beam = useRef<THREE.Mesh>(null);
  const color = selected ? 0xf4f0e4 : active ? ACTIVE : isStart ? START : IDLE;

  useFrame(({ clock }) => {
    if (!beam.current) return;
    const m = beam.current.material as THREE.MeshBasicMaterial;
    m.opacity = selected || active ? 0.12 + 0.07 * Math.sin(clock.elapsedTime * 4) : 0.04;
  });

  // le portique s'ouvre en travers de la route : son +X local suit la normale
  const nx = -cp.ty;
  const ny = cp.tx;
  const rot = Math.atan2(ny, nx);
  const half = Math.max(cp.width / 2, 5);

  return (
    <group position={[cp.x, 0, -cp.y]} rotation={[0, rot, 0]}>
      {[-half, half].map((off) => (
        <mesh key={off} position={[off, 4, 0]}>
          <boxGeometry args={[0.7, 8, 0.7]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
      {/* linteau */}
      <mesh position={[0, 7.6, 0]}>
        <boxGeometry args={[half * 2, 0.8, 0.6]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {/* rideau, visible de loin */}
      <mesh ref={beam} position={[0, 4, 0]}>
        <planeGeometry args={[half * 2, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* colonne repere, visible par dessus les immeubles imaginaires */}
      {(active || selected) && (
        <mesh position={[0, 70, 0]}>
          <boxGeometry args={[0.4, 110, 0.4]} />
          <meshBasicMaterial color={ACTIVE} transparent opacity={0.055} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

export function Checkpoints() {
  const checkpoints = useStore((s) => s.checkpoints);
  const nextCp = useStore((s) => s.nextCp);
  const mode = useStore((s) => s.mode);
  const selectedCp = useStore((s) => s.selectedCp);
  const editing = mode === "edit";

  return (
    <group>
      {checkpoints.map((cp, i) => (
        <Gate
          key={cp.id}
          cp={cp}
          active={!editing && i === nextCp}
          isStart={i === 0}
          selected={editing && i === selectedCp}
        />
      ))}
    </group>
  );
}
