#!/bin/sh
# nginx sert le SPA, Node le salon /ws. Un seul conteneur, port 80.
export NODE_PATH=/app/node_modules
export SALON_PORT=8787
node /app/server/listen.mjs &
exec nginx -g "daemon off;"
