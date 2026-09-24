import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Le ciel de la nuit dessinee : un degrade, la ligne de crete reelle qui ferme
// la cuvette stephanoise, des etoiles et une lune de BD.
//
// Tout vit dans un groupe qui suit la camera : le ciel est a l'infini, il ne
// doit pas glisser quand on traverse la ville. Rien n'ecrit la profondeur, et
// tout passe avant le reste de la scene (renderOrder negatif) : la ville se
// dessine par dessus, sans test de profondeur a regler.

// Le brouillard prend exactement cette couleur : la bande d'horizon du degrade
// doit lui etre identique, sinon la ligne d'horizon se voit.
export const HORIZON = 0x0e1526;

const SKY_R = 3200;
const RIDGE_R = 2500;
const STAR_R = 3000;
const MOON_R = 2800;

// --- degrade ---------------------------------------------------------------------

function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 256;
  const g = c.getContext("2d")!;
  // Attention au sens : la texture est retournee (flipY), donc le haut du
  // canvas correspond au zenith et le milieu exactement a l'horizon.
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#05070e"); // zenith
  grad.addColorStop(0.32, "#080d18");
  grad.addColorStop(0.44, "#111a2e");
  // halo urbain, froid et non brun, serre sur l'horizon : c'est sur lui que la
  // silhouette des collines se decoupe
  grad.addColorStop(0.485, "#1f2a44");
  grad.addColorStop(0.5, "#0e1526"); // horizon : exactement la couleur du fog
  grad.addColorStop(0.58, "#0b1020");
  grad.addColorStop(1.0, "#05070c"); // sous l'horizon
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- ligne de crete ---------------------------------------------------------------

// Generee par `npm run skyline` depuis le relief reel (scripts/skyline.mjs) :
// angle d'elevation de la crete, en degres, tous les `step` degres d'azimut
// (0 = nord, sens horaire), en deux bandes, proche et lointaine.
type Skyline = { step: number; near: number[]; far: number[] };

// Les vrais angles sont faibles (3,5 degres au plus, sur le Pilat) : a peine
// quarante pixels a l'ecran. On les grossit un peu, comme un dessinateur
// accentue un relief pour qu'il se lise ; l'ordre des sommets reste le vrai.
const RIDGE_EXAGGERATION = 1.6;
const RIDGE_FOOT = -3; // degres : le pied de la bande passe sous l'horizon
const INK_DEG = 0.22; // epaisseur du trait de crete

function dirOf(azDeg: number): [number, number] {
  const a = (azDeg * Math.PI) / 180;
  // nord = -z, est = +x
  return [Math.sin(a), -Math.cos(a)];
}

const tanDeg = (d: number) => Math.tan((d * Math.PI) / 180);

/** Bande verticale entre deux profils d'elevation (en degres), fermee en anneau. */
function ringBand(step: number, bottom: (i: number) => number, top: (i: number) => number) {
  const n = Math.round(360 / step);
  const pos = new Float32Array(n * 6 * 3);
  let o = 0;
  const put = (az: number, deg: number) => {
    const [x, z] = dirOf(az);
    pos[o++] = x * RIDGE_R;
    pos[o++] = tanDeg(deg) * RIDGE_R;
    pos[o++] = z * RIDGE_R;
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = i * step;
    const a1 = (i + 1) * step;
    put(a0, bottom(i));
    put(a1, bottom(j));
    put(a1, top(j));
    put(a0, bottom(i));
    put(a1, top(j));
    put(a0, top(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

function Ridges({ data }: { data: Skyline }) {
  const layers = useMemo(() => {
    const far = (i: number) => Math.max(data.far[i], 0.15) * RIDGE_EXAGGERATION;
    const near = (i: number) => Math.max(data.near[i], 0.05) * RIDGE_EXAGGERATION;
    return [
      // les massifs lointains, plus clairs que le ciel : la perspective aerienne
      { geo: ringBand(data.step, () => RIDGE_FOOT, far), color: 0x141c33 },
      { geo: ringBand(data.step, (i) => far(i) - INK_DEG, far), color: 0x07080d },
      // les collines qui ferment la cuvette, en silhouette presque noire : un
      // bleu proche de l'horizon s'y confondait avec le ciel
      { geo: ringBand(data.step, () => RIDGE_FOOT, near), color: 0x05070d },
      { geo: ringBand(data.step, (i) => near(i) - INK_DEG, near), color: 0x07080d },
    ];
  }, [data]);
  // les lumieres des villages et des quartiers perches sur les pentes :
  // semees sous la crete proche, jamais au dessus
  const lights = useMemo(() => {
    const n = 360;
    const pos: number[] = [];
    const col: number[] = [];
    const count = data.near.length;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(seeded(k * 5 + 101) * count);
      const top = Math.max(data.near[i], 0.05) * RIDGE_EXAGGERATION;
      if (top < 0.8) continue; // pas de pente visible dans cette direction
      const el = 0.15 + seeded(k * 5 + 102) * (top - 0.6);
      const [x, z] = dirOf(i * data.step + seeded(k * 5 + 103) * data.step);
      pos.push(x * (RIDGE_R - 5), tanDeg(el) * (RIDGE_R - 5), z * (RIDGE_R - 5));
      const warm = seeded(k * 5 + 104) < 0.8;
      const b = 0.6 + seeded(k * 5 + 105) * 0.5;
      col.push(b, warm ? b * 0.72 : b * 0.9, warm ? b * 0.42 : b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }, [data]);
  const lightMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 2,
        sizeAttenuation: false,
        vertexColors: true,
        fog: false,
        depthWrite: false,
      }),
    [],
  );
  return (
    <>
      {layers.map((l, i) => (
        <mesh key={i} geometry={l.geo} renderOrder={-9 + i} frustumCulled={false}>
          <meshBasicMaterial color={l.color} fog={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <points geometry={lights} material={lightMat} renderOrder={-4} frustumCulled={false} />
    </>
  );
}

function useSkyline(): Skyline | null {
  const [data, setData] = useState<Skyline | null>(null);
  useEffect(() => {
    let dead = false;
    // sans le fichier, le ciel reste un degrade : rien de bloquant
    fetch("/sainte-skyline.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!dead && d) setData(d);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);
  return data;
}

// --- etoiles ---------------------------------------------------------------------

function seeded(i: number) {
  let x = (i * 374761393) ^ 0x68e31da4;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function Stars() {
  const { geo, mat } = useMemo(() => {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const az = seeded(i * 3) * 360;
      // plus denses vers le zenith : le halo de la ville eteint l'horizon
      const el = 6 + Math.pow(seeded(i * 3 + 1), 0.7) * 80;
      const [x, z] = dirOf(az);
      const c = Math.cos((el * Math.PI) / 180);
      pos[i * 3] = x * c * STAR_R;
      pos[i * 3 + 1] = Math.sin((el * Math.PI) / 180) * STAR_R;
      pos[i * 3 + 2] = z * c * STAR_R;
      const b = 0.35 + seeded(i * 3 + 2) * 0.65;
      col[i * 3] = b * 0.9;
      col[i * 3 + 1] = b * 0.94;
      col[i * 3 + 2] = b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: false,
      vertexColors: true,
      fog: false,
      depthWrite: false,
    });
    return { geo, mat };
  }, []);
  return <points geometry={geo} material={mat} renderOrder={-10} frustumCulled={false} />;
}

// --- lune ------------------------------------------------------------------------

// Une lune de BD : disque creme cerne d'encre, quelques mers, et un halo en
// anneaux que les aplats du dessin quantifient. Volontairement grande (4 degres
// contre 0,5 en vrai) : c'est un signe, pas une mesure. Posee au dessus du
// Pilat, la ou la crete est la plus haute.
const MOON_AZ = 150;
const MOON_EL = 13;
const MOON_SIZE = 4.2; // degres

function moonTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const m = s / 2;
  const halo = g.createRadialGradient(m, m, s * 0.18, m, m, s * 0.5);
  halo.addColorStop(0, "rgba(200,210,240,0.35)");
  halo.addColorStop(1, "rgba(200,210,240,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, s, s);
  const r = s * 0.2;
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.fillStyle = "#f4ecd2";
  g.fill();
  g.fillStyle = "rgba(150,140,120,0.45)";
  for (const [dx, dy, rr] of [
    [-0.3, -0.2, 0.28],
    [0.25, 0.1, 0.2],
    [-0.05, 0.4, 0.16],
    [0.35, -0.35, 0.1],
  ]) {
    g.beginPath();
    g.arc(m + dx * r, m + dy * r, rr * r, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = s * 0.018;
  g.strokeStyle = "#07080d";
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Moon() {
  const { mat, pos, size } = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      map: moonTexture(),
      transparent: true,
      fog: false,
      depthWrite: false,
      // un peu au dessus de 1 : le disque passe le seuil du bloom
      color: new THREE.Color(1.5, 1.5, 1.5),
    });
    const [x, z] = dirOf(MOON_AZ);
    const c = Math.cos((MOON_EL * Math.PI) / 180);
    const pos = new THREE.Vector3(x * c, Math.sin((MOON_EL * Math.PI) / 180), z * c).multiplyScalar(MOON_R);
    // la texture fait 2,5 fois le disque : le halo deborde
    const size = tanDeg(MOON_SIZE) * MOON_R * 2.5;
    return { mat, pos, size };
  }, []);
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => {
    ref.current?.lookAt(0, 0, 0);
  }, []);
  return (
    <mesh ref={ref} position={pos} material={mat} renderOrder={-10} frustumCulled={false}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}

// --- assemblage --------------------------------------------------------------------

export function Sky() {
  const texture = useMemo(skyTexture, []);
  const skyline = useSkyline();
  const group = useRef<THREE.Group>(null);

  // le ciel suit la camera : il est a l'infini
  useFrame(({ camera }) => {
    group.current?.position.copy(camera.position);
  });

  return (
    <group ref={group}>
      <mesh renderOrder={-11} frustumCulled={false}>
        {/* assez de facettes pour que les frontieres de bande restent rondes */}
        <sphereGeometry args={[SKY_R, 96, 64]} />
        <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>
      <Stars />
      <Moon />
      {skyline && <Ridges data={skyline} />}
    </group>
  );
}
