import type { Track } from "./track";
import { parseTrack } from "./track";
import { addPeer, applyPose, clearPeers, peers, removePeer, type PeerPose } from "./peers";
import { armGo } from "./session";
import { useStore } from "../state/store";
import type { NetStatus } from "../state/store";
import { spawnAt } from "./race";
import { framePoints } from "./editView";

type Welcome = {
  t: "welcome";
  id: string;
  players: { id: string; name: string; color: number }[];
  track: Track | null;
};

type Join = { t: "join"; id: string; name: string; color: number };
type Leave = { t: "leave"; id: string };
type PoseMsg = { t: "pose"; id: string } & PeerPose;
type TrackMsg = { t: "track"; track: Track };
type GoMsg = { t: "go" };

type InMsg = Welcome | Join | Leave | PoseMsg | TrackMsg | GoMsg;

let socket: WebSocket | null = null;
let selfId = "";
let retry: number | null = null;
let started = false;

function setNet(status: NetStatus, count: number, id = selfId) {
  useStore.getState().setNet(status, count, id);
}

function count() {
  return peers.size + (selfId ? 1 : 0);
}

function send(msg: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function sendPose(pose: PeerPose) {
  send({ t: "pose", ...pose });
}

export function sendTrack(track: Track) {
  send({ t: "track", track });
}

export function launchRace() {
  if (socket?.readyState === WebSocket.OPEN) send({ t: "go" });
  else handleGo();
}

function applyIncomingTrack(track: Track) {
  const s = useStore.getState();
  const same =
    s.track.checkpoints.length === track.checkpoints.length &&
    s.track.checkpoints.every(
      (c, i) =>
        Math.abs(c.lon - track.checkpoints[i].lon) < 1e-6 &&
        Math.abs(c.lat - track.checkpoints[i].lat) < 1e-6,
    );
  if (same) return;
  s.applyRoomTrack(track);
  const next = useStore.getState();
  if (next.mode === "edit" && next.checkpoints.length) framePoints(next.checkpoints);
  if (next.mode === "drive" && next.graph && next.checkpoints.length) {
    spawnAt(next.graph, next.checkpoints, 0);
  }
}

function handleGo() {
  const s = useStore.getState();
  s.resetRace();
  if (s.graph && s.checkpoints.length) spawnAt(s.graph, s.checkpoints, 0);
  if (s.mode === "edit") s.setMode("drive");
  armGo();
  useStore.getState().bumpGo();
}

function handle(raw: string) {
  let msg: InMsg;
  try {
    msg = JSON.parse(raw) as InMsg;
  } catch {
    return;
  }
  if (msg.t === "welcome") {
    selfId = msg.id;
    clearPeers();
    for (const p of msg.players) {
      if (p.id === selfId) continue;
      addPeer(p.id, p.name, p.color);
    }
    setNet("on", count(), selfId);
    if (msg.track) applyIncomingTrack(msg.track);
    else sendTrack(useStore.getState().track);
    return;
  }
  if (msg.t === "join") {
    if (msg.id === selfId) return;
    addPeer(msg.id, msg.name, msg.color);
    setNet("on", count());
    return;
  }
  if (msg.t === "leave") {
    removePeer(msg.id);
    setNet("on", count());
    return;
  }
  if (msg.t === "pose") {
    if (msg.id === selfId) return;
    if (!peers.has(msg.id)) addPeer(msg.id, "pilote", 0x5ec8e0);
    applyPose(msg.id, msg);
    return;
  }
  if (msg.t === "track") {
    const track = parseTrack(msg.track);
    if (track) applyIncomingTrack(track);
    return;
  }
  if (msg.t === "go") handleGo();
}

function url() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function open() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const ws = new WebSocket(url());
  socket = ws;
  ws.onopen = () => send({ t: "hello" });
  ws.onmessage = (e) => {
    if (typeof e.data === "string") handle(e.data);
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    selfId = "";
    clearPeers();
    setNet("lost", 1);
    if (started) {
      if (retry != null) window.clearTimeout(retry);
      retry = window.setTimeout(open, 2000);
    }
  };
  ws.onerror = () => ws.close();
}

export function startNet() {
  if (started) return;
  started = true;
  open();
}
