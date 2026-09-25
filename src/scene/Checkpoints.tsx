import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../state/store";
import type { Checkpoint } from "../lib/race";
import { groundY } from "../lib/elevation";

// Les portiques sont dessines comme le reste : deux poteaux rayes a la facon
// d'une barriere de chantier, une banderole a damier qui porte le nom du
// checkpoint lettre a l'encre, et pour le prochain a passer, un halo qui pulse
// et une colonne visible par dessus les toits. Tout est peint dans des canvas,
// une texture par portique (le nom change dans l'editeur).

const ACTIVE = "#ff5d3b";
const IDLE = "#8a9a8e";
const START = "#e0b15e";
const SELECTED = "#f4f0e4";
const INK = "#07080d";
const BONE = "#f2ede0";

const POST_H = 8.4;
const BANNER_H = 2.2;
const BANNER_Y = 7.1;

/** Banderole : bandes a damier en haut et en bas, le nom au milieu. */
function paintBanner(label: string, color: string): THREE.CanvasTexture {
  const w = 1024;
  const h = 200;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = BONE;
  g.fillRect(0, 0, w, h);
  // damier
  const sq = 24;
  for (const y0 of [0, h - sq * 2]) {
    for (let x = 0; x < w; x += sq) {
      for (let r = 0; r < 2; r++) {
        g.fillStyle = (x / sq + r) % 2 ? INK : BONE;
        g.fillRect(x, y0 + r * sq, sq, sq);
      }
    }
  }
  // bande de couleur derriere le nom
  g.fillStyle = color;
  g.fillRect(0, sq * 2, w, h - sq * 4);
  // le nom, en capitales italiques cernees d'encre
  const text = label.toUpperCase();
  let size = 92;
  g.font = `italic 900 ${size}px "Arial Black", "Helvetica Neue", Impact, sans-serif`;
  while (g.measureText(text).width > w * 0.9 && size > 30) {
    size -= 4;
    g.font = `italic 900 ${size}px "Arial Black", "Helvetica Neue", Impact, sans-serif`;
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 12;
  g.strokeStyle = INK;
  g.strokeText(text, w / 2 + 5, h / 2 + 5);
  g.strokeText(text, w / 2, h / 2);
  g.fillStyle = BONE;
  g.fillText(text, w / 2, h / 2);
  // cadre
  g.lineWidth = 10;
  g.strokeRect(5, 5, w - 10, h - 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Poteau : rayures en biais, couleur et encre. */
function paintStripes(color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = INK;
  for (let y = -64; y < 256 + 64; y += 48) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(64, y - 32);
    g.lineTo(64, y - 8);
    g.lineTo(0, y + 24);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  const banner = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const color = selected ? SELECTED : active ? ACTIVE : isStart ? START : IDLE;
  const label = isStart ? `départ · ${cp.label}` : cp.label;

  const tex = useMemo(
    () => ({ banner: paintBanner(label, color), post: paintStripes(color) }),
    [label, color],
  );
  useEffect(
    () => () => {
      tex.banner.dispose();
      tex.post.dispose();
    },
    [tex],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const on = active || selected;
    // la banderole du prochain checkpoint se dandine, les autres restent droites
    if (banner.current) {
      banner.current.position.y = BANNER_Y + (on ? Math.sin(t * 3) * 0.12 : 0);
      banner.current.rotation.z = on ? Math.sin(t * 1.7) * 0.015 : 0;
    }
    if (halo.current) {
      const m = halo.current.material as THREE.MeshBasicMaterial;
      m.opacity = on ? 0.1 + 0.08 * Math.sin(t * 4) : 0.03;
    }
  });

  // le portique s'ouvre en travers de la route : son +X local suit la normale
  const nx = -cp.ty;
  const ny = cp.tx;
  const rot = Math.atan2(ny, nx);
  const half = Math.max(cp.width / 2, 5);
  // le portique se pose sur la chaussee qu'il enjambe, relief compris
  const z = useMemo(() => groundY(cp.x, cp.y, cp.tx, cp.ty), [cp.x, cp.y, cp.tx, cp.ty]);

  return (
    <group position={[cp.x, z, -cp.y]} rotation={[0, rot, 0]}>
      {[-half, half].map((off) => (
        <group key={off} position={[off, 0, 0]}>
          <mesh position={[0, POST_H / 2, 0]}>
            <cylinderGeometry args={[0.36, 0.42, POST_H, 10]} />
            <meshBasicMaterial map={tex.post} />
          </mesh>
          {/* socle et boule de fronton */}
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[1.3, 0.6, 1.3]} />
            <meshBasicMaterial color={INK} />
          </mesh>
          <mesh position={[0, POST_H + 0.35, 0]}>
            <sphereGeometry args={[0.55, 12, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </group>
      ))}
      <group ref={banner} position={[0, BANNER_Y, 0]}>
        {/* la banderole, lisible des deux cotes */}
        {[0.06, -0.06].map((z, i) => (
          <mesh key={z} position={[0, 0, z]} rotation={[0, i ? Math.PI : 0, 0]}>
            <planeGeometry args={[half * 2 - 0.4, BANNER_H]} />
            <meshBasicMaterial map={tex.banner} />
          </mesh>
        ))}
      </group>
      {/* voile de passage, a peine teinte */}
      <mesh ref={halo} position={[0, (BANNER_Y - BANNER_H / 2) / 2, 0]}>
        <planeGeometry args={[half * 2, BANNER_Y - BANNER_H / 2]} />
        <meshBasicMaterial color={color} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* colonne repere, visible par dessus les toits */}
      {(active || selected) && (
        <mesh position={[0, 70, 0]}>
          <boxGeometry args={[0.5, 110, 0.5]} />
          <meshBasicMaterial color={ACTIVE} transparent opacity={0.08} depthWrite={false} />
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
