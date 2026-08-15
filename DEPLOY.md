# Déploiement (Dokploy)

Sainté Speed est un SPA Vite servi par nginx, plus un petit salon Node sur
`/ws` (même conteneur, port 80). Pas de base, pas de variable d'environnement.
Dokploy et Traefik gèrent le domaine et le TLS.

## Déploiement actuel

- URL : https://speed.mathieumont.cc
- Instance Dokploy : `http://5.75.178.145:3000`, projet **SainteSpeed**, application **saintespeed**.
- Repo GitHub : `f3f00cb0/saintespeed` (public), branche `main`, déployé via
  l'app GitHub Dokploy déjà reliée à ce compte.
- DNS Cloudflare : `speed` en A vers `5.75.178.145`, **proxifié** (nuage orange),
  comme `pdfeditor` et `flip`. Sous-domaine à un seul niveau, donc couvert par
  le certificat Universal SSL `*.mathieumont.cc`.
- Autodeploy actif : chaque push sur `main` relance un build.

## Fichiers de déploiement

- `Dockerfile` : build multi-stage (Node 22 + npm vers nginx 1.27 alpine + Node pour `/ws`).
- `nginx.conf` : service statique, fallback SPA, cache, `gzip_static`, proxy WebSocket `/ws`.
- `server/` : salon WebSocket (port interne 8787).
- `security-headers.conf` : en-têtes de sécurité et CSP.
- `.dockerignore`.

Le conteneur écoute sur le **port 80**.

## Réglages dans Dokploy

| Réglage | Valeur |
| --- | --- |
| Provider | Github, repo `saintespeed`, branche `main`, trigger On Push |
| Build Type | Dockerfile, chemin `Dockerfile`, contexte `.` |
| Domain | `speed.mathieumont.cc`, path `/`, container port **80** |
| HTTPS | activé, certificat Let's Encrypt |

## Les données OSM sont dans l'image

`public/` embarque 7 Mo de JSON OSM (`sainte-buildings.json`,
`sainte-features.json`, `sainte.geojson`). Ils sont committés et copiés tels
quels dans `dist/` par Vite, donc servis depuis le conteneur : aucun appel
Overpass au runtime en fonctionnement normal.

Deux conséquences pour le déploiement :

- Le Dockerfile **pré-compresse** ces fichiers en `.gz` au build, et nginx les
  sert via `gzip_static`. Sans ça, nginx recompresserait 4 Mo de JSON à chaque
  requête froide.
- Leur cache est court (1 h, revalidation par ETag) parce que leur nom ne porte
  pas de hash : un `npm run fetch-osm` suivi d'un push doit être visible sans
  attendre l'expiration d'un cache long. Les assets `/assets/` hashés par Vite
  gardent, eux, un cache immuable d'un an.

## CSP

`security-headers.conf` pose une CSP active. `connect-src` autorise
explicitement les trois miroirs Overpass utilisés par le fallback runtime de
`src/lib/osm.ts` (`overpass-api.de`, `overpass.kumi.systems`,
`overpass.private.coffee`) : il ne sert que si les JSON de `public/`
manquaient, mais le laisser bloqué par la CSP transformerait une panne de
données en erreur muette.

Si vous ajoutez une source externe (police, image, analytics), il faut étendre
la directive correspondante, sinon le navigateur la bloque et le signale dans
la console.

## Vérifier l'image en local

```sh
docker build -t saintespeed .
docker run --rm -p 8080:80 saintespeed
# puis ouvrir http://localhost:8080
```
