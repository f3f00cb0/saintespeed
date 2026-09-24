// Plan de voirie et vérification des trottoirs, sans GPU. Le lanceur est
// scripts/voirie.mjs, qui compile ce fichier a la volee.
//
// Deux sorties, et les deux ont attrape des defauts reels :
//
//   - le PLAN SVG, qui montre la geometrie vue de dessus. C'est lui qui a
//     revele les dalles de trottoir isolees dans la gueule des carrefours, que
//     trois regles de recul successives ont fallu pour eliminer ;
//   - les CHIFFRES, qui disent ce qu'aucune image ne montre : combien de bandes
//     tombent sur une chaussee voisine, combien finissent dans une emprise.
//     Le rayon de rabotage parti du bord de chaussee en laissait 256 dans un
//     mur ; parti de l'axe, il en reste 1.
//
// Ce harnais vit dans scripts/ et pas dans un dossier temporaire de session :
// les deux harnais precedents du projet (pilote automatique et camera) ont ete
// perdus pour cette raison exacte.

import { readFileSync, writeFileSync } from "node:fs";
import { parseNetwork, specFor, type Way } from "../src/lib/osm";
import { buildGraph, type RoadGraph } from "../src/lib/graph";
import { prepareBuildings, buildWallIndex, type Building, type FlatBuilding } from "../src/lib/buildings";
import { buildSidewalks, prepareSidewalks, type SidewalkWorld } from "../src/lib/sidewalks";
import { prepareVoirie, type Voirie } from "../src/lib/voirie";
import { AREAS, type AreaKind } from "../src/lib/features";
import { buildCrossings } from "../src/lib/crossings";

type Charge = {
  ways: Way[];
  graph: RoadGraph;
  buildings: FlatBuilding[];
  walls: ReturnType<typeof buildWallIndex>;
  voirie: Voirie;
  centre: { x: number; y: number };
  /** surfaces au sol brutes, pour que le plan montre aussi de quoi est fait le sol */
  areas: { k: AreaKind; pts: { x: number; y: number }[] }[];
  /** index des trottoirs, prepare une fois */
  trottoirs: SidewalkWorld;
};

export function charger(pub: string): Charge {
  const ways = parseNetwork(JSON.parse(readFileSync(pub + "/sainte.geojson", "utf8")));
  const graph = buildGraph(ways);
  const rawB = JSON.parse(readFileSync(pub + "/sainte-buildings.json", "utf8"));
  const raw: Building[] = rawB.buildings.map((b: any) => ({
    id: Number(b.i),
    ring: b.g,
    kind: b.k,
    levels: b.s ? Number(b.s) : undefined,
  }));
  const buildings = prepareBuildings(raw, graph.proj);
  const walls = buildWallIndex(buildings);
  let voirie: Voirie = { sidewalks: new Map(), crossings: [] };
  try {
    voirie = prepareVoirie(JSON.parse(readFileSync(pub + "/sainte-voirie.json", "utf8")), graph.proj);
  } catch {
    console.log("  (pas de sainte-voirie.json : regle geometrique seule)");
  }
  let areas: Charge["areas"] = [];
  try {
    const f = JSON.parse(readFileSync(pub + "/sainte-features.json", "utf8"));
    areas = (f.areas ?? []).map((a: any) => ({
      k: a.k as AreaKind,
      pts: (a.g as [number, number][]).map((p) => graph.proj.project(p[0], p[1])),
    }));
  } catch {
    console.log("  (pas de sainte-features.json : plan sans les sols)");
  }
  const trottoirs = prepareSidewalks(ways, graph.proj, graph, buildings, voirie.sidewalks);
  return { ways, graph, buildings, walls, voirie, areas, trottoirs, centre: graph.proj.project(4.39, 45.4397) };
}

/** Point dans une emprise : le seul test qui reponde vraiment "dans un mur". */
function indexEmprises(buildings: FlatBuilding[]) {
  const CELL = 60;
  const grid = new Map<string, number[]>();
  buildings.forEach((b, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of b.ring) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        const k = gx + ":" + gy;
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(i);
      }
  });
  return (x: number, y: number) => {
    const bucket = grid.get(Math.floor(x / CELL) + ":" + Math.floor(y / CELL));
    if (!bucket) return false;
    for (const i of bucket) {
      const r = buildings[i].ring;
      let hit = false;
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        if (r[a].y > y !== r[b].y > y &&
            x < ((r[b].x - r[a].x) * (y - r[a].y)) / (r[b].y - r[a].y) + r[a].x) hit = !hit;
      }
      if (hit) return true;
    }
    return false;
  };
}

/** Boite de la ville entiere, d'apres le reseau. */
function bornes(c: Charge): [number, number, number, number] {
  const b = c.graph.bounds;
  return [b.minx, b.miny, b.maxx, b.maxy];
}

/** Les chiffres : cout, et les deux fautes qu'aucune capture ne montre. */
export function verifier(c: Charge, area: number): string {
  const r = area === Infinity ? 1e9 : area;
  const tiles =
    area === Infinity
      ? buildSidewalks(c.trottoirs, ...bornes(c))
      : buildSidewalks(c.trottoirs, c.centre.x - r, c.centre.y - r, c.centre.x + r, c.centre.y + r);
  const dans = indexEmprises(c.buildings);
  // Les deux fautes se testent au centre de chaque triangle de dalle : sur une
  // chaussee (plus loin de l'axe que le demi-profil moins 10 cm, donc bien
  // dedans) ou dans une emprise.
  let surChaussee = 0;
  let dansMur = 0;
  let tris = 0;
  let surface = 0;
  let ms = 0;
  let triangles = 0;
  let vides = 0;
  for (const t of tiles) {
    ms += t.ms;
    triangles += t.triangles;
    if (!t.paving.length) vides++;
    const p = t.paving;
    for (let i = 0; i + 8 < p.length; i += 9) {
      tris++;
      const ax = p[i], ay = -p[i + 2], bx = p[i + 3], by = -p[i + 5], cx = p[i + 6], cy = -p[i + 8];
      surface += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      const hit = c.graph.nearestEdge(mx, my, 30);
      if (hit && hit.dist < hit.edge.halfWidth - 0.1) surChaussee++;
      if (dans(mx, my)) dansMur++;
    }
  }
  const pct = (n: number) => `${((n / Math.max(1, tris)) * 100).toFixed(2)} %`;
  // --- passages pietons ------------------------------------------------------
  // Une bande qui deborde de la chaussee ne se voit pas sur un plan de loin,
  // mais se voit tres bien en roulant.
  const cross = buildCrossings(c.voirie.crossings, c.graph, c.centre, area);
  const cs = cross.stats;
  let bandeHors = 0;
  let bandesPassage = 0;
  for (let i = 0; i + 17 < cross.pos.length; i += 18) {
    bandesPassage++;
    const bx = (cross.pos[i] + cross.pos[i + 6]) / 2;
    const by = -(cross.pos[i + 2] + cross.pos[i + 8]) / 2;
    const hit = c.graph.nearestEdge(bx, by, 25);
    if (!hit || hit.dist > hit.edge.halfWidth) bandeHors++;
  }

  const lent = tiles.map((t) => t.ms).sort((a, b) => a - b);
  return (
    `${area === Infinity ? "ville entiere" : `boite ${area} m`}\n` +
    `  ${tiles.length} tuiles de trottoir (${vides} sans trottoir) · ${(surface / 10000).toFixed(1)} ha de dalle\n` +
    `  ${Math.round(triangles / 1000)}k triangles, ${ms} ms au total · par tuile : mediane ` +
    `${lent[Math.floor(lent.length / 2)] ?? 0} ms, p95 ${lent[Math.floor(lent.length * 0.95)] ?? 0} ms, ` +
    `max ${lent[lent.length - 1] ?? 0} ms\n` +
    `  VERIFICATION (triangles de dalle)  sur une chaussee : ${surChaussee} (${pct(surChaussee)}) · ` +
    `dans une emprise : ${dansMur} (${pct(dansMur)})\n` +
    `  passages pietons : ${cs.posed} poses sur ${cs.marked} marques ` +
    `(${cs.outsideArea} hors boite, ${cs.offRoad} hors chaussee, ${cs.merged} doublons), ` +
    `${cs.bands} bandes, ${Math.round(cs.triangles / 1000)}k triangles, ${cs.ms} ms\n` +
    `  VERIFICATION passages  bandes hors chaussee : ${bandeHors} ` +
    `(${((bandeHors / Math.max(1, bandesPassage)) * 100).toFixed(2)} %)`
  );
}

/** Le plan : chaussee, trottoirs et passages pietons vus de dessus. */
export function plan(c: Charge, lon: number, lat: number, rayon: number, sortie: string): string {
  const o = c.graph.proj.project(lon, lat);
  const tiles = buildSidewalks(c.trottoirs, o.x - rayon, o.y - rayon, o.x + rayon, o.y + rayon);
  const S = 900 / (2 * rayon);
  const X = (x: number) => ((x - o.x + rayon) * S).toFixed(1);
  const Y = (y: number) => ((rayon - (y - o.y)) * S).toFixed(1);
  const px = 2 * rayon * S;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">`,
    `<rect width="100%" height="100%" fill="#0e1526"/>`,
  ];

  // Les sols d'abord, du plus bas au plus haut : c'est l'ordre du rendu.
  const hex = (v: number) => "#" + v.toString(16).padStart(6, "0");
  const sols = c.areas
    .filter((a) => a.pts.some((p) => Math.abs(p.x - o.x) < rayon + 60 && Math.abs(p.y - o.y) < rayon + 60))
    .sort((a, b) => (AREAS[a.k]?.z ?? 0) - (AREAS[b.k]?.z ?? 0));
  for (const a of sols) {
    const spec = AREAS[a.k];
    if (!spec) continue;
    out.push(
      `<polygon points="${a.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}" fill="${hex(spec.c)}"/>`,
    );
  }

  let nb = 0;
  for (const b of c.buildings) {
    if (Math.abs(b.ring[0].x - o.x) > rayon + 60 || Math.abs(b.ring[0].y - o.y) > rayon + 60) continue;
    nb++;
    out.push(`<polygon points="${b.ring.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}" fill="#1b2233" stroke="#2c3550" stroke-width="1"/>`);
  }
  for (const w of c.ways) {
    const spec = specFor(w.type);
    const P = w.pts.map((p) => c.graph.proj.project(p[0], p[1]));
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      if (Math.abs((a.x + b.x) / 2 - o.x) > rayon + 40 || Math.abs((a.y + b.y) / 2 - o.y) > rayon + 40) continue;
      out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="#31342e" stroke-width="${(spec.w * S).toFixed(1)}"/>`);
    }
  }
  // trottoirs : les contours reels, trous compris (evenodd)
  let ns = 0;
  for (const t of tiles) {
    if (!t.outlines.length) continue;
    ns += t.outlines.length;
    const d = t.outlines
      .map((r) => "M" + r.map((p) => `${X(p.x)},${Y(p.y)}`).join("L") + "Z")
      .join("");
    out.push(`<path d="${d}" fill="#6a6c62" fill-rule="evenodd" stroke="#b4b8aa" stroke-width="1"/>`);
  }
  // passages pietons : les vraies bandes, pas un reperage
  const cross = buildCrossings(c.voirie.crossings, c.graph, c.centre, Infinity);
  let nc = 0;
  for (let i = 0; i + 17 < cross.pos.length; i += 18) {
    const q = [
      [cross.pos[i], -cross.pos[i + 2]],
      [cross.pos[i + 3], -cross.pos[i + 5]],
      [cross.pos[i + 6], -cross.pos[i + 8]],
      [cross.pos[i + 15], -cross.pos[i + 17]],
    ];
    if (Math.abs(q[0][0] - o.x) > rayon || Math.abs(q[0][1] - o.y) > rayon) continue;
    nc++;
    out.push(`<polygon points="${q.map((p) => `${X(p[0])},${Y(p[1])}`).join(" ")}" fill="#b9b39f"/>`);
  }
  out.push(
    `<text x="12" y="26" fill="#cfd6e6" font-family="monospace" font-size="15">${lon}, ${lat} · rayon ${rayon} m · ${nb} emprises, ${ns} contours de trottoir, ${nc} bandes de passage pieton, ${sols.length} sols</text>`,
    `<text x="12" y="46" fill="#9aa094" font-family="monospace" font-size="12">gris clair = trottoir · blanc = passage pieton releve dans OSM</text>`,
    `</svg>`,
  );
  writeFileSync(sortie, out.join("\n"));
  return `  ecrit ${sortie} : ${nb} emprises, ${ns} contours de trottoir, ${nc} passages pietons`;
}
