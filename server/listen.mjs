import { fileURLToPath } from "node:url";
import { listenRoom } from "./room.mjs";

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) listenRoom();
