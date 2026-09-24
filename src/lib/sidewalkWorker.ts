// Construction des tuiles de trottoir hors du fil principal.
//
// Une tuile coute 28 ms en mediane et jusqu'a 130 ms dans le centre dense
// (mesure `npm run voirie`) : faite sur le fil de rendu, elle se voyait en
// roulant comme un a-coup a chaque nouvelle tuile. Le worker recoit une fois le
// reseau, les emprises et les cotes OSM, reconstruit son propre graphe (meme
// entree, meme projection, donc les memes metres que le jeu), puis repond aux
// demandes de tuiles en transferant ses tableaux, sans copie.

import { buildGraph } from "./graph";
import type { Way } from "./osm";
import { buildSidewalkTile, prepareSidewalks, type SidewalkWorld } from "./sidewalks";

export type WorkerIn =
  | {
      type: "init";
      gen: number;
      ways: Way[];
      /** emprises a plat : x, y, x, y... et le debut de chaque anneau */
      coords: Float64Array;
      starts: Uint32Array;
      sides: [number, number][];
    }
  | { type: "tile"; gen: number; tx: number; ty: number };

export type WorkerOut =
  | { type: "ready"; gen: number; ms: number }
  | {
      type: "tile";
      gen: number;
      tx: number;
      ty: number;
      paving: Float32Array;
      pavingUv: Float32Array;
      trim: Float32Array;
      trimColor: Float32Array;
      ms: number;
    };

let world: SidewalkWorld | null = null;
let gen = -1;

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === "init") {
    const t0 = performance.now();
    const graph = buildGraph(m.ways);
    const buildings: { ring: { x: number; y: number }[] }[] = [];
    for (let b = 0; b < m.starts.length; b++) {
      const s = m.starts[b];
      const end = b + 1 < m.starts.length ? m.starts[b + 1] : m.coords.length / 2;
      const ring: { x: number; y: number }[] = [];
      for (let i = s; i < end; i++) ring.push({ x: m.coords[i * 2], y: m.coords[i * 2 + 1] });
      buildings.push({ ring });
    }
    world = prepareSidewalks(m.ways, graph.proj, graph, buildings, new Map(m.sides));
    gen = m.gen;
    const out: WorkerOut = { type: "ready", gen, ms: Math.round(performance.now() - t0) };
    self.postMessage(out);
    return;
  }
  if (!world || m.gen !== gen) return; // demande d'un index perime
  const t = buildSidewalkTile(world, m.tx, m.ty);
  const out: WorkerOut = {
    type: "tile",
    gen,
    tx: m.tx,
    ty: m.ty,
    paving: t.paving,
    pavingUv: t.pavingUv,
    trim: t.trim,
    trimColor: t.trimColor,
    ms: t.ms,
  };
  (self as unknown as Worker).postMessage(out, [
    t.paving.buffer,
    t.pavingUv.buffer,
    t.trim.buffer,
    t.trimColor.buffer,
  ]);
};
