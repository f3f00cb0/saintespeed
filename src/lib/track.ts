// Un tracé est une suite de points lat/lon. Au chargement on les colle au
// réseau, comme l'ancien CIRCUIT figé dans le store.

export type TrackPoint = {
  lon: number;
  lat: number;
  label?: string;
};

export type Track = {
  id: string;
  name: string;
  checkpoints: TrackPoint[];
};

export const DEFAULT_TRACK_ID = "officiel";

export const DEFAULT_TRACK: Track = {
  id: DEFAULT_TRACK_ID,
  name: "Circuit officiel",
  checkpoints: [
    { label: "Anatole France", lon: 4.39083, lat: 45.4305 },
    { label: "Fauriel haut", lon: 4.39573, lat: 45.43099 },
    { label: "La Métare", lon: 4.41076, lat: 45.42133 },
    { label: "Daguerre", lon: 4.38962, lat: 45.42379 },
  ],
};

const CURRENT_KEY = "saintespeed.track";
const LIBRARY_KEY = "saintespeed.tracks";

export function newTrackId(): string {
  return "t" + Math.random().toString(36).slice(2, 10);
}

export function emptyTrack(name = "Nouveau tracé"): Track {
  return { id: newTrackId(), name, checkpoints: [] };
}

export function forkIfOfficial(track: Track): Track {
  if (track.id !== DEFAULT_TRACK_ID) return track;
  return { ...track, id: newTrackId(), name: `${track.name} (copie)` };
}

export function parseTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pts = o.checkpoints;
  if (!Array.isArray(pts)) return null;
  const checkpoints: TrackPoint[] = [];
  for (const p of pts) {
    if (!p || typeof p !== "object") continue;
    const q = p as Record<string, unknown>;
    const lon = Number(q.lon);
    const lat = Number(q.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const label = typeof q.label === "string" ? q.label : undefined;
    checkpoints.push({ lon, lat, label });
  }
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : "Tracé importé";
  const id = typeof o.id === "string" && o.id ? o.id : newTrackId();
  return { id, name, checkpoints };
}

export function loadCurrent(): Track | null {
  try {
    return parseTrack(JSON.parse(localStorage.getItem(CURRENT_KEY) || "null"));
  } catch {
    return null;
  }
}

export function saveCurrent(track: Track) {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(track));
  } catch {
    /* quota / mode privé */
  }
}

export function loadLibrary(): Track[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map(parseTrack).filter((t): t is Track => !!t && t.id !== DEFAULT_TRACK_ID);
  } catch {
    return [];
  }
}

export function saveLibrary(tracks: Track[]) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(tracks.filter((t) => t.id !== DEFAULT_TRACK_ID)));
  } catch {
    /* quota / mode privé */
  }
}

export function upsertLibrary(track: Track): Track[] {
  const saved = track.id === DEFAULT_TRACK_ID ? { ...track, id: newTrackId() } : track;
  const next = loadLibrary().filter((t) => t.id !== saved.id);
  next.unshift(saved);
  saveLibrary(next);
  return next;
}

export function removeFromLibrary(id: string): Track[] {
  const next = loadLibrary().filter((t) => t.id !== id);
  saveLibrary(next);
  return next;
}
