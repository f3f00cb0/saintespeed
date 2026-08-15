export type PeerPose = {
  x: number;
  y: number;
  heading: number;
  speed: number;
  steer: number;
  brake: number;
  nextCp: number;
  lapTime: number;
  running: boolean;
};

export type Peer = PeerPose & {
  id: string;
  name: string;
  color: number;
  fresh: boolean;
  x0: number;
  y0: number;
  h0: number;
  t0: number;
  x1: number;
  y1: number;
  h1: number;
  t1: number;
};

export const peers = new Map<string, Peer>();

const listeners = new Set<() => void>();
let listKey = "";

export function onPeers(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function peerListKey() {
  return listKey;
}

function bumpList() {
  listKey = [...peers.keys()].join(",");
  for (const fn of listeners) fn();
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function addPeer(id: string, name: string, color: number, pose?: Partial<PeerPose>) {
  if (peers.has(id)) return;
  const now = performance.now();
  const x = pose?.x ?? 0;
  const y = pose?.y ?? 0;
  const heading = pose?.heading ?? 0;
  peers.set(id, {
    id,
    name,
    color,
    fresh: true,
    x,
    y,
    heading,
    speed: pose?.speed ?? 0,
    steer: pose?.steer ?? 0,
    brake: pose?.brake ?? 0,
    nextCp: pose?.nextCp ?? 1,
    lapTime: pose?.lapTime ?? 0,
    running: pose?.running ?? false,
    x0: x,
    y0: y,
    h0: heading,
    t0: now,
    x1: x,
    y1: y,
    h1: heading,
    t1: now,
  });
  bumpList();
}

export function removePeer(id: string) {
  if (!peers.delete(id)) return;
  bumpList();
}

export function clearPeers() {
  if (!peers.size) return;
  peers.clear();
  bumpList();
}

export function applyPose(id: string, pose: PeerPose) {
  const p = peers.get(id);
  if (!p) return;
  const now = performance.now();
  if (p.fresh) {
    p.fresh = false;
    p.x = p.x0 = p.x1 = pose.x;
    p.y = p.y0 = p.y1 = pose.y;
    p.heading = p.h0 = p.h1 = pose.heading;
    p.t0 = now;
    p.t1 = now;
    p.speed = pose.speed;
    p.steer = pose.steer;
    p.brake = pose.brake;
    p.nextCp = pose.nextCp;
    p.lapTime = pose.lapTime;
    p.running = pose.running;
    return;
  }
  p.x0 = p.x;
  p.y0 = p.y;
  p.h0 = p.heading;
  p.t0 = now;
  p.x1 = pose.x;
  p.y1 = pose.y;
  p.h1 = pose.heading;
  p.t1 = now + 70;
  p.speed = pose.speed;
  p.steer = pose.steer;
  p.brake = pose.brake;
  p.nextCp = pose.nextCp;
  p.lapTime = pose.lapTime;
  p.running = pose.running;
}

export function samplePeer(p: Peer, now: number) {
  const span = Math.max(1, p.t1 - p.t0);
  const t = Math.min(1.2, (now - p.t0) / span);
  p.x = p.x0 + (p.x1 - p.x0) * t;
  p.y = p.y0 + (p.y1 - p.y0) * t;
  p.heading = p.h0 + wrap(p.h1 - p.h0) * t;
}
