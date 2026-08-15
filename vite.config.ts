import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// salon Node, pas de types bundler pour le .mjs
// @ts-expect-error -- server/room.mjs
import { listenRoom } from "./server/room.mjs";

const SALON = 8787;

function roomPlugin(): Plugin {
  return {
    name: "saintespeed-room",
    config() {
      const proxy = {
        "/ws": { target: `http://127.0.0.1:${SALON}`, ws: true },
      };
      return { server: { proxy }, preview: { proxy } };
    },
    configureServer() {
      listenRoom(SALON);
    },
    configurePreviewServer() {
      listenRoom(SALON);
    },
  };
}

export default defineConfig({
  plugins: [react(), roomPlugin()],
  server: { port: 5173, open: true },
});
