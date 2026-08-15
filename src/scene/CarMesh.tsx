import { useMemo } from "react";
import * as THREE from "three";
import { Headlights } from "./Headlights";

export function useCarLights() {
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
  return { headMat, tailMat };
}

export function pulseBrake(mat: THREE.MeshBasicMaterial, on: boolean, dt: number) {
  const want = on ? 6 : 1.1;
  const c = mat.color;
  c.r += (want - c.r) * Math.min(1, dt * 18);
  c.g = c.r * 0.06;
  c.b = c.r * 0.04;
}

export function CarMesh({
  color,
  headMat,
  tailMat,
  headlights = false,
}: {
  color: number;
  headMat: THREE.MeshBasicMaterial;
  tailMat: THREE.MeshBasicMaterial;
  headlights?: boolean;
}) {
  return (
    <>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[4.3, 0.75, 1.85]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position={[-0.35, 0.72, 0]}>
        <boxGeometry args={[2.0, 0.62, 1.6]} />
        <meshLambertMaterial color={0x24251c} />
      </mesh>
      <mesh position={[2.0, 0.2, 0]}>
        <boxGeometry args={[0.35, 0.4, 1.6]} />
        <meshLambertMaterial color={0x8a8578} />
      </mesh>
      {[0.58, -0.58].map((z) => (
        <mesh key={z} position={[2.16, 0.24, z]} material={headMat}>
          <boxGeometry args={[0.1, 0.26, 0.44]} />
        </mesh>
      ))}
      {[0.62, -0.62].map((z) => (
        <mesh key={"t" + z} position={[-2.18, 0.26, z]} material={tailMat}>
          <boxGeometry args={[0.1, 0.2, 0.42]} />
        </mesh>
      ))}
      {headlights && <Headlights />}
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
    </>
  );
}
