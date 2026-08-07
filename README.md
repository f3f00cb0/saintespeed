# Sainté Speed

Jeu de course arcade sur le vrai réseau routier de Saint-Étienne, extrait
d'OpenStreetMap. La piste roulable est le graphe routier OSM, la physique est
arcade, la 3D est volontairement pauvre.

## Lancer

```bash
npm install
npm run dev
```

Le réseau est servi depuis `public/sainte.geojson` (déjà généré). Pour le
régénérer depuis Overpass :

```bash
npm run fetch-osm              # routes + bâtiments + décor
npm run fetch-osm -- roads     # routes seules
npm run fetch-osm -- buildings
npm run fetch-osm -- features  # sols, arbres, tram, mobilier
```

Si le fichier manque, l'appli retombe sur un appel Overpass au runtime.

## Commandes

| touche | effet |
| --- | --- |
| `Z` / `W` / `↑` | accélérer |
| `S` / `↓` | freiner, puis marche arrière |
| `Q` / `A` / `←`, `D` / `→` | tourner |
| `espace` | frein à main |
| `R` | replacer la voiture au dernier checkpoint |
| `B` | afficher ou masquer les bâtiments |

Le chrono démarre au premier coup d'accélérateur. Le clavier est mappé sur
`event.code`, donc AZERTY et QWERTY marchent tous les deux.

## Le circuit

Quatre portiques posés sur de vraies rues, snappés au réseau au chargement
(distance de snap mesurée : 0,0 à 0,2 m) :

1. **Place Anatole France** — départ et arrivée
2. **Cours Fauriel haut**
3. **La Métare** (bas du Cours Fauriel)
4. **Boulevard Daguerre**

Environ 4,4 km à vol d'oiseau, ~5,5 km parcourus. Aucun itinéraire imposé :
les checkpoints sont des cibles, à toi de trouver le chemin dans le réseau.

## La ville

Les bâtiments viennent des emprises OSM (`building`) sur une zone de 5,9 × 3,5 km
autour du circuit : 23 423 bâtiments pour 4,3 Mo, contre 57 428 sur la ville
entière. L'emprise doit rester large : une zone trop serrée faisait tomber la
ville dans le vide dès qu'on montait vers l'Hôtel de Ville.

Le bord nord est passé de 45,4415 à 45,465. L'ancienne limite coupait juste sous
la Manufacture, et **la Cité du Design, Le Soleil, Montreynaud et
Geoffroy-Guichard renvoyaient tous zéro bâtiment** : les repères du nord de la
ville n'existaient tout simplement pas dans la scène. L'élargissement a aussi
triplé le signal industriel, voir plus bas.

**Aucune texture n'est embarquée.** Les façades sont peintes au démarrage dans
un canvas : rangées de fenêtres, fenêtres allumées en émissif, une texture par
archétype. Le point clé est que les UV sont en mètres et non normalisées
(`U = distance le long du mur / largeur de tuile`, `V = hauteur / 18,6`, en
`RepeatWrapping`), ce qui aligne les rangées de fenêtres sur les étages quelle
que soit la taille du bâtiment, sans jamais étirer la texture. La largeur de
tuile dépend de l'archétype, ce qui donne gratuitement sa trame serrée au grand
ensemble et ses grandes ouvertures à l'atelier.

Le rez-de-chaussée n'est plus une rangée de la tuile. Il l'était, et le
`RepeatWrapping` vertical faisait donc **réapparaître la vitrine au sixième
étage** sur les 189 bâtiments qui dépassent 18,6 m. La tuile ne contient plus que
des étages courants, tous interchangeables, et le socle commerçant est une
géométrie séparée posée sur les seuls bâtiments que la donnée OSM désigne comme
commerçants.

Les hauteurs sont majoritairement déduites, mais plus devinées : à Saint-Étienne
seuls 0,05 % des bâtiments portent `height` et 10,9 % `building:levels`. Ceux-là
sont utilisés tels quels ; le reste est déduit de la surface au sol et de la
distance à l'Hôtel de Ville, avec un bruit déterministe seedé sur l'id OSM pour
que la ville soit identique d'un chargement à l'autre.

La table de déduction est **mesurée sur les bâtiments taggés**, croisée
surface × distance, et non posée à vue. Ça corrige deux erreurs de la version
précédente : les immeubles étroits (40-120 m²) sortaient à 1-2 niveaux là où OSM
en mesure 4, et les grandes emprises étaient plafonnées à 3 alors qu'elles font
4 à 5. Le gradient partait aussi du barycentre du circuit, à 1,5 km au sud-est
du centre, ce qui laissait justement le centre-ville en construction basse.

Une seule entorse à la mesure, assumée : dans les 300 premiers mètres on prend
le troisième quartile plutôt que la médiane. Saint-Étienne n'est pas Paris, son
hypercentre est mesuré à 4 niveaux de médiane et 5 au p75 ; viser la médiane
donnait un cœur de ville qui lisait bas. Le p75 reste une valeur relevée dans
OSM. Résultat : médiane 5 niveaux et p90 à 6 dans le cœur, contre 3 en
périphérie.

## Les archétypes de façade

Cinq strates architecturales stéphanoises, assignées par une cascade de tags OSM
dans `lib/archetypes.ts` : **pierre** (centre haussmannien crème), **brique**
(faubourgs miniers et manufacturiers), **barre** (grands ensembles), **moderne**
(Cité du Design, Zénith), **faubourg** (le tissu ordinaire). `archetypeFor()` est
une fonction pure, premier match gagne, du signal le plus fiable au plus
heuristique. Aucune façade n'est colorée au hasard : tout descend d'un tag OSM,
d'une jointure spatiale, ou à défaut d'un hash déterministe de l'id OSM.

La cascade a été **calée sur un comptage préalable des emprises**, pas sur
une intuition. Trois mesures ont changé la conception :

| signal supposé | bâtiments atteints | verdict |
| --- | --- | --- |
| `building:material` | 4 | gardé en tête de cascade, ne pilote rien |
| `building:colour` | 7 | idem |
| `building=industrial\|warehouse` | 118 | trop peu pour faire exister la brique |
| `landuse=industrial` (jointure) | **1 534 (6,8 %)** | **treize fois le tag, c'est lui qui porte la brique** |
| `landuse=residential` (jointure) | 20 145 (89 %) | c'est la ville entière, zéro pouvoir discriminant, écarté |
| POI `shop`/`amenity` à 40 m | 1 729 (7,7 %) | rez commerçant |
| bord d'axe `primary\|secondary` | 2 333 (10,4 %) | rez commerçant |

Les jointures spatiales (POI → bâtiment, zone → bâtiment, axe → bâtiment) sont
faites **hors ligne dans `fetch-osm.mjs`**. Le navigateur reçoit un simple drapeau
par bâtiment au lieu de refaire 23 000 tests de point-dans-polygone au
chargement.

Répartition obtenue, en nombre et en surface de façade, qui est ce qu'on voit
réellement :

| archétype | bâtiments | surface de façade |
| --- | --- | --- |
| faubourg | 17 397 (76,7 %) | 42,0 % |
| pierre | 2 880 (12,7 %) | 21,9 % |
| barre | 1 278 (5,6 %) | 21,6 % |
| brique | 914 (4,0 %) | 11,4 % |
| moderne | 213 (0,9 %) | 3,1 % |

Lecture par quartier, sur 200 m : Hôtel de Ville **69 % pierre**, place Dorian
**64 % pierre**, Montreynaud **48 % brique**. Le cœur lit bien comme un centre
pierre et les zones d'activité comme de la brique.

**Une entorse assumée, chiffrée, sur l'archétype barre.** La spec le décrivait à
8-16 niveaux. Or seuls 95 bâtiments portent `building:levels >= 8`, et ils ne
sont pas dans les grands ensembles : le centre en compte 10, La Métare 3. La
morphologie au sol ne rattrape pas le coup, testé et rejeté : « plus grand côté
≥ 50 m » prédit `levels >= 8` avec **18 % de précision et 15 % de rappel**, et
les 259 emprises longues et étroites hors centre ont une médiane taguée de
3 niveaux, ce sont des ateliers et des rangées, pas des barres. L'archétype barre
ne touche donc **que la matière et la trame de fenêtres**. Les hauteurs restent
celles de `inferLevels`. Vérifié après coup : p50 9,3 m, p90 15,5 m, p99 18,6 m,
max 68,2 m, identiques au chiffre près avant et après.

**Réflexion spéculaire du moderne : écartée.** La spec demandait `roughness 0.3`.
La scène n'a qu'une `hemisphereLight` et une directionnelle rasante à 0,9, et
aucune environment map : un lobe spéculaire n'aurait rien à réfléchir, il
produirait un unique point brillant au lieu d'une lecture de verre, pour le coût
d'un matériau standard à la place d'un Lambert. Le moderne se distingue par son
albédo froid et la teinte froide de ses fenêtres.

**Repères posés à la main.** Neuf bâtiments reçoivent une configuration bespoke
qui écrase l'archétype, relevée par id OSM dans le cache et non devinée :
l'Hôtel de Ville, la Platine, le Zénith, l'ancienne Manufacture d'Armes, la
cathédrale Saint-Charles, l'Opéra, le musée d'Art et d'Industrie, le chevalement
du Puits Couriot, la centrale Manufrance. Geoffroy-Guichard n'y figure pas : **le stade n'est pas
tagué `building` dans OSM**, il n'existe donc pas dans les emprises. Le vert-noir
ASSE ne se justifierait nulle part ailleurs, ce serait un gadget.

Les édifices cultuels et le chevalement sont rendus sans fenêtres allumées. Les
fenêtres étant peintes dans la texture de l'archétype, donc partagées, on ne peut
pas en baisser le nombre pour un seul bâtiment ; leurs murs pointent en revanche
sur le carré de mur nu de la texture, ce qui donne exactement la silhouette
sombre attendue d'un clocher.

Chaque toit reçoit un couronnement, sinon un bâtiment n'est qu'un polygone
extrudé et la silhouette est trop nette contre le ciel. Le centre et le faubourg
reçoivent une pente fakée (bandeau incliné vers un contour rentré), le grand
ensemble et le moderne un acrotère droit : la silhouette aide autant que la
couleur à distinguer les strates.

Le contour rentré recule chaque sommet le long de sa bissectrice, avec une
limite de biseau. À 1,5 m de retrait fixe, **2 843 emprises sur 20 102 (14 %)**
s'auto-intersectaient et retombaient à plat. Le retrait est donc proportionné à
la taille de l'emprise puis réduit tant qu'il échoue : 1 → 0,6 → 0,35 → 0,2. Il
ne reste que **31 abandons (0,2 %)**. `insetRing` vit dans `lib/buildings.ts` et
non dans le rendu, précisément pour que ce réglage se mesure dans Node sur les
22 682 emprises réelles.

La géométrie est découpée en paquets de 400 m pour que three.js puisse faire
son frustum culling, et par archétype à l'intérieur d'un paquet puisqu'ils ne
partagent pas leur texture : 156 paquets, 756 maillages, 871k triangles,
construits en 790 ms au chargement. Touche `B` pour couper les bâtiments.

**Rendu HDR.** Le tone mapping du renderer est désactivé (`NoToneMapping`) et
l'ACES est appliqué en dernier effet du composer, après le bloom. Sans cet ordre
le bloom travaille sur une image déjà écrasée et bave à peine. Les fenêtres
sortent de l'intervalle [0,1] via `emissiveIntensity`, avec une variation
d'intensité par fenêtre écrite directement dans la carte émissive, sinon on
obtient une grille de lampes identiques une fois le bloom appliqué.

Note de compatibilité : `@react-three/postprocessing` v3 exige R3F v9 et React 19.
Le projet est en R3F v8, il faut donc rester en **v2.16.x**.

**Occlusion ambiante : écartée, mesuré.** La `SSAO` de `postprocessing` exige
`enableNormalPass`, qui rend toute la géométrie une seconde fois. Sur cette scène
ça coûte **26 fps fixes** (76 → 50), et c'est bien le passage normales et non
l'échantillonnage : à 4 samples et quart de résolution le coût est identique. Le
gain visuel est quasi nul, une ville de nuit à éclairage plat n'ayant presque pas
de cavités visibles. La rampe verticale ci-dessous fait déjà l'essentiel du
travail d'un AO, gratuitement. Si tu veux la réactiver malgré tout, il faut
accepter ~50 fps.

**Vignette et grain.** Placés après le tone mapping, donc en LDR. Le grain est
sans `premultiply` : sinon il s'annule dans les noirs, or la scène est
majoritairement noire. Il trame au passage le dégradé du ciel, qui bandait
légèrement. Coût négligeable.

**Dégradé vertical des façades.** Il ne vient pas de la `hemisphereLight` :
un mur a une normale horizontale, il reçoit donc partout le même mélange
ciel/sol et reste un aplat. Le dégradé est écrit dans la couleur de sommet en
fonction de la hauteur (`ramp` dans `Buildings.tsx`), pied sombre et
couronnement clair.

**Phares.** La chaussée est en `MeshBasicMaterial`, aucune lumière ne l'éclaire.
Les phares sont donc un quad additif texturé posé à plat devant la voiture, dans
son repère local, qui suit le cap tout seul. Les optiques avant et les feux stop
utilisent des couleurs supérieures à 1 pour franchir le seuil du bloom, et les
feux stop montent en intensité au freinage.

**Éclairage.** Un ciel en dégradé (sphère vue de l'intérieur, texture peinte en
canvas) donne la profondeur du fond, et le brouillard se cale sur la couleur
d'horizon pour que les lointains s'y fondent. Environ 6 000 lampadaires sont
posés le long des axes, en trois maillages instanciés : mât, tête lumineuse, et
flaque de lumière additive au sol. C'est la flaque qui fait le travail
d'ambiance.

Chaque mât est décalé depuis l'axe de sa propre rue, ce qui le fait tomber en
pleine chaussée dès qu'une rue étroite croise un boulevard large. Chaque
position est donc testée contre le réseau (`nearestEdge`) et poussée vers
l'extérieur, ou abandonnée : **1 531 mâts sur 10 085 tombaient sur le bitume**.

Coût mesuré : 871k triangles pour les bâtiments, 243k pour les routes et leurs
43 301 traits d'axe.

## La couche reconnaissance : le caractère du vide

Cible : quelqu'un qui **connaît** Saint-Étienne mais n'arrive pas à raccrocher
ce qu'il voit à la carte qu'il a en tête. L'information est déjà dans sa
mémoire, le travail est de lui donner assez de points d'accroche corrects pour
déclencher le match. Ce n'est donc pas la peine de prouver que c'est Sainté avec
des monuments : il le sait déjà.

Ce qui sépare deux places de loin, avant tout détail lisible, c'est le
**caractère du vide**, parce que c'est comme ça qu'un habitant range sa mémoire :
minéral resserré, jardin clos arboré, parc ouvert. `characterFor()` dans
`lib/places.ts` tague chaque espace ouvert en MINÉRAL / JARDIN / PARC depuis les
tags OSM, et le rendu répartit la distinction sur les canaux qui survivent à la
distance : couleur de sol, clôtures, allées.

| canal | MINÉRAL | JARDIN | PARC |
| --- | --- | --- | --- |
| sol | `#565049` gris chaud dur | `#2b3324` vert grisâtre | `#2c3d22` pelouse franche |
| clôture | aucune | **rendue, c'est sa signature** | aucune |
| allées | aucune, tout se marche | ornementales | gravier clair sur la pelouse |

Résultat du test, caractère dominant pondéré par la surface dans un rayon de
130 m, Dorian servant de témoin :

| place | attendu | obtenu |
| --- | --- | --- |
| Place du Peuple | minéral | **minéral 100 %** |
| Place Jean Jaurès | jardin | **jardin 62 %**, minéral 38 % |
| Place Carnot | parc | **parc 77 %** |
| Place Dorian (témoin) | minéral | **minéral 79 %** |

### Deux corrections que la mesure a imposées

**`place=square` ne doit pas être une surface.** C'est une emprise de nommage,
pas un revêtement. La place Sadi Carnot est un `place=square` de **17 282 m²**
qui englobe le parc de **8 366 m²** ; la peindre en dalle posait une plaque
minérale par-dessus le parc et faisait lire Carnot comme une place dure, soit
exactement l'inverse de ce qu'elle est. Le test est passé de `minéral 69 %` à
`parc 77 %` en la retirant.

**La clôture ne peut pas être exigée pour un jardin.** C'est bien le canal le
plus discriminant quand il existe, mais **OSM ne cartographie aucune barrière
autour de Jean Jaurès** : 0 m mesuré dans 130 m. L'exiger renvoyait la place en
minéral, donc indistinguable du Peuple. Ce qui sépare réellement Jaurès, ce sont
les arbres, **132 dans 130 m contre 21 au Peuple et 23 à Dorian**, et ses
plates-bandes de 283 à 501 m². La clôture est donc un signal *suffisant*, jamais
*nécessaire*. Un massif de moins de 1 200 m² compte comme jardin et non comme
parc, sans quoi les plates-bandes de Jaurès peignaient la place en pelouse.

Sur 99 km de barrières cartographiées, **270 lignes soit 17 km** longent un
espace ouvert et sont seules embarquées ; les allées retenues sont les 665 dont
le milieu tombe dans un espace ouvert, soit 36 km. Les deux jointures sont
faites hors ligne dans `fetch-osm.mjs`.

### Les relations multipolygones

Les bâtiments à cour intérieure sont cartographiés en **relation multipolygone**
et non en way. L'import ne prenait que les ways, donc ils n'existaient pas :
**l'Hôtel de Ville (relation 5201020, 3 861 m²) était purement absent de la
scène**, avec la Préfecture de la Loire, la Cité Grüner et 170 autres contours.
Les ways membres sont recousus bout à bout ; les anneaux intérieurs sont ignorés,
un bâtiment plein valant très largement mieux qu'un bâtiment absent. Les contours
issus de relations portent l'id OSM **en négatif** pour ne pas collisionner avec
les ids de way.

En revanche, contrairement à ce qu'on pouvait craindre, ce bug ne bloquait aucune
des ancres des trois places : la **cathédrale Saint-Charles** (way 63322493) et
la **gare de Châteaucreux** (way 63322681) sont de simples ways, présentes depuis
le début.

## Le décor

Avant d'écrire une ligne de rendu, les couches ont été **comptées** sur la bbox
de travail. C'est ce qui a décidé lesquelles valaient le coup :

| couche | compte | verdict |
| --- | --- | --- |
| `natural=tree` / `tree_row` | 4 260 / 153 | couche n°1 |
| `highway=pedestrian` | 179 | remplit les places |
| `highway=footway` + `area=yes` | 2 | inutilisable, ignoré |
| `leisure` park/garden/pitch | 584 | oui |
| `landuse` grass/forest/meadow/cemetery | 284 | oui |
| `amenity=parking` | 753 | oui |
| `natural=water` | 113 | oui |
| `railway=tram` | 128 | signature stéphanoise |
| `amenity=fountain` | 10 | posées, elles tombent sur les places |
| `highway=street_lamp` | 760 | plus maigre que le procédural, écarté |
| `barrier` au contact d'un espace ouvert | 270 (17 km) | signature du jardin |
| allées dans un espace ouvert | 665 (36 km) | signature du parc |

Le piège des places : sur les 179 `highway=pedestrian`, **50 seulement sont des
contours fermés**. Les 129 autres sont des lignes, et c'est le secteur piétonnier
du centre. Autour de l'Hôtel de Ville il n'y a aucun polygone piéton à moins de
300 m : tout le pavage vient de ces polylignes, élargies à 9 m au rendu. Les
jeter laissait le centre en trou noir même une fois les places bouchées.

Chaque polygone est triangulé avec `earcut` et posé à plat entre le sol de base
(-0,4 m) et la première couche de route (0,06 m), donc visible mais toujours sous
la chaussée. Une géométrie fusionnée par nature de sol, 8 couches pour 1 849
surfaces.

Les arbres et les poteaux de caténaire sont des `InstancedMesh` (5 323 arbres,
1 433 poteaux). Les `tree_row` sont échantillonnés tous les 9 m : c'est la seule
densification, et elle reste calée sur une feature OSM réelle, jamais du décor
posé au hasard. Échelle et rotation varient par instance, seedées sur l'index.

Le tram est à l'écartement métrique (1 000 mm), pas au standard 1 435 :
Saint-Étienne est l'un des rares réseaux français dans ce cas, la voie est donc
visiblement étroite et c'est juste.

## Structure

```
scripts/fetch-osm.mjs   Overpass -> public/sainte.geojson + sainte-buildings.json
                        + sainte-features.json
src/lib/project.ts      lat/lon <-> mètres (équirectangulaire locale)
src/lib/osm.ts          chargement, parsing, palette et largeurs par classe
src/lib/graph.ts        graphe routier + index spatial + nearestEdge
src/lib/car.ts          physique arcade et contrainte au réseau
src/lib/race.ts         checkpoints et placement de la voiture
src/lib/input.ts        clavier
src/lib/buildings.ts    emprises OSM, déduction des hauteurs, retrait de toit
src/lib/archetypes.ts   cascade d'archétypes de façade et palettes
src/lib/features.ts     décor OSM : sols triangulés, arbres, tram, mobilier
src/lib/places.ts       caractère des espaces ouverts : minéral / jardin / parc
src/scene/              rendu three.js (routes, sols, bâtiments, arbres, tram,
                        voiture, portiques, caméra)
src/state/store.ts      zustand
src/ui/Hud.tsx          chrono, compteur, boussole checkpoint
```

## Notes techniques

**Projection.** Équirectangulaire locale calée sur le barycentre du réseau,
`x = (lon-lon0)·cos(lat0)·R`, `y = (lat-lat0)·R`. L'erreur est négligeable à
l'échelle de la ville. Repère métrique x=est, y=nord ; le rendu mappe vers
three.js en `(x, hauteur, -y)`.

**Graphe.** Les nœuds sont dédupliqués en quantifiant la position projetée à
0,1 m, ce qui recolle les ways partageant un nœud OSM. Résultat sur Sainté :
37 250 nœuds, 39 161 segments, 4 338 carrefours de degré ≥ 3, et 99 % des
nœuds dans une seule composante connexe. L'index spatial est une grille de
cellules de 40 m ; `nearestEdge` fait une recherche par anneaux croissants et
s'arrête dès qu'aucun anneau plus lointain ne peut faire mieux (~8 µs par
requête, identique au brute force sur les tirages testés).

**Palette.** `ROADS` dans `src/lib/osm.ts` reste la palette de l'étape 0, calée
pour une vue ortho de dessus où le clair sert à lire la hiérarchie. En vue basse
et de nuit, une chaussée claire devient l'objet le plus lumineux de la scène, on
la ramène donc vers l'asphalte au rendu (`nightTint` dans `Roads.tsx`). La
palette de référence n'est pas touchée, seul l'affichage l'est.

**Bras de caméra.** La caméra de poursuite teste le trajet voiture vers caméra
contre les murs et se rapproche devant l'obstacle, avec un verrou dur après
lissage : sans lui, la caméra traverse encore un mur pendant qu'elle rattrape sa
cible. Le test se fait en 2D contre un index de segments de murs (`buildWallIndex`),
pas en raycast sur la géométrie : un bâtiment est un prisme vertical, comparer la
hauteur du mur à celle de la caméra suffit, et c'est bien moins cher que 340k
triangles.

Mesuré sur un tour complet : **28,4 % des frames avaient la caméra dans un
bâtiment, contre 0 % après**.

Contre-intuitif mais vérifié : rapprocher la distance minimale de la caméra
*augmente* le clipping. Sur 330 frames du tour la voiture est elle-même dans une
emprise, parce que les largeurs de chaussée sont approximées et débordent sur les
bâtiments ; une caméra très proche reste alors dans le mur, alors qu'un recul
minimal de 5,2 m l'en sort. En position rentrée la caméra monte au lieu de
descendre et son point visé se rapproche, sans quoi la voiture sort du cadre.

**Contrainte voiture.** Chaque frame, la voiture cherche l'edge qu'elle suit :
elle garde l'edge courant tant qu'elle roule vraiment dessus, enchaîne sur le
plus aligné avec le cap en sortie de segment, et retombe sur une recherche
spatiale pondérée par l'alignement sinon. Hors chaussée, elle est ramenée
doucement vers l'axe et freinée, proportionnellement au dépassement.

Attention si tu retouches ça : garder l'edge courant avec une tolérance large
(quelques mètres de plus que la chaussée) colle la voiture à une rue qu'elle a
quittée, et le rappel la fait tourner en rond autour. La tolérance doit rester
la largeur réelle du ruban.

## Données

Données © contributeurs OpenStreetMap, sous [ODbL](https://opendatacommons.org/licenses/odbl/).
L'attribution est affichée dans l'UI. Pas de tuiles Google, pas de
photogrammétrie.
