// Projection equirectangulaire locale. Suffisante a l'echelle d'une ville,
// erreur negligeable sur 15 km. Pas de proj4.
//
// Repere metrique : x = est, y = nord, origine au barycentre du reseau.
// Repere three.js  : x = est, y = altitude, z = -nord. Voir toScene/fromScene.

export const EARTH_R = 6378137;
export const D2R = Math.PI / 180;

export type Projector = {
  lon0: number;
  lat0: number;
  k: number; // cos(lat0), compression des longitudes
  project(lon: number, lat: number): { x: number; y: number };
  unproject(x: number, y: number): { lon: number; lat: number };
};

export function makeProjector(lon0: number, lat0: number): Projector {
  const k = Math.cos(lat0 * D2R);
  return {
    lon0,
    lat0,
    k,
    project(lon, lat) {
      return {
        x: (lon - lon0) * D2R * k * EARTH_R,
        y: (lat - lat0) * D2R * EARTH_R,
      };
    },
    unproject(x, y) {
      return {
        lon: x / (D2R * k * EARTH_R) + lon0,
        lat: y / (D2R * EARTH_R) + lat0,
      };
    },
  };
}
