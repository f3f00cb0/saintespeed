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
import { buildSidewalks } from "../src/lib/sidewalks";
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
  return { ways, graph, buildings, walls, voirie, areas, centre: graph.proj.project(4.39, 45.4397) };
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

/** Les chiffres : cout, et les deux fautes qu'aucune capture ne montre. */
export function verifier(c: Charge, area: number): string {
  const m = buildSidewalks(c.ways, c.graph.proj, c.graph, c.walls, c.centre, area, c.voirie.sidewalks);
  const s = m.stats;
  const dans = indexEmprises(c.buildings);
  const top = m.top;
  let surChaussee = 0;
  let dansMur = 0;
  let bandes = 0;
  // Les raccords d'angle occupent legitimement le coin du carrefour : les juger
  // avec la meme regle que les bandes ferait sonner une fausse alerte. Ils sont
  // en fin de tampon, apres s.cornerStart, et se verifient sur leur surface.
  for (let i = 0; i + 17 < s.cornerStart; i += 18) {
    bandes++;
    const cx = (top[i] + top[i + 12]) / 2;
    const cy = -(top[i + 2] + top[i + 14]) / 2;
    const hit = c.graph.nearestEdge(cx, cy, 30);
    if (hit && hit.dist < hit.edge.halfWidth - 0.1) surChaussee++;
    if (dans(top[i + 12], -top[i + 14])) dansMur++;
  }
  let aireMax = 0;
  let aireTot = 0;
  let nCoins = 0;
  for (let i = s.cornerStart; i + 17 < top.length; i += 18) {
    const ax = top[i], ay = -top[i + 2];
    const bx = top[i + 3], by = -top[i + 5];
    const cx2 = top[i + 6], cy2 = -top[i + 8];
    const dx2 = top[i + 15], dy2 = -top[i + 17];
    const aire = Math.abs((bx - ax) * (cy2 - ay) - (cx2 - ax) * (by - ay)) / 2 +
      Math.abs((cx2 - ax) * (dy2 - ay) - (dx2 - ax) * (cy2 - ay)) / 2;
    aireTot += aire;
    nCoins++;
    if (aire > aireMax) aireMax = aire;
  }
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

  const L = s.runLengths.slice().sort((a, b) => a - b);
  const q = (f: number) => L[Math.floor(L.length * f)] ?? 0;
  const pct = (n: number) => `${((n / Math.max(1, bandes)) * 100).toFixed(2)} %`;
  return (
    `${area === Infinity ? "ville entiere" : `boite ${area} m`}\n` +
    `  ${s.posed} cotes poses sur ${s.segments} segments · ${s.fromTag} cotes decides par OSM, ` +
    `${s.deniedByTag} refuses par OSM\n` +
    `  ${s.skippedNoRoom} sans place · ${s.skippedJunction} au carrefour · ` +
    `${s.narrowed} rabotes sur la facade · ${s.droppedShort} bandes trop courtes\n` +
    `  ${s.runs} bandes continues : p10 ${q(0.1).toFixed(1)} m, mediane ${q(0.5).toFixed(1)} m, ` +
    `${(L.reduce((a, b) => a + b, 0) / 1000).toFixed(0)} km cumules\n` +
    `  ${Math.round(s.triangles / 1000)}k triangles, ${s.ms} ms\n` +
    `  ${nCoins} raccords d'angle : aire moyenne ${(aireTot / Math.max(1, nCoins)).toFixed(1)} m2, ` +
    `la plus grande ${aireMax.toFixed(1)} m2\n` +
    `  VERIFICATION (bandes seules)  sur une chaussee : ${surChaussee} (${pct(surChaussee)}) · ` +
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
  const m = buildSidewalks(c.ways, c.graph.proj, c.graph, c.walls, c.centre, Infinity, c.voirie.sidewalks);
  const o = c.graph.proj.project(lon, lat);
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
  const top = m.top;
  let ns = 0;
  for (let i = 0; i + 17 < top.length; i += 18) {
    const raccord = i >= m.stats.cornerStart;
    const pts = [[top[i], -top[i + 2]], [top[i + 3], -top[i + 5]], [top[i + 6], -top[i + 8]], [top[i + 15], -top[i + 17]]];
    if (Math.abs(pts[0][0] - o.x) > rayon + 20 || Math.abs(pts[0][1] - o.y) > rayon + 20) continue;
    ns++;
    out.push(
      `<polygon points="${pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(" ")}" fill="${raccord ? "#6d6250" : "#5c6058"}" stroke="${raccord ? "#c2a978" : "#9aa094"}" stroke-width="0.7"/>`,
    );
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
    `<text x="12" y="26" fill="#cfd6e6" font-family="monospace" font-size="15">${lon}, ${lat} · rayon ${rayon} m · ${nb} emprises, ${ns} bandes, ${nc} bandes de passage pieton, ${sols.length} sols</text>`,
    `<text x="12" y="46" fill="#9aa094" font-family="monospace" font-size="12">gris clair = trottoir · ocre = raccord d'angle · blanc = passage pieton releve dans OSM</text>`,
    `</svg>`,
  );
  writeFileSync(sortie, out.join("\n"));
  return `  ecrit ${sortie} : ${nb} emprises, ${ns} bandes, ${nc} passages pietons`;
}
