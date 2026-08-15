// Salon unique : tout le monde qui se connecte se voit.
// Relais de poses, du tracé courant, et d'un départ partagé. Pas d'autorité.

import { WebSocketServer } from "ws";

const COLORS = [0x5ec8e0, 0x9aa06f, 0xc47ae0, 0xe0b15e, 0x7ec8a3, 0xff8a5b];

function parseTrack(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.checkpoints)) return null;
  const checkpoints = [];
  for (const p of raw.checkpoints) {
    const lon = Number(p?.lon);
    const lat = Number(p?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    checkpoints.push({
      lon,
      lat,
      label: typeof p.label === "string" ? p.label : undefined,
    });
  }
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Tracé";
  const id = typeof raw.id === "string" && raw.id ? raw.id : "room";
  return { id, name, checkpoints };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(clients, msg, except) {
  const raw = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws !== except && ws.readyState === 1) ws.send(raw);
  }
}

export function attachRoom(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const players = new Map();
  let nextId = 1;
  let roomTrack = null;

  wss.on("connection", (ws) => {
    const id = "p" + nextId++;
    const color = COLORS[(nextId - 2) % COLORS.length];
    const name = "pilote " + id.slice(1);
    const player = { id, name, color, ws };
    players.set(ws, player);

    send(ws, {
      t: "welcome",
      id,
      players: [...players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
      track: roomTrack,
    });
    broadcast(wss.clients, { t: "join", id, name, color }, ws);

    ws.on("message", (buf) => {
      let msg;
      try {
        msg = JSON.parse(String(buf));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (msg.t === "pose") {
        broadcast(
          wss.clients,
          {
            t: "pose",
            id,
            x: +msg.x || 0,
            y: +msg.y || 0,
            heading: +msg.heading || 0,
            speed: +msg.speed || 0,
            steer: +msg.steer || 0,
            brake: +msg.brake || 0,
            nextCp: +msg.nextCp || 0,
            lapTime: +msg.lapTime || 0,
            running: !!msg.running,
          },
          ws,
        );
        return;
      }

      if (msg.t === "track") {
        const track = parseTrack(msg.track);
        if (!track) return;
        roomTrack = track;
        broadcast(wss.clients, { t: "track", track }, ws);
        return;
      }

      if (msg.t === "go") {
        broadcast(wss.clients, { t: "go" });
      }
    });

    ws.on("close", () => {
      players.delete(ws);
      broadcast(wss.clients, { t: "leave", id });
      if (!players.size) roomTrack = null;
    });
  });

  console.log("salon saintespeed sur /ws");
  return wss;
}
