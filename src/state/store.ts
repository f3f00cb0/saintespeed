import { create } from "zustand";
import type { RoadGraph } from "../lib/graph";
import type { Way } from "../lib/osm";
import type { FlatBuilding, WallIndex } from "../lib/buildings";
import type { FlatFeatures } from "../lib/features";
import type { FlatRail, RoadProbe } from "../lib/rail";

export type Checkpoint = {
  id: number;
  label: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  tx: number; // tangente de la route sur laquelle il est pose
  ty: number;
  width: number;
  radius: number;
  road: string;
};

// Circuit trace sur de vraies rues stephanoises. Les coordonnees sont des
// points reels de la geometrie OSM, snappes au reseau au chargement.
export const CIRCUIT: { label: string; lon: number; lat: number }[] = [
  { label: "Anatole France", lon: 4.39083, lat: 45.4305 },
  { label: "Fauriel haut", lon: 4.39573, lat: 45.43099 },
  { label: "La Métare", lon: 4.41076, lat: 45.42133 },
  { label: "Daguerre", lon: 4.38962, lat: 45.42379 },
];

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

  tele: Telemetry;

  nextCp: number;
  running: boolean;
  lapTime: number;
  bestLap: number | null;
  laps: number[];

  setLoaded(graph: RoadGraph, ways: Way[], checkpoints: Checkpoint[], source: string): void;
  setBuildings(buildings: FlatBuilding[], walls: WallIndex): void;
  setFeatures(features: FlatFeatures): void;
  setRail(rail: FlatRail[]): void;
  setRoadProbe(probe: RoadProbe): void;
  toggleBuildings(): void;
  setError(msg: string): void;
  setTele(t: Telemetry, lapTime: number): void;
  passCheckpoint(): void;
  startRace(): void;
  resetRace(): void;
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

  tele: { fps: 0, speedKmh: 0, roadName: "", roadType: "", offroad: false, cpDist: 0, cpBearing: 0 },

  nextCp: 1,
  running: false,
  lapTime: 0,
  bestLap: null,
  laps: [],

  setLoaded: (graph, ways, checkpoints, source) =>
    set({ phase: "ready", graph, ways, checkpoints, source }),

  setBuildings: (buildings, walls) => set({ buildings, walls }),

  setFeatures: (features) => set({ features }),

  setRail: (rail) => set({ rail }),

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
}));
