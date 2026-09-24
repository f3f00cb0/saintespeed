import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Headlights } from "./Headlights";

// La voiture est l'objet que la camera montre en permanence : c'est la que la
// pauvrete de la 3D se voyait le plus (quatre boites empilees). Elle reste
// entierement procedurale, sans modele embarque : la caisse et le vitrage sont
// des profils lateraux extrudes sur la largeur, avec un chanfrein qui arrondit
// les aretes, et les passages de roue sont creuses dans le profil.
//
// Repere : +x vers l'avant, y vers le haut, z en travers. Le groupe parent est
// pose a 0,35 m au dessus du sol de reference.

const WHEEL_R = 0.34;
const WHEEL_Y = 0.02;
const AXLE = 1.35; // demi-empattement
const TRACK = 0.8; // demi-voie
const ARCH_R = 0.42;
const MAX_WHEEL_STEER = 0.5; // rad, braquage visuel des roues avant
// faces avant et arriere, chanfrein compris : les feux s'y posent en saillie,
// sinon le chanfrein les avale
const FRONT = 2.29;
const REAR = -2.31;

// --- reflets : une carte d'environnement de nuit, generee une fois ---------

// Une caisse en Lambert ne renvoie rien, et c'est ce qui la rendait plate. On
// peint une petite scene de nuit (ciel, halo urbain chaud a l'horizon, bandes
// de lampadaires) et on la prefiltre en PMREM : la carrosserie et le vitrage
// y prennent des reflets sans qu'aucune lumiere dynamique ne soit ajoutee.
// La carte ne sert qu'aux materiaux de la voiture, pas a la scene entiere.
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

function nightEnvironment(gl: THREE.WebGLRenderer): THREE.Texture {
  const hit = envCache.get(gl);
  if (hit) return hit;

  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, "#070b16");
  grad.addColorStop(0.42, "#1b2440");
  grad.addColorStop(0.5, "#6a4a2c"); // halo urbain
  grad.addColorStop(0.56, "#1a1712");
  grad.addColorStop(1.0, "#050505");
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 128);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 12),
      new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide }),
    ),
  );
  // bandes de lumiere au dessus de la voiture : ce sont elles qui glissent
  // sur le capot et le toit quand on roule
  const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.1, 2) });
  const cold = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2, 3) });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 0.8), i % 2 ? cold : strip);
    m.position.set(Math.cos(a) * 20, 18 + (i % 3) * 4, Math.sin(a) * 20);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }

  const pmrem = new THREE.PMREMGenerator(gl);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  sky.dispose();
  envCache.set(gl, env);
  return env;
}

// --- geometrie ---------------------------------------------------------------

function extrude(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

function bodyShape(): THREE.Shape {
  const s = new THREE.Shape();
  const y0 = WHEEL_Y;
  s.moveTo(-2.2, y0 + 0.02);
  s.lineTo(-AXLE - ARCH_R, y0);
  s.absarc(-AXLE, y0, ARCH_R, Math.PI, 0, true);
  s.lineTo(AXLE - ARCH_R, y0);
  s.absarc(AXLE, y0, ARCH_R, Math.PI, 0, true);
  s.lineTo(2.12, y0 + 0.02);
  s.lineTo(2.24, y0 + 0.18); // bouclier
  s.lineTo(2.2, y0 + 0.4);
  s.lineTo(1.0, y0 + 0.58); // capot
  s.lineTo(-1.85, y0 + 0.64); // ceinture de caisse
  s.lineTo(-2.2, y0 + 0.5); // hayon
  s.lineTo(-2.24, y0 + 0.16);
  s.closePath();
  return s;
}

function glassShape(): THREE.Shape {
  const y0 = WHEEL_Y;
  const s = new THREE.Shape();
  s.moveTo(1.0, y0 + 0.57);
  s.lineTo(0.02, y0 + 1.03); // pare-brise incline
  s.lineTo(-1.32, y0 + 1.03);
  s.lineTo(-1.95, y0 + 0.62); // lunette arriere
  s.closePath();
  return s;
}

function roofShape(): THREE.Shape {
  const y0 = WHEEL_Y;
  const s = new THREE.Shape();
  s.moveTo(0.06, y0 + 1.02);
  s.lineTo(-1.34, y0 + 1.02);
  s.lineTo(-1.3, y0 + 1.08);
  s.lineTo(0.0, y0 + 1.08);
  s.closePath();
  return s;
}

type CarGeo = {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  spoke: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
};

let sharedGeo: CarGeo | null = null;

// les geometries sont partagees par toutes les voitures du salon
function carGeometry(): CarGeo {
  if (sharedGeo) return sharedGeo;
  const tire = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 20);
  tire.rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.27, 12);
  rim.rotateX(Math.PI / 2);
  sharedGeo = {
    body: extrude(bodyShape(), 1.66, 0.08),
    glass: extrude(glassShape(), 1.4, 0.05),
    roof: extrude(roofShape(), 1.42, 0.04),
    tire,
    rim,
    spoke: new THREE.BoxGeometry(0.4, 0.06, 0.28),
    shadow: new THREE.PlaneGeometry(5.4, 2.6).rotateX(-Math.PI / 2),
  };
  return sharedGeo;
}

let shadowTex: THREE.Texture | null = null;

// ombre de contact : sans elle la voiture flotte au dessus de la chaussee
function contactShadow(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 32, 4, 64, 32, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.75)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.setTransform(1, 0, 0, 0.5, 0, 16);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// --- feux ---------------------------------------------------------------------

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

// --- maillage -------------------------------------------------------------------

export type CarMotion = { speed: number; steer: number };

const WHEELS: [number, number, boolean][] = [
  [AXLE, TRACK, true],
  [AXLE, -TRACK, true],
  [-AXLE, TRACK, false],
  [-AXLE, -TRACK, false],
];

export function CarMesh({
  color,
  headMat,
  tailMat,
  headlights = false,
  motion,
}: {
  color: number;
  headMat: THREE.MeshBasicMaterial;
  tailMat: THREE.MeshBasicMaterial;
  headlights?: boolean;
  /** Vitesse (m/s) et braquage (-1..1) : font tourner et braquer les roues. */
  motion?: () => CarMotion | undefined;
}) {
  const gl = useThree((s) => s.gl);
  const geo = useMemo(carGeometry, []);
  const mats = useMemo(() => {
    const env = nightEnvironment(gl);
    return {
      // vernis : assez lisse pour que les bandes de lumiere glissent dessus
      paint: new THREE.MeshStandardMaterial({
        color,
        metalness: 0.5,
        roughness: 0.24,
        envMap: env,
        envMapIntensity: 2.2,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x0b0e15,
        metalness: 0.9,
        roughness: 0.08,
        envMap: env,
        envMapIntensity: 1.2,
      }),
      trim: new THREE.MeshLambertMaterial({ color: 0x121212 }),
      tire: new THREE.MeshLambertMaterial({ color: 0x0d0d0e }),
      rim: new THREE.MeshStandardMaterial({
        color: 0x9a9ca2,
        metalness: 0.8,
        roughness: 0.35,
        envMap: env,
      }),
      shadow: new THREE.MeshBasicMaterial({
        map: contactShadow(),
        transparent: true,
        depthWrite: false,
        color: 0x000000,
        fog: false,
      }),
    };
  }, [gl, color]);

  const steerRefs = useRef<(THREE.Group | null)[]>([]);
  const spinRefs = useRef<(THREE.Group | null)[]>([]);
  const spin = useRef(0);

  useFrame((_, dt) => {
    const m = motion?.();
    if (!m) return;
    spin.current -= (m.speed * Math.min(dt, 1 / 20)) / WHEEL_R;
    const yaw = m.steer * MAX_WHEEL_STEER;
    for (let i = 0; i < 4; i++) {
      const s = steerRefs.current[i];
      if (s && WHEELS[i][2]) s.rotation.y = yaw;
      const r = spinRefs.current[i];
      if (r) r.rotation.z = spin.current;
    }
  });

  return (
    <>
      <mesh geometry={geo.shadow} material={mats.shadow} position={[0, 0.07, 0]} renderOrder={1} />
      <mesh geometry={geo.body} material={mats.paint} />
      <mesh geometry={geo.glass} material={mats.glass} />
      <mesh geometry={geo.roof} material={mats.paint} />
      {/* calandre et bas de caisse */}
      <mesh position={[FRONT, WHEEL_Y + 0.14, 0]} material={mats.trim}>
        <boxGeometry args={[0.06, 0.14, 1.0]} />
      </mesh>
      <mesh position={[0, WHEEL_Y + 0.03, 0]} material={mats.trim}>
        <boxGeometry args={[1.7, 0.1, 1.78]} />
      </mesh>
      {/* phares effiles */}
      {[0.6, -0.6].map((z) => (
        <mesh key={z} position={[FRONT, WHEEL_Y + 0.32, z]} material={headMat}>
          <boxGeometry args={[0.08, 0.1, 0.44]} />
        </mesh>
      ))}
      {/* feux arriere : un bandeau sur toute la largeur, plus les deux blocs */}
      <mesh position={[REAR, WHEEL_Y + 0.42, 0]} material={tailMat}>
        <boxGeometry args={[0.06, 0.05, 1.5]} />
      </mesh>
      {[0.66, -0.66].map((z) => (
        <mesh key={"t" + z} position={[REAR, WHEEL_Y + 0.4, z]} material={tailMat}>
          <boxGeometry args={[0.07, 0.13, 0.34]} />
        </mesh>
      ))}
      {headlights && <Headlights />}
      {WHEELS.map(([x, z], i) => (
        <group key={i} position={[x, WHEEL_Y, z]} ref={(g) => (steerRefs.current[i] = g)}>
          <group ref={(g) => (spinRefs.current[i] = g)}>
            <mesh geometry={geo.tire} material={mats.tire} />
            <mesh geometry={geo.rim} material={mats.rim} />
            <mesh geometry={geo.spoke} material={mats.rim} />
            <mesh geometry={geo.spoke} material={mats.rim} rotation={[0, 0, Math.PI / 2]} />
          </group>
        </group>
      ))}
    </>
  );
}
