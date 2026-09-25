import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TILE } from "../lib/sidewalks";
import type { WorkerIn, WorkerOut } from "../lib/sidewalkWorker";
import type { Way } from "../lib/osm";
import { car } from "../lib/car";
import { editView } from "../lib/editView";
import { useStore } from "../state/store";
import { drapeGeometry } from "../lib/drape";

// Trottoirs, bordures et caniveaux. La geometrie est calculee dans
// src/lib/sidewalks.ts, qui est pur et se rejoue dans Node (`npm run voirie`).
//
// Comme les batiments, les tuiles sont construites a la demande autour du
// joueur et liberees derriere lui : une tuile de 200 m coute quelques dizaines
// de millisecondes d'operations booleennes, la ville entiere en couterait plus
// d'une minute. Elles sont calculees dans un Web Worker
// (src/lib/sidewalkWorker.ts), les plus proches d'abord, au plus INFLIGHT
// demandes en vol : le fil de rendu ne fait que monter les tableaux recus.
//
// Deux maillages par tuile : la dalle, texturee de dalles de pierre en metres du
// plan, et tout le reste (pierre de bordure, faces de bordure, caniveau,
// arrondis de chaussee aux carrefours) en couleurs de sommet.

const LOAD_R = 520;
const DROP_R = 760;
const INFLIGHT = 2;
const TICK = 1 / 5;

// Dalles de 60 x 40 cm posees en quinconce, joints sombres, une teinte par
// dalle : c'est ce qui fait lire la surface comme un trottoir et non comme une
// deuxieme chaussee. La tuile de texture couvre 2,4 m ; les coordonnees de
// texture sont en metres du plan, donc les joints suivent le monde, pas la rue.
const TEX_M = 2.4;

function pavingTexture(): THREE.CanvasTexture {
  const px = 256;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  const cols = 4; // 0,6 m
  const rows = 6; // 0,4 m
  const sw = px / cols;
  const sh = px / rows;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  g.fillStyle = "#6e6a60"; // joints
  g.fillRect(0, 0, px, px);
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? sw / 2 : 0;
    for (let k = -1; k < cols; k++) {
      const v = 176 + Math.floor(rnd() * 26);
      g.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
      g.fillRect(k * sw + shift + 1.5, r * sh + 1.5, sw - 3, sh - 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

type Built = { paving: THREE.BufferGeometry; trim: THREE.BufferGeometry };
type TileData = Extract<WorkerOut, { type: "tile" }>;

function toGeometry(t: TileData): Built {
  const paving = new THREE.BufferGeometry();
  paving.setAttribute("position", new THREE.BufferAttribute(t.paving, 3));
  const uv = new Float32Array(t.pavingUv.length);
  for (let i = 0; i < uv.length; i++) uv[i] = t.pavingUv[i] / TEX_M;
  paving.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const trim = new THREE.BufferGeometry();
  trim.setAttribute("position", new THREE.BufferAttribute(t.trim, 3));
  trim.setAttribute("color", new THREE.BufferAttribute(t.trimColor, 3));
  // relief : le worker dessine a plat, on pose ici sur le sol de la ville. Les
  // bordures sont des faces verticales : leurs deux aretes ont la meme emprise
  // au sol, donc le meme decalage, et restent verticales.
  return { paving: drapeGeometry(paving), trim: drapeGeometry(trim) };
}

// Le worker refait son graphe depuis le meme reseau : meme entree, meme
// projection, donc les memes metres que le jeu. Il n'a besoin que des ways.
export function Sidewalks({
  ways,
  buildings,
  sides,
}: {
  ways: Way[];
  buildings: { ring: { x: number; y: number }[] }[];
  /** Cote releve dans OSM, quand il l'est. Prime sur la regle par classe. */
  sides: Map<number, number> | null;
}) {
  // Le worker vit avec le composant ; chaque nouvel index (voirie arrivee,
  // batiments recharges) porte une generation, et les tuiles d'une generation
  // perimee sont jetees a leur arrivee.
  const worker = useRef<Worker | null>(null);
  const gen = useRef(0);
  const ready = useRef(false);
  const inflight = useRef(new Set<string>());

  const tex = useMemo(pavingTexture, []);
  const mats = useMemo(
    () => ({
      // la dalle est un peu plus claire que la chaussee : c'est la seule chose
      // qui separe les deux de loin, une fois la bordure trop fine pour se lire
      paving: new THREE.MeshBasicMaterial({ map: tex, color: 0x75766c }),
      trim: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    }),
    [tex],
  );

  const resident = useRef(new Map<string, Built>());
  const acc = useRef(0);
  const [, bump] = useState(0);

  useEffect(() => {
    const w = new Worker(new URL("../lib/sidewalkWorker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.gen !== gen.current) return;
      if (m.type === "ready") {
        ready.current = true;
        console.log(`trottoirs: index pret dans le worker en ${m.ms} ms`);
        return;
      }
      const key = m.tx + ":" + m.ty;
      inflight.current.delete(key);
      resident.current.set(key, toGeometry(m));
      bump((n) => n + 1);
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  // nouvel index : on envoie le reseau et les emprises, et on repart de zero
  useEffect(() => {
    const w = worker.current;
    if (!w) return;
    gen.current++;
    ready.current = false;
    inflight.current.clear();
    const map = resident.current;
    for (const b of map.values()) {
      b.paving.dispose();
      b.trim.dispose();
    }
    map.clear();
    bump((n) => n + 1);

    // emprises a plat, transferees sans copie
    let n = 0;
    for (const b of buildings) n += b.ring.length;
    const coords = new Float64Array(n * 2);
    const starts = new Uint32Array(buildings.length);
    let o = 0;
    buildings.forEach((b, i) => {
      starts[i] = o;
      for (const p of b.ring) {
        coords[o * 2] = p.x;
        coords[o * 2 + 1] = p.y;
        o++;
      }
    });
    const msg: WorkerIn = {
      type: "init",
      gen: gen.current,
      ways,
      coords,
      starts,
      sides: sides ? [...sides.entries()] : [],
    };
    w.postMessage(msg, [coords.buffer, starts.buffer]);
  }, [ways, buildings, sides]);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < TICK) return;
    acc.current = 0;
    const editing = useStore.getState().mode === "edit";
    const px = editing ? editView.x : car.x;
    const py = editing ? editView.y : car.y;
    const map = resident.current;
    let changed = false;

    for (const [key, b] of map) {
      const [tx, ty] = key.split(":").map(Number);
      const d = Math.hypot((tx + 0.5) * TILE - px, (ty + 0.5) * TILE - py);
      if (d > DROP_R) {
        b.paving.dispose();
        b.trim.dispose();
        map.delete(key);
        changed = true;
      }
    }

    const want: { key: string; tx: number; ty: number; d: number }[] = [];
    const r = Math.ceil(LOAD_R / TILE);
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    for (let tx = cx - r; tx <= cx + r; tx++) {
      for (let ty = cy - r; ty <= cy + r; ty++) {
        const key = tx + ":" + ty;
        if (map.has(key) || inflight.current.has(key)) continue;
        const d = Math.hypot((tx + 0.5) * TILE - px, (ty + 0.5) * TILE - py);
        if (d <= LOAD_R) want.push({ key, tx, ty, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    const w = worker.current;
    if (w && ready.current) {
      for (const t of want) {
        if (inflight.current.size >= INFLIGHT) break;
        if (inflight.current.has(t.key)) continue;
        inflight.current.add(t.key);
        const msg: WorkerIn = { type: "tile", gen: gen.current, tx: t.tx, ty: t.ty };
        w.postMessage(msg);
      }
    }
    if (changed) bump((n) => n + 1);
  });

  return (
    <group>
      {[...resident.current.entries()].map(([key, b]) => (
        <group key={key}>
          <mesh geometry={b.paving} material={mats.paving} renderOrder={25} />
          <mesh geometry={b.trim} material={mats.trim} renderOrder={26} />
        </group>
      ))}
    </group>
  );
}
