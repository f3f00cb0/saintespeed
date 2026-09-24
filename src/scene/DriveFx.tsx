import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { car, input } from "../lib/car";

// Retours de conduite : traces de pneus et fumee. La physique est arcade et ne
// modelise pas le glissement ; on le deduit donc de ce que fait le pilote, ce
// qui est aussi ce qu'il attend de voir :
//   - frein a main lance : la voiture part en glisse ;
//   - gros freinage a vitesse : les pneus bloquent ;
//   - braquage fort a haute vitesse : les pneus crient ;
//   - plein gaz presque a l'arret : le demarrage en trombe patine.
// Tout vit dans deux maillages de taille fixe (un anneau de segments et un pool
// de particules), donc zero allocation par frame.

const AXLE = 1.35; // meme demi-empattement que CarMesh
const TRACK = 0.8;
const MARK_W = 0.24; // demi-largeur de la trace
const MARK_Y = 0.44; // au dessus de toutes les couches de chaussee
const MARK_STEP = 0.5; // un segment tous les 50 cm
const MARK_SEGMENTS = 900; // par roue ; l'anneau ecrase les plus vieilles
const SMOKE_COUNT = 160;
const SMOKE_LIFE = 1.8;

/** Intensite de glisse, 0..1, deduite de la vitesse et des commandes. */
export function slipOf(): number {
  const v = Math.abs(car.speed);
  let s = 0;
  if (input.handbrake && v > 6) s = Math.max(s, Math.min(1, v / 18));
  if (input.brake > 0.5 && car.speed > 12) s = Math.max(s, 0.7 * input.brake);
  if (Math.abs(car.steer) > 0.7 && v > 22) s = Math.max(s, (Math.abs(car.steer) - 0.7) * 2);
  if (input.throttle > 0.9 && car.speed >= 0 && car.speed < 7) s = Math.max(s, 0.8 * (1 - car.speed / 7));
  return car.offroad ? s * 0.4 : s;
}

// --- traces -------------------------------------------------------------------

type Track = { x: number; y: number; alive: boolean };

function SkidMarks({ slip }: { slip: React.MutableRefObject<number> }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = MARK_SEGMENTS * 2 * 6;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const last = useRef<Track[]>([
    { x: 0, y: 0, alive: false },
    { x: 0, y: 0, alive: false },
  ]);
  const head = useRef(0);

  useFrame(() => {
    const s = slip.current;
    const hx = Math.cos(car.heading);
    const hy = Math.sin(car.heading);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    let dirty = false;

    for (let w = 0; w < 2; w++) {
      const side = w === 0 ? 1 : -1;
      // roue arriere, en metres du plan (y = nord)
      const x = car.x - hx * AXLE - hy * TRACK * side;
      const y = car.y - hy * AXLE + hx * TRACK * side;
      const l = last.current[w];
      if (s < 0.15) {
        l.alive = false;
        continue;
      }
      if (!l.alive) {
        l.x = x;
        l.y = y;
        l.alive = true;
        continue;
      }
      const dx = x - l.x;
      const dy = y - l.y;
      const d = Math.hypot(dx, dy);
      if (d < MARK_STEP) continue;
      if (d > 6) {
        // teleportation (replacement au checkpoint) : on ne relie pas
        l.x = x;
        l.y = y;
        continue;
      }
      const nx = (-dy / d) * MARK_W;
      const ny = (dx / d) * MARK_W;
      const i = (head.current % (MARK_SEGMENTS * 2)) * 6;
      head.current++;
      const quad = [
        [l.x + nx, l.y + ny],
        [x + nx, y + ny],
        [x - nx, y - ny],
        [l.x + nx, l.y + ny],
        [x - nx, y - ny],
        [l.x - nx, l.y - ny],
      ];
      const alpha = 0.25 + 0.5 * s;
      for (let k = 0; k < 6; k++) {
        pos.setXYZ(i + k, quad[k][0], MARK_Y, -quad[k][1]);
        col.setXYZW(i + k, 0.02, 0.02, 0.025, alpha);
      }
      l.x = x;
      l.y = y;
      dirty = true;
    }
    if (dirty) {
      pos.needsUpdate = true;
      col.needsUpdate = true;
      geo.computeBoundingSphere();
    }
  });

  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={2} />;
}

// --- fumee --------------------------------------------------------------------

const smokeVertex = /* glsl */ `
attribute float aLife;
varying vec2 vUv;
varying float vLife;
void main() {
  vUv = uv;
  vLife = aLife;
  // billboard : le centre vient de la matrice d'instance, le quad s'ouvre dans
  // le plan de l'ecran
  vec4 center = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz);
  center.xy += position.xy * size;
  gl_Position = projectionMatrix * center;
}
`;

const smokeFragment = /* glsl */ `
uniform vec3 color;
varying vec2 vUv;
varying float vLife;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, r) * vLife * 0.22;
  if (a < 0.003) discard;
  gl_FragColor = vec4(color, a);
}
`;

type Puff = { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number };

function Smoke({ slip }: { slip: React.MutableRefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("aLife", new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_COUNT), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x9a9ca6) } },
      vertexShader: smokeVertex,
      fragmentShader: smokeFragment,
      transparent: true,
      depthWrite: false,
    });
    return { geo, mat };
  }, []);
  const puffs = useMemo<Puff[]>(
    () =>
      Array.from({ length: SMOKE_COUNT }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: SMOKE_LIFE })),
    [],
  );
  const next = useRef(0);
  const debt = useRef(0);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = slip.current;
    const hx = Math.cos(car.heading);
    const hy = Math.sin(car.heading);

    // emission proportionnelle a la glisse, jusqu'a 40 bouffees par seconde
    debt.current += s > 0.25 ? s * 40 * dt : 0;
    while (debt.current >= 1) {
      debt.current -= 1;
      const side = next.current % 2 ? 1 : -1;
      const p = puffs[next.current % SMOKE_COUNT];
      next.current++;
      const x = car.x - hx * (AXLE + 0.2) - hy * TRACK * side;
      const y = car.y - hy * (AXLE + 0.2) + hx * TRACK * side;
      p.x = x;
      p.z = -y;
      p.y = 0.6;
      // la fumee reste en arriere : elle herite peu de la vitesse de la voiture
      const drift = car.speed * 0.15;
      p.vx = hx * drift + (Math.random() - 0.5) * 1.2;
      p.vz = -(hy * drift) + (Math.random() - 0.5) * 1.2;
      p.vy = 0.8 + Math.random() * 0.6;
      p.age = 0;
    }

    const life = geo.getAttribute("aLife") as THREE.InstancedBufferAttribute;
    const im = mesh.current;
    if (!im) return;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const p = puffs[i];
      if (p.age < SMOKE_LIFE) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= 1 - 1.5 * dt;
        p.vz *= 1 - 1.5 * dt;
      }
      const t = Math.min(1, p.age / SMOKE_LIFE);
      const size = 1 + t * 4.5;
      m.makeScale(size, size, size).setPosition(p.x, p.y, p.z);
      im.setMatrixAt(i, m);
      life.setX(i, t < 1 ? Math.min(1, t * 8) * (1 - t) : 0);
    }
    im.instanceMatrix.needsUpdate = true;
    life.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geo, mat, SMOKE_COUNT]} frustumCulled={false} renderOrder={3} />
  );
}

export function DriveFx() {
  const slip = useRef(0);
  // un seul calcul de glisse par frame, partage par les traces et la fumee ;
  // priorite -1 : avant leurs propres useFrame
  useFrame(() => {
    slip.current = slipOf();
  }, -1);
  return (
    <>
      <SkidMarks slip={slip} />
      <Smoke slip={slip} />
    </>
  );
}
