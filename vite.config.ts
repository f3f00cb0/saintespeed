import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// salon Node, pas de types bundler pour le .mjs
// @ts-expect-error -- server/room.mjs
import { attachRoom } from "./server/room.mjs";

function roomPlugin(): Plugin {
  const attach = (httpServer: { on: (...args: unknown[]) => unknown } | null) => {
    if (httpServer) attachRoom(httpServer);
  };
  return {
    name: "saintespeed-room",
    configureServer(server) {
      return () => attach(server.httpServer);
    },
    configurePreviewServer(server) {
      return () => attach(server.httpServer);
    },
  };
}

export default defineConfig({
  plugins: [react(), roomPlugin()],
  server: { port: 5173, open: true },
});
