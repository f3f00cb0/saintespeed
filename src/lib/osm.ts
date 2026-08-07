// Chargement du reseau : fichier local d'abord, Overpass en secours.
// Donnees OpenStreetMap, ODbL.

export type RoadSpec = { w: number; c: number; z: number };

// Hierarchie reprise de l'etape 0 : largeur (m), couleur, rang de dessin.
// z est un rang, converti en hauteur reelle par LAYER_STEP au rendu.
export const ROADS: Record<string, RoadSpec> = {
  motorway: { w: 14, c: 0xf2ede0, z: 6 },
  trunk: { w: 12, c: 0xf2ede0, z: 6 },
  primary: { w: 10, c: 0xe0b15e, z: 5 },
  secondary: { w: 8, c: 0xc9a55c, z: 4 },
  tertiary: { w: 7, c: 0x9aa06f, z: 3 },
  unclassified: { w: 5, c: 0x6f7768, z: 2 },
  residential: { w: 5, c: 0x4a5450, z: 1 },
  living_street: { w: 4, c: 0x4a5450, z: 1 },
  motorway_link: { w: 8, c: 0xf2ede0, z: 5 },
  trunk_link: { w: 8, c: 0xf2ede0, z: 5 },
  primary_link: { w: 7, c: 0xe0b15e, z: 4 },
  secondary_link: { w: 6, c: 0xc9a55c, z: 3 },
  tertiary_link: { w: 5, c: 0x9aa06f, z: 2 },
};
export const DEFAULT_ROAD: RoadSpec = { w: 4, c: 0x4a5450, z: 1 };

// hauteur en metres entre deux rangs, pour que les gros axes passent devant
export const LAYER_STEP = 0.06;

export function specFor(type: string | undefined): RoadSpec {
  return (type && ROADS[type]) || DEFAULT_ROAD;
}

export type Way = {
  id: number;
  type: string;
  name?: string;
  oneway?: string;
  pts: [number, number][]; // [lon, lat]
};

export const BBOX = [45.38, 4.33, 45.49, 4.44]; // sud, ouest, nord, est

const HIGHWAYS =
  "motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street" +
  "|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link";

const OVERPASS_QUERY =
  `[out:json][timeout:120];` +
  `way["highway"~"^(${HIGHWAYS})$"](${BBOX[0]},${BBOX[1]},${BBOX[2]},${BBOX[3]});` +
  `out geom;`;

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Avale du JSON Overpass (.elements) ou du GeoJSON (.features).
export function parseNetwork(data: any): Way[] {
  const ways: Way[] = [];
  let auto = 0;

  if (data && Array.isArray(data.elements)) {
    for (const el of data.elements) {
      if (el.type !== "way" || !el.geometry) continue;
      const t = el.tags || {};
      ways.push({
        id: el.id ?? ++auto,
        type: t.highway,
        name: t.name,
        oneway: t.oneway,
        pts: el.geometry.map((g: any) => [g.lon, g.lat] as [number, number]),
      });
    }
  } else if (data && Array.isArray(data.features)) {
    for (const f of data.features) {
      const g = f.geometry;
      if (!g) continue;
      const p = f.properties || {};
      const base = { type: p.highway, name: p.name, oneway: p.oneway };
      if (g.type === "LineString") {
        ways.push({ id: f.id ?? ++auto, ...base, pts: g.coordinates });
      } else if (g.type === "MultiLineString") {
        for (const c of g.coordinates) ways.push({ id: ++auto, ...base, pts: c });
      }
    }
  }
  return ways.filter((w) => w.pts && w.pts.length >= 2);
}

export type NetworkLoad = { ways: Way[]; source: string };

export async function loadNetwork(): Promise<NetworkLoad> {
  // 1. cache local genere par scripts/fetch-osm.mjs
  try {
    const res = await fetch("/sainte.geojson");
    if (res.ok) {
      const ways = parseNetwork(await res.json());
      if (ways.length) return { ways, source: "cache local" };
    }
  } catch (err) {
    console.warn("cache local indisponible", err);
  }

  // 2. secours : Overpass au runtime
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(OVERPASS_QUERY),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const ways = parseNetwork(await res.json());
      if (!ways.length) throw new Error("reseau vide");
      return { ways, source: "Overpass " + new URL(url).host };
    } catch (err) {
      console.warn("Overpass", url, err);
    }
  }

  throw new Error("Aucune source de reseau disponible. Lance: npm run fetch-osm");
}
