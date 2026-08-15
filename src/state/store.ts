import { create } from "zustand";
import type { RoadGraph } from "../lib/graph";
import type { Way } from "../lib/osm";
import type { FlatBuilding, WallIndex } from "../lib/buildings";
import type { FlatFeatures } from "../lib/features";
import type { FlatRail, RoadProbe } from "../lib/rail";
import type { Voirie } from "../lib/voirie";
import type { Checkpoint } from "../lib/race";
import { makeCheckpoints, snapCheckpoint, trackFromCheckpoints } from "../lib/race";
import {
  DEFAULT_TRACK,
  emptyTrack,
  forkIfOfficial,
  loadLibrary,
  removeFromLibrary,
  saveCurrent,
  upsertLibrary,
  type Track,
} from "../lib/track";

export type { Checkpoint };

export type Mode = "drive" | "edit";
export type NetStatus = "off" | "on" | "lost";

type Phase = "loading" | "ready" | "error";

export type Telemetry = {
  fps: number;
  speedKmh: number;
  roadName: string;
  roadType: string;
  offroad: boolean;
  cpDist: number;
  cpBearing: number; // radians, relatif au cap voiture
};

function persist(track: Track, cps: Checkpoint[]): Track {
  const next = trackFromCheckpoints(track.id, track.name, cps);
  saveCurrent(next);
  return next;
}

function reindex(cps: Checkpoint[]): Checkpoint[] {
  return cps.map((c, i) => ({ ...c, id: i }));
}

type Store = {
  phase: Phase;
  error: string;
  source: string;
  graph: RoadGraph | null;
  ways: Way[];
  checkpoints: Checkpoint[];
  buildings: FlatBuilding[];
  walls: WallIndex | null;
  showBuildings: boolean;
  features: FlatFeatures | null;
  /** Troncons ferroviaires aeriens : le viaduc que porte la gare Carnot. */
  rail: FlatRail[];
  /** Sonde de chaussee, partagee par le profil du viaduc et ses piles. */
  roadProbe: RoadProbe | null;
  /** Cote du trottoir et passages pietons, quand OSM les porte. */
  voirie: Voirie | null;

  mode: Mode;
  track: Track;
  selectedCp: number;
  library: Track[];

  tele: Telemetry;

  nextCp: number;
  running: boolean;
  lapTime: number;
  bestLap: number | null;
  laps: number[];

  netStatus: NetStatus;
  netCount: number;
  netId: string;
  goGen: number;

  setLoaded(graph: RoadGraph, ways: Way[], checkpoints: Checkpoint[], source: string, track: Track): void;
  setBuildings(buildings: FlatBuilding[], walls: WallIndex): void;
  setFeatures(features: FlatFeatures): void;
  setRail(rail: FlatRail[]): void;
  setVoirie(voirie: Voirie): void;
  setRoadProbe(probe: RoadProbe): void;
  toggleBuildings(): void;
  setError(msg: string): void;
  setTele(t: Telemetry, lapTime: number): void;
  passCheckpoint(): void;
  startRace(): void;
  resetRace(): void;

  setMode(mode: Mode): void;
  setSelectedCp(i: number): void;
  setTrackName(name: string): void;
  loadTrack(track: Track): void;
  newTrack(): void;
  addCheckpointAt(x: number, y: number): number;
  moveCheckpoint(i: number, x: number, y: number): void;
  removeCheckpoint(i: number): void;
  reorderCheckpoint(i: number, dir: -1 | 1): void;
  setCheckpointLabel(i: number, label: string): void;
  saveToLibrary(): void;
  deleteFromLibrary(id: string): void;
  applyRoomTrack(track: Track): void;
  setNet(status: NetStatus, count: number, id?: string): void;
  bumpGo(): void;
};

export const useStore = create<Store>((set, get) => ({
  phase: "loading",
  error: "",
  source: "",
  graph: null,
  ways: [],
  checkpoints: [],
  buildings: [],
  walls: null,
  showBuildings: true,
  features: null,
  rail: [],
  roadProbe: null,
  voirie: null,

  mode: "drive",
  track: DEFAULT_TRACK,
  selectedCp: -1,
  library: loadLibrary(),

  tele: { fps: 0, speedKmh: 0, roadName: "", roadType: "", offroad: false, cpDist: 0, cpBearing: 0 },

  nextCp: 1,
  running: false,
  lapTime: 0,
  bestLap: null,
  laps: [],

  netStatus: "off",
  netCount: 1,
  netId: "",
  goGen: 0,

  setLoaded: (graph, ways, checkpoints, source, track) =>
    set({ phase: "ready", graph, ways, checkpoints, source, track }),

  setBuildings: (buildings, walls) => set({ buildings, walls }),

  setFeatures: (features) => set({ features }),

  setRail: (rail) => set({ rail }),

  setVoirie: (voirie) => set({ voirie }),

  setRoadProbe: (roadProbe) => set({ roadProbe }),

  toggleBuildings: () => set((s) => ({ showBuildings: !s.showBuildings })),

  setError: (error) => set({ phase: "error", error }),

  setTele: (tele, lapTime) => set({ tele, lapTime }),

  startRace: () => set({ running: true, nextCp: 1, lapTime: 0 }),

  passCheckpoint: () => {
    const { nextCp, checkpoints, lapTime, bestLap, laps, running } = get();
    if (!running) return;
    const last = nextCp === 0; // on repasse la ligne de depart
    if (last) {
      const best = bestLap === null || lapTime < bestLap ? lapTime : bestLap;
      set({ laps: [...laps, lapTime], bestLap: best, lapTime: 0, nextCp: 1 });
    } else {
      set({ nextCp: (nextCp + 1) % checkpoints.length });
    }
  },

  resetRace: () => set({ running: false, nextCp: 1, lapTime: 0 }),

  setMode: (mode) => set({ mode, selectedCp: -1, running: false, nextCp: 1, lapTime: 0 }),

  setSelectedCp: (selectedCp) => set({ selectedCp }),

  setTrackName: (name) => {
    const { track, checkpoints } = get();
    const next = persist({ ...forkIfOfficial(track), name }, checkpoints);
    set({ track: next });
  },

  loadTrack: (track) => {
    const { graph } = get();
    if (!graph) return;
    const checkpoints = makeCheckpoints(graph, track);
    const next = persist(track, checkpoints);
    set({
      track: next,
      checkpoints,
      selectedCp: -1,
      running: false,
      nextCp: 1,
      lapTime: 0,
      bestLap: null,
      laps: [],
    });
  },

  newTrack: () => {
    get().loadTrack(emptyTrack());
  },

  addCheckpointAt: (x, y) => {
    const { graph, track, checkpoints } = get();
    if (!graph) return -1;
    const cp = snapCheckpoint(graph, x, y, 80);
    if (!cp) return -1;
    const nextCps = reindex([...checkpoints, cp]);
    const next = persist(forkIfOfficial(track), nextCps);
    const selectedCp = nextCps.length - 1;
    set({ track: next, checkpoints: nextCps, selectedCp });
    return selectedCp;
  },

  moveCheckpoint: (i, x, y) => {
    const { graph, track, checkpoints } = get();
    if (!graph || !checkpoints[i]) return;
    const cp = snapCheckpoint(graph, x, y, 120);
    if (!cp) return;
    cp.id = i;
    cp.label = checkpoints[i].label;
    const nextCps = checkpoints.slice();
    nextCps[i] = cp;
    const next = persist(forkIfOfficial(track), nextCps);
    set({ track: next, checkpoints: nextCps });
  },

  removeCheckpoint: (i) => {
    const { track, checkpoints } = get();
    if (!checkpoints[i]) return;
    const nextCps = reindex(checkpoints.filter((_, k) => k !== i));
    const next = persist(forkIfOfficial(track), nextCps);
    set({
      track: next,
      checkpoints: nextCps,
      selectedCp: nextCps.length ? Math.min(i, nextCps.length - 1) : -1,
    });
  },

  reorderCheckpoint: (i, dir) => {
    const { track, checkpoints } = get();
    const j = i + dir;
    if (!checkpoints[i] || !checkpoints[j]) return;
    const nextCps = checkpoints.slice();
    const tmp = nextCps[i];
    nextCps[i] = nextCps[j];
    nextCps[j] = tmp;
    const ordered = reindex(nextCps);
    const next = persist(forkIfOfficial(track), ordered);
    set({ track: next, checkpoints: ordered, selectedCp: j });
  },

  setCheckpointLabel: (i, label) => {
    const { track, checkpoints } = get();
    if (!checkpoints[i]) return;
    const nextCps = checkpoints.slice();
    nextCps[i] = { ...nextCps[i], label };
    const next = persist(forkIfOfficial(track), nextCps);
    set({ track: next, checkpoints: nextCps });
  },

  saveToLibrary: () => {
    const { track, checkpoints } = get();
    const next = persist(forkIfOfficial(track), checkpoints);
    set({ track: next, library: upsertLibrary(next) });
  },

  deleteFromLibrary: (id) => set({ library: removeFromLibrary(id) }),

  applyRoomTrack: (track) => {
    const { graph } = get();
    if (!graph) return;
    const checkpoints = makeCheckpoints(graph, track);
    set({
      track,
      checkpoints,
      selectedCp: -1,
      running: false,
      nextCp: 1,
      lapTime: 0,
      bestLap: null,
      laps: [],
    });
  },

  setNet: (netStatus, netCount, id) =>
    set(id !== undefined ? { netStatus, netCount, netId: id } : { netStatus, netCount }),

  bumpGo: () => set({ goGen: get().goGen + 1 }),
}));
