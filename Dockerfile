# syntax=docker/dockerfile:1

# Etape 1 : build du bundle statique (Vite)
FROM node:22-alpine AS build
WORKDIR /app

# Dependances d'abord : le cache Docker tient tant que les manifests ne bougent pas.
COPY package.json package-lock.json ./
RUN npm ci

# Puis le code, et build (le script lance aussi `tsc -b` : le typecheck barre la sortie).
COPY . .
RUN npm run build

# Les gros JSON OSM sortent du build tels quels (5,5 Mo a eux trois). On les
# pre-compresse ici pour que nginx serve le .gz tout fait via gzip_static, au
# lieu de recompresser 2,9 Mo a chaque requete froide.
RUN find dist -type f \( -name '*.json' -o -name '*.geojson' -o -name '*.js' -o -name '*.css' \) \
      -exec gzip -9 -k {} \;

# Etape 2 : nginx pour le SPA, Node pour le salon WebSocket.
FROM nginx:1.27-alpine AS serve

RUN apk add --no-cache nodejs

# On ne garde que le resultat du build, rien de la toolchain Node.
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/node_modules/ws /app/node_modules/ws
COPY server /app/server
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Sonde simple : nginx repond sur / des qu'il est pret.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

EXPOSE 80
CMD ["/start.sh"]
