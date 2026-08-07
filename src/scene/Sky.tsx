import { useMemo } from "react";
import * as THREE from "three";

// Ciel de nuit en degrade, peint dans un canvas. Pas de shader : une sphere
// vue de l'interieur suffit, et ca donne au fond une profondeur que la couleur
// plate ne donnait pas. La lueur chaude sur l'horizon fait la pollution
// lumineuse de la ville.

// Le brouillard prend exactement cette couleur : la bande d'horizon du degrade
// doit lui etre identique, sinon la ligne d'horizon se voit.
export const HORIZON = 0x0e1526;

export function Sky() {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 256;
    const g = c.getContext("2d")!;
    // Attention au sens : la texture est retournee (flipY), donc le haut du
    // canvas correspond au zenith et le milieu exactement a l'horizon.
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, "#05070e"); // zenith
    grad.addColorStop(0.32, "#080d18");
    grad.addColorStop(0.45, "#16203a"); // halo urbain, froid et non brun
    grad.addColorStop(0.5, "#0e1526"); // horizon : exactement la couleur du fog
    grad.addColorStop(0.58, "#0b1020");
    grad.addColorStop(1.0, "#05070c"); // sous l'horizon
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  return (
    <mesh renderOrder={-1}>
      <sphereGeometry args={[3200, 24, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}
