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

Manette (mapping standard Xbox / DualSense) :

| bouton | effet |
| --- | --- |
| `RT` / `R2` / `A` | accélérer |
| `LT` / `L2` / `B` | freiner, puis marche arrière |
| stick gauche / croix | tourner |
| `X` / `RB` | frein à main |
| `Y` / `△` | replacer la voiture au dernier checkpoint |
| `Select` / `Share` | afficher ou masquer les bâtiments |

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

Les bâtiments viennent des emprises OSM (`building`) sur **toute la ville** :
57 630 emprises pour 9,9 Mo, dont 55 049 retenues au rendu. L'emprise a grandi
deux fois, d'abord jusqu'au nord de la ville, puis à la totalité une fois le
streaming en place.

Le bord nord était à 45,4415 : **la Cité du Design, Le Soleil, Montreynaud et
Geoffroy-Guichard renvoyaient tous zéro bâtiment**, les repères du nord
n'existaient tout simplement pas dans la scène. Overpass rend un 504 sur une
emprise de cette taille, donc le fetch bâtiments est découpé en 9 cases avec
**sous-découpage adaptatif** : une case qui échoue deux tours est recoupée en
quatre, jusqu'à trois niveaux, et chaque case est indépendante.

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

## Streaming par anneaux de distance

La ville entière fait **55 049 emprises, 2,00 M de triangles et 247 Mo de
tampons GPU**. Le frustum culling n'y change rien : il épargne le dessin, pas la
mémoire, et une géométrie cullée reste résidente. C'est donc la mémoire qui
bloquait, pas les draw calls.

La géométrie n'est plus construite d'un bloc au chargement. Les emprises sont
indexées en **1 467 tuiles de 240 m**, et chaque tuile est construite à la
demande selon sa distance au joueur, puis libérée derrière lui.

| anneau | niveau | contenu |
| --- | --- | --- |
| 0 à 300 m | plein | fenêtres, socle commerçant, coiffe |
| 300 à 700 m | réduit | sans socle, **coiffe conservée** |
| 700 à 1400 m | silhouette | une boîte par bâtiment, 1 draw call par tuile |
| au-delà | déchargé | |

Mesuré en rejouant la politique le long des axes réels, à 50 km/h, 2 000 ticks à
6 Hz :

| | chargement complet | streaming |
| --- | --- | --- |
| triangles résidents | 2,00 M | **93 k** |
| mémoire | 247 Mo | **12,3 Mo** |
| tuiles résidentes | — | médiane 141, max 148 |

Soit **20x moins de mémoire**. Trois propriétés vérifiées dans le même harnais :

- **Pas de clignotement.** L'hystérésis monte le détail à 300 m mais ne le
  redescend qu'à 350 m, 700/780 puis 1400/1550. Sur 5,6 minutes de trajet,
  **aucune tuile ne dépasse 8 changements de niveau** (max 7, médiane 3).
- **Pas de fuite.** Après téléportation hors carte, 0 tuile résidente.
- **Pas de saturation.** Le budget est de 3 tuiles construites par tick ; il
  n'est atteint que sur **2,8 %** des ticks, et la médiane est de 0.

La libération est **différée d'un tick**. Disposer dans le tick du remplacement
laisserait un maillage monté pointer sur une géométrie libérée jusqu'au prochain
rendu de React : on ajoute d'abord, on retire au tour suivant. La planification
vise un point **avancé le long du vecteur vitesse** (3 s, plafonné à 260 m), donc
ce qui est devant monte en détail plus tôt que ce qui est derrière.

**La coiffe de toit survit au niveau réduit, et ce n'est pas négociable.** À
moyenne distance c'est la silhouette qui porte l'identité, pas la couleur :
mesuré à travers tout le pipeline, le zinc du centre et la tuile du faubourg ne
sont plus qu'à **ΔE2000 5,6 à 700 m et 3,8 à 1 000 m**. Sans la coiffe, pierre et
faubourg deviennent le même prisme beige. En silhouette, le sommet de la boîte
est rétréci de 28 % sur les archétypes à toit en pente : ça rend la lecture
plat/pente **pour zéro triangle de plus**, et c'est le seul canal d'identité qui
survive au-delà de 700 m.

**Ce qui n'est pas fait, et pourquoi.** Le bake glTF + Draco + worker n'a pas été
écrit. La mesure dit que le gain mémoire vient à 90 % du fait de ne pas
construire les tuiles lointaines, ce que le générateur existant fait déjà très
bien : une tuile de 36 emprises coûte environ 1,3 ms. Le bake glTF sert la
**portabilité vers un client natif**, pas la performance navigateur, et il
supprimerait en plus le coût du cache JSON parsé en mémoire (les 9,9 Mo de
`sainte-buildings.json` restent résidents pour pouvoir générer à la demande).
C'est un choix à faire pour cette raison-là, pas pour débloquer le navigateur.

## Qualité de rendu : descente mesurée, pas devinée

La scène de nuit tient son aspect de quatre passes plein écran (bloom à flou
mipmap, tone mapping ACES, vignette, grain) posées sur une cible HDR en
**MSAA 4x**. Sur un GPU dédié ça passe. Sur un GPU intégré c'est la bande
passante qui plafonne, et pas du tout la géométrie : mesuré sur un **Intel
Iris Xe en 1389x945 à dpr 1, 36 fps**, alors que la géométrie résidente ne pèse
que 200 draw calls et 76 k triangles.

Le niveau n'est donc pas choisi sur le matériel, qu'on ne peut pas interroger de
façon fiable depuis le navigateur, mais sur la **frame médiane mesurée** sur une
fenêtre de 90 frames. Si elle dépasse 21 ms (47 fps), on descend d'un cran.

| niveau | MSAA | dpr max | grain |
| --- | --- | --- | --- |
| haute | 4 | 2 | oui |
| moyenne | 0 | 1,5 | oui |
| basse | 0 | 1 | non |

L'ordre des renoncements suit le coût, pas le goût. **Le MSAA d'abord** : le plus
cher, et le moins identitaire sur une scène sombre déjà grainée. **La densité de
pixels ensuite**, qui divise le remplissage sans toucher à la composition. **Le
grain en dernier**, parce qu'il ne coûte qu'une passe et fait beaucoup pour
l'aspect photographique. Le bloom n'est jamais coupé : sans lui les fenêtres
allumées, les beffrois et les feux de balisage ne sont plus que des taches
plates.

La descente est **à sens unique**. Remonter dès qu'on repasse sous le budget
ferait osciller le MSAA au gré du trafic de tuiles, et une bascule visible
toutes les deux secondes est pire qu'un cran de qualité en moins. Le niveau se
réévalue au rechargement. La politique est pure (`src/lib/quality.ts`) et
vérifiée dans Node : descente sur régime lent, aucune descente sur un hoquet de
streaming isolé (la médiane l'absorbe), jamais de remontée.

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

**Pierre et faubourg divergent volontairement.** Ce sont les deux archétypes
les plus proches en teinte et à eux deux ils couvrent 89 % du bâti, donc s'ils
fusionnent la variété disparaît. La pierre est passée à `#ddd6c2`, un crème plus
froid, et le faubourg à `#c4ac82`, un ocre plus chaud et plus sombre : sous la
lumière de nuit et le brouillard, les valeurs d'origine se rejoignaient dans le
même beige.

**Réflexion spéculaire du moderne : écartée.** La spec demandait `roughness 0.3`.
La scène n'a qu'une `hemisphereLight` et une directionnelle rasante à 0,9, et
aucune environment map : un lobe spéculaire n'aurait rien à réfléchir, il
produirait un unique point brillant au lieu d'une lecture de verre, pour le coût
d'un matériau standard à la place d'un Lambert. Le moderne se distingue par son
albédo froid et la teinte froide de ses fenêtres.

**Repères posés à la main.** Dix-neuf bâtiments reçoivent une configuration
bespoke qui écrase l'archétype, relevée par id OSM dans le cache et non devinée :
l'Hôtel de Ville, la Platine, le Zénith, l'ancienne Manufacture d'Armes, la
cathédrale Saint-Charles, l'Opéra, le musée d'Art et d'Industrie, le chevalement
du Puits Couriot, la centrale Manufrance, les trois emprises de la gare
Carnot, puis la Bourse du Travail, les Nouvelles Galeries, la Préfecture, la
Comédie, Centre Deux, Châteaucreux et le Palais Mimard. Geoffroy-Guichard n'y figure pas : **le stade n'est pas
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

### L'ancre distinctive par place

Une fois le caractère du vide posé, un seul élément fort et correct par lieu
suffit à confirmer le match. Le type d'ancre change d'une place à l'autre, et
c'est normal.

| place | ancre | état |
| --- | --- | --- |
| Peuple | bande piétonne en pierre appareillée | **13 surfaces en pierre contre 23 en bitume** dans 200 m |
| Peuple | fontaine de la place du Peuple | way 1300735962, **à 32 m** |
| Jaurès | cathédrale Saint-Charles | way 63322493, repère posé |
| Jaurès | les fontaines devant | ways 582876118 / 582876124, **à 49 m**, bassin de 10,3 m de rayon |
| Jaurès | le kiosque | **« Kiosque à musique de Marengo »**, way 161467265, à 31 m |
| Carnot | le grand parc | way 211462275, 8 366 m², à 9 m |
| Carnot | l'axe Jules Janin | boulevard `secondary`, passe sur la place |
| Carnot | la gare | 3 emprises `operator=SNCF`, repères posés |

**Le bug qui cachait les ancres n'était pas celui qu'on croyait.** La spec
supposait que la cathédrale et la gare manquaient à cause des relations
multipolygones. Vérification faite, les deux sont de simples ways présentes
depuis le début. Ce qui manquait vraiment, c'est que **`amenity=fountain` est
cartographié en `way` quand c'est un bassin**, et l'import ne prenait que les
nœuds : il ratait donc précisément les trois fontaines qui comptent, celle du
Peuple et les deux devant la cathédrale. Corrigé, la ville passe de **10 à 34
fontaines**, et le rayon vient maintenant du bassin réel au lieu d'être
constant, parce qu'une fontaine de place et une fontaine à boire ne font pas la
même tache au sol.

Aucun objet n'a eu besoin d'être posé à la main : le kiosque que la spec
prévoyait d'ajouter aux vraies coordonnées **existe dans OSM** sous le nom
« Kiosque à musique de Marengo », et « Ô Kiosque » (`building=kiosk`) est déjà
rendu avec sa vitrine allumée. La seule table d'overrides est celle des repères
bâtis, où la gare Carnot a été ajoutée : ses trois emprises sont anonymes dans
le cache et ne se distinguent que par `operator=SNCF`.

Et là, la crainte de la spec était fondée, mais sur le bon bâtiment : **une des
trois emprises de la gare Carnot est une relation multipolygone** (rel 1000824,
215 m²) et n'existait donc pas avant le correctif.

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

## Les familles de silhouettes

Les repères de `src/lib/landmarks.ts` sont bespoke, un kit par monument. Ça
ne passe pas à l'échelle, et surtout le déficit était ailleurs. Un export
Overpass curaté du patrimoine stéphanois (`export.geojson`, 642 features) le
chiffre : **197 emprises notables, dont 87 de patrimoine ou de culte, et quatre
seulement étaient traitées**. Les 55 lieux de culte de la ville sortaient en
boîtes de pierre sombres, sans clocher ni flèche, alors que c'est exactement ce
qui se lit de loin sur une ville de collines.

Premier constat en ouvrant l'export : **il n'apporte aucune donnée
géométrique**. Ses 54 `building:levels` et ses 8 `roof:shape` sont déjà dans
`public/sainte-buildings.json`, au champ près. Ce qu'il apporte est un signal de
**notabilité** : lieu de culte, monument historique, nom. `npm run build-notable`
le fige en `src/lib/notable.ts` (197 entrées, 196 retrouvées dans le cache),
versionné comme le reste des données dérivées pour ne pas dépendre d'Overpass au
build.

Ce signal décide d'une **famille de kit**, posée sur n'importe quelle emprise du
type. Comptes relevés par le harnais headless sur les 55 049 emprises, pas
estimés :

| Famille | Emprises | Ce que le kit pose |
| --- | --- | --- |
| culte | 55 | nef à deux pentes, clocher, flèche octogonale, abside, beffroi éclairé, rosace ; dôme et minaret pour les mosquées |
| halle | 286 | toiture en sheds, la couverture manufacturière stéphanoise, cheminée de brique sur les sites classés |
| gare | 2 | marquise, verrière de hall, horloge sur les deux pignons |
| grand ensemble | 1 533 | cage d'ascenseur, édicules techniques, antenne, feu de balisage rouge au-delà de 35 m |

Les kits **s'ajoutent** à l'extrusion de l'emprise, qui reste la vérité du plan,
au lieu de la remplacer : ils n'écrivent que dans les tampons pleins et lumineux,
jamais dans les murs texturés. Une seule exception, assumée : la **hauteur des
nefs**. La table `inferLevels` est calée sur du logement et donnait 9 m à une
église de 1 500 m² ; une règle d'emprise bornée la remplace, ce qui donne des
murs gouttereaux de 7 à 18 m (médiane 15,3).

Deux détails qui ne sont pas des choix de style. Le **clocher va à l'ouest** :
une église est orientée, chœur à l'est, et le signe de `cos(rot)` de l'axe
principal suffit à savoir de quel côté poser la tour. Et la hauteur du clocher se
dimensionne sur la racine de la surface, pas sur la hauteur de nef : celle-ci
sature à 18 m dès 900 m², et toutes les grandes églises sortaient alors avec
exactement le même clocher de 36 m. Avec un tirage de ±8 % seedé sur l'id, les
flèches se répartissent de 17 à 51 m, médiane 37.

À 1 876 emprises, pas question de construire ces kits une fois pour toutes comme
les monuments bespoke : ils passent par les **tuiles**, donc par le streaming, et
suivent le niveau de détail. Au-delà de 700 m la masse est conservée (une flèche
sur la ligne d'horizon est précisément ce qui fait reconnaître la ville) mais les
lumières sont abandonnées, et les verrières de sheds basculent en volume plein
pour ne pas laisser la toiture ajourée. Le coût mesuré est de **64 000 triangles
sur la ville entière, 520 au pire dans une tuile de 240 m**, contre 2,00 M pour
les emprises seules.

## Sept silhouettes relevées, pas déduites

Une famille déduit ses proportions de l'emprise. Un repère bespoke tient ses
cotes d'un relevé, et c'est toute la différence. Sept silhouettes majeures sont
passées en bespoke le 2026-08-14, sur sources (Wikipédia, site de la ville, base
Mérimée) :

| bâtiment | ce que dit la source | ce qui sortait avant |
| --- | --- | --- |
| **Bourse du Travail** | 1901, Léon Lamaizière. Corps central de cinq travées, deux ailes à pavillons d'angle, pierre de taille de Saint-Paul-Trois-Châteaux. Façades, toitures et **péristyle** inscrits MH en 2002 | boîte de verre moderne à 9,3 m |
| **Les Nouvelles Galeries** | 1894, Lamaizière. Art nouveau, ossature de fonte, angle en tourelle. 3 000 m² sur trois niveaux | pierre à 12,4 m, sans l'angle |
| **Préfecture de la Loire** | 1895-1902, néoclassique. Quadrilatère à pavillons d'angle, deux niveaux sur socle, baies cintrées au premier | **archétype faubourg à 9,3 m**, soit un pavillon de banlieue |
| **La Comédie** | 2017, StudioMilou. Salle de 700 places, plateau de 400 m², **cage de scène de 28 m** en polycarbonate opaque qui rayonne de l'intérieur | barre de logement à 12,4 m |
| **Centre Deux** | inauguré en 1979 sur le terrain de l'ancienne prison. 39 000 m² commerciaux, grands volumes en **brique rouge** | verre moderne sur 26 400 m² d'emprise |
| **Gare de Châteaucreux** | 1882-1884, Joseph-Antoine Bouvard pour le PLM. Ossature métallique hourdée de **briques polychromes**, plan en U, entrée sous marquise, importante horloge | **3,1 m de haut** : OSM la tague `building:levels=1` |
| **Le Palais Mimard** | 1893, Lamaizière, pour le rubanier Adrien David. Seul édifice **néo-gothique** de la ville, brique et pierre, plan en U | pierre à 15,5 m, sans toiture ni lucarnes |

Trois choses que la recherche a corrigées, et qui auraient été fausses écrites de
mémoire. La Bourse du Travail n'est pas art déco des années 30 mais
**néoclassique de 1901**. Le dôme des Nouvelles Galeries a brûlé puis a été
**retiré dans les années 1960**, en même temps que la façade passait sous bardage
métallique : on pose donc la tourelle écimée, exactement comme l'Hôtel de Ville
n'a pas son dôme détruit en 1952. Et Centre Deux date de **1979**, pas de 1971.

**L'orientation des façades est mesurée.** Un péristyle ou une marquise posés sur
la mauvaise façade regardent un mur. Pour chaque emprise, la distance des quatre
milieux de façade au réseau routier réel a été comparée. La Préfecture sort côté
sud, ce que confirme la source (bâtie au nord de l'ancienne place Marengo,
aujourd'hui place Jean Jaurès). Le Palais Mimard sortait ambigu, 30 contre 34 m,
tranché par la position relevée de la place Anatole France au sud du bâtiment.
La tourelle des Nouvelles Galeries est posée sur le sommet d'emprise le plus
proche d'un carrefour, en local (38, -19).

Coût : 1 048 triangles pour les sept kits, et ils sont construits une fois pour
toutes avec les autres repères, hors streaming.

## Regarder un kit sans GPU

```bash
npm run elevation                        # l'Hôtel de Ville
npm run elevation -- 63319547 --from=y+  # un autre repère, une autre façade
npm run elevation -- --list              # les ids disponibles
```

On ne peut pas regarder un kit dans le jeu depuis un terminal : un onglet qui
n'est pas au premier plan gèle `requestAnimationFrame`, le canvas reste noir, et
même au premier plan il faut conduire jusqu'au monument. Les kits se relisaient
donc dans le code au lieu de se regarder.

`npm run elevation` dessine l'élévation d'un repère en vue orthographique de
face, depuis le parvis, **sans three.js ni GPU** : un rastériseur de triangles et
l'algorithme du peintre, dans un JPEG. Il ne montre ni les textures de façade ni
le bloom, seulement la géométrie et les éléments lumineux, c'est-à-dire
exactement ce qu'un kit décide. Le résultat se compare directement aux photos de
`reference/photos`.

Le premier usage a immédiatement payé : **l'orientation de l'Hôtel de Ville était
fausse de 12,5°**. Son nu de façade coupait l'emprise en biais et n'en touchait
qu'un coin, si bien que le perron, les arcades et les statues se posaient à côté
du bâtiment. Personne ne l'avait vu tant que la façade n'avait pas été dessinée.

### La reprise de l'Hôtel de Ville

Le premier jet tenait sur les bons faits (Dalgabio, 1822-1830, plan carré à cour,
perron au sud, sept arcades, La Métallurgie et La Rubanerie de Montagny en 1870
et 1872) mais se trompait sur quatre points que les photos tranchent :

| ce que faisait le kit | ce que montre la photo |
| --- | --- |
| un pavillon d'horloge à fronton surmonté d'un **campanile à dôme** | rien de tout ça. Le dôme de 51 m de Boisson, qui abritait l'horloge et sa cloche, a brûlé en 1952 et a été démoli en 1953 : le couronnement est **plat**, avec un simple cadran au centre de l'attique |
| les deux statues plantées **10 m devant, sur le parvis** | sur de hauts socles **en haut du perron**, encadrant l'arcade |
| un perron de 3,5 m en **sept marches**, soit des contremarches de 50 cm | seize marches larges et basses |
| la travée centrale élargie | les sept arcades sont **égales** |

L'infidélité du campanile était même assumée dans un commentaire du code (« on
évoque un campanile modeste ») au lieu d'être vérifiée. La reprise ajoute ce que
la photo montre et que le kit n'avait pas : la colonnade d'ordre colossal de
l'étage noble et ses sept hautes fenêtres cintrées, le balcon continu, la frise,
l'attique à panneaux, et les deux passages voûtés des ailes au niveau de la
place. La hauteur de corniche passe de 16 à 18,5 m, mise à l'échelle sur la
largeur de façade mesurée (49,3 m), pour 22,7 m au sommet du cadran.

### L'origine d'un kit est le centre de la bbox, pas le centroïde

Repéré à l'œil sur l'élévation : les deux passages voûtés des ailes de l'Hôtel de
Ville n'étaient pas à la même distance des bords. Or un édifice néoclassique est
strictement symétrique, c'est la définition même de sa composition.

La cause n'était pas dans le kit mais dans le repère. `frameOf` plaçait son
origine sur le **centroïde du contour**, et un kit compose une façade autour de
`x = 0`. Le centroïde d'une emprise réelle n'est presque jamais au milieu de sa
façade : mesuré sur les douze repères bespoke, l'écart va de **1,9 m** (Palais
Mimard) à **19,1 m** (Nouvelles Galeries), et vaut 2,4 m sur l'Hôtel de Ville.
Les douze kits étaient donc désaxés, à des degrés divers.

L'origine est maintenant le **centre de la bbox** : `minx` vaut exactement `-w/2`
et `maxx` vaut `+w/2`, donc écrire `x = 0` dans un kit, c'est écrire « sur
l'axe ». Un seul endroit corrigé, douze kits redressés, plus les 1 876 emprises
à famille qui utilisent le même repère.

### Une façade générique ne doit jamais couvrir une composition monumentale

Repéré sur une capture en jeu : au-dessus des grandes baies cintrées de l'Hôtel
de Ville apparaissait **une rangée de petites fenêtres carrées**, et la trame
continuait derrière l'arcade. Deux façades superposées, une ordinaire sous la
monumentale.

La cause : l'avant-corps du corps central était posé avec le **skin texturé**.
Or cette texture porte la trame de fenêtres courantes de l'archétype, celle qui
convient à un immeuble de rapport et pas à un édifice néoclassique, dont le corps
central n'a que ses arcades, ses baies cintrées et son attique. Une boîte
texturée de 18,5 m de haut repeignait donc la trame par-dessus tout le kit.

L'avant-corps est maintenant en pierre pleine, et le kit ne contient plus **aucun
triangle texturé**. Vérifié sur les douze repères : les seules surfaces texturées
restantes sont au-dessus des corniches (pavillons d'angle, attiques, lucarnes),
là où une trame de fenêtres est juste. Les deux exceptions qui descendent au sol,
le Zénith et le chevalement, sont en `replaceBase` : leurs murs *sont* le
bâtiment, il n'y a rien dessous.

Réglage fait en même temps : quatorze grandes baies sur une seule façade, c'est
deux fois plus de surface lumineuse que sur n'importe quel autre repère, et sous
le bloom le rez-de-chaussée fusionnait en un bandeau blanc sans forme. Les baies
de l'Hôtel de Ville ont leur propre valeur, juste au-dessus du seuil, et les
arcades sont un peu plus étroites : on lit les arcs et les trumeaux.

### La gare Carnot était au sol, elle est aérienne

Signalé en jeu : « la gare Carnot est au sol ». C'était le problème, et le kit en
était la cause. Il en faisait une **gare de pierre du XIXe siècle**, campanile
central, horloge sur ses deux faces, flèche et grandes baies voûtées. La source
dit tout autre chose :

> La gare est **mise en service le 28 septembre 1980**, par l'architecte
> M. Beynet. C'est une **gare aérienne construite sur un viaduc**, place Sadi
> Carnot, avec **deux quais de 150 m** couverts d'un **encadrement métallique
> orange composé de vitres** qui ouvre la vue sur le centre-ville.

Son fait architectural principal est donc d'**être en l'air**, et c'est
exactement ce qui manquait.

La donnée OSM contenait pourtant l'essentiel : les deux auvents de quai, mappés
en `building=roof`, **63 m sur 2 à 2,6 m, espacés de 10,3 m**. Le rendu courant
en faisait deux murs pleins de 9,3 m de haut le long des quais, ce qui est
précisément l'impression de gare écrasée. Ils passent en `replaceBase` et le kit
leur rend leur section : piles, tablier, quai éclairé, encadrement orange vitré.
Le bâtiment voyageurs, lui, quitte l'archétype pierre pour le moderne : il est de
1980 et en béton.

Deux valeurs ne sont pas sourcées et sont assumées comme telles. La **hauteur du
tablier** (9,5 m) est la valeur courante d'un viaduc ferroviaire urbain, aucune
source ne donne le tirant d'air. La **longueur du tablier** vient d'une mesure :
le couloir bâti est libre de 75 m à l'ouest, et à l'est le tablier s'encastre
dans le bâtiment voyageurs, ce qui est bien la manière dont une gare aérienne
tient. Les quais réels font 150 m, OSM n'en cartographie que 63 : on ne couvre
que ce qui est cartographié.

### Le viaduc vient du tracé ferroviaire réel

Le premier jet posait un tablier à la main sur un couloir mesuré dans le bâti. Il
s'arrêtait donc dans le vide contre un bâtiment, et la question suivante est
tombée : peut-on le faire continuer **sans ajouter de relief à la ville** ?

Oui, parce qu'un viaduc n'est pas du relief mais un **ouvrage**, et parce que sa
géométrie était dans OSM depuis le début. Le fetch ne tirait que les routes, les
bâtiments et le décor : `npm run fetch-osm -- rail` ajoute les voies ferrées.

| mesure | valeur |
| --- | --- |
| tronçons ferroviaires sur la ville | 244, soit 79 459 m |
| dont **en l'air** (`bridge` ou `layer > 0`) | 43 tronçons, **2 175 m** |
| voie aérienne à moins de 600 m de la gare Carnot | 1 418 m |
| écart entre le tracé réel et le centre des quais | **1,8 m** |
| azimut du tracé / des auvents cartographiés | 8,0° / 7,8° |

Les deux sources se recoupent à 0,2° près, ce qui valide l'ensemble : le kit de
la gare ne pose plus que ce qui lui est propre (élargissement du tablier, quais,
abri orange), et le viaduc lui-même est construit sur le tracé réel par
`src/scene/Viaduct.tsx`.

Quatre règles tiennent la crédibilité, toutes imposées par une mesure, et trois
d'entre elles viennent de signalements de terrain sur la version précédente :

- **Le tablier ne se pose jamais sur la route.** Il garde 5,6 m de tirant d'air
  au-dessus de toute chaussée, et la contrainte se propage à la pente de rampe :
  il remonte avant une rue et ne redescend qu'après. Avant cette règle,
  **171 points de tablier passaient sous 5,5 m**, dont beaucoup à 1,1 m.
- **Aucune pile sur une chaussée ni dans un bâtiment.** Un appui qui tombe mal
  glisse le long de l'ouvrage jusqu'à 6 m pour trouver un sol libre, et à défaut
  la travée est sautée. Sur 193 appuis théoriques, **66 tombaient sur une route
  ou dans une emprise**.
- **Les remblais courts sont avalés.** Un tronçon non tagué `bridge` qui relie
  deux travées et fait moins de 150 m fait partie de l'ouvrage : dans une ville
  sans relief, le viaduc ne peut pas s'interrompre là où le terrain montait.
  Ça allonge le viaduc de 2 174 à **2 767 m** et supprime des ruptures là où, sur
  le terrain, il y a un pont.
- **Un about ne redescend que si la ligne s'arrête vraiment.** La première
  version comparait les abouts aériens entre eux et se trompait : les 82 abouts
  en rampe avaient tous une voie ferrée à moins de 12 m. Il en reste **2**.

Reste une simplification assumée : les sections de remblai sont rendues comme du
tablier sur piles, faute de relief pour les porter.

Le tout est construit une fois, hors streaming, pour quelques milliers de
triangles : un ouvrage qui apparaîtrait par tuiles se verrait de loin.

### Les places du centre n'existaient pas dans la couche sol

Même piège que l'Hôtel de Ville, et il frappait les lieux les plus emblématiques :
`FEATURES_QUERY` ne demandait que des `way`, or **les places du centre sont
cartographiées en relation multipolygone**. Mesuré sur la ville : **44 relations
d'espace ouvert absentes**, dont **16 places nommées**.

| place | ce qu'elle est dans OSM | dans le jeu avant |
| --- | --- | --- |
| Jean Jaurès | relation, 20 562 m², 110 arbres | absente du sol |
| du Peuple | relation, 7 409 m², minérale | absente |
| Chavanelle | relation, 7 727 m² | absente |
| **de l'Hôtel de Ville** | relation, 6 724 m² | absente, alors que le perron donne dessus |
| Neuve, Fourneyron, Waldeck Rousseau, Jean Moulin, Jules Guesde, Jean Cocteau | relations | absentes |
| Dorian, Jacquard | `way` avec `area=yes` | présentes |

Le correctif est le même que pour les bâtiments : demander aussi les relations et
recoudre leurs anneaux (`stitchRings`, déjà écrit pour le bâti), en refermant le
contour parce que la boucle des surfaces ne garde que les anneaux fermés. **52
contours** arrivent par cette voie, et les surfaces piétonnes passent de 27 à
**78**.

Le gain n'est pas seulement qu'il y a du sol : `places.ts` classait déjà le
caractère des espaces ouverts (minéral, jardin, parc) et documentait le
découpage attendu, sans pouvoir l'appliquer faute de surfaces. Il tombe
maintenant juste : **Jean Jaurès en jardin**, **le Peuple en minéral**, le parvis
de l'Hôtel de Ville en minéral. Les 110 arbres relevés dans le contour de Jean
Jaurès recoupent les 114 comptés à l'époque dans un rayon de 120 m.

Note de terrain : Overpass a rendu 504 sur ses quatre miroirs au premier tour.
Les retries du script ont fait le travail au second.

### La place Jean-Jaurès, objet par objet

Premier lieu traité au niveau exigé : pas une couche de statues instanciées, mais
huit objets nommés, chacun avec sa source à côté de sa géométrie
(`src/lib/monuments.ts`).

**Ce que dit la source.** La place, ancienne **place Marengo** (nommée le 14 mars
1801, devenue Jean-Jaurès le 30 décembre 1919), est aménagée dès l'origine en
jardin public avec bassin, végétation et kiosque. C'est l'une des seules places
stéphanoises qui possède encore des bassins. Le **kiosque à musique de Marengo**
(MH, PA00117602) est construit en **1870 par Mazerat**, architecte de la ville,
puis **entièrement reconstruit en 1914** en réemployant toute la **fonte**
d'origine. Sur **chaque face**, un cartouche porte le nom d'un compositeur :
Ravel, Bizet, Debussy, Saint-Saëns, Massenet, Gounod, Fauré, Berlioz, Lalo,
Chabrier. **Dix noms, donc dix pans** : la géométrie sort de la source, elle n'est
pas choisie. **Vénus** (Paul Belmondo) et **Apollon**, deux statues monumentales
posées en **1951**, qui ont fait scandale.

**Ce que la mesure a corrigé.** Le kiosque avait été parti sur un diamètre deviné
de 9 m. Le harnais a trouvé une **emprise OSM à 0,7 m** du point patrimoine :
way 161467265, `leisure=bandstand`, `roof:shape=conical`, MH inscrit le 2 février
1987, **99 m² pour 5,62 m de rayon équivalent**, contour de 20 sommets tracé au
cercle. Le kit est donc posé sur l'emprise (`replaceBase`) et son rayon en sort ;
seul le nombre de pans reste celui de la source. Sans ça, le kiosque sortait en
**boîte générique de 3,1 m avec une trame de fenêtres**, au milieu du jardin.

Autre chose que seule la mesure donnait : **Daphné est à 1,4 m du centre du
bassin de 8,8 m**. Ce n'est pas une statue posée à côté d'un bassin, c'est une
statue **de** bassin, et elle se pose dans l'eau.

**Ce qui n'est pas sourcé est écrit comme tel** : hauteur des colonnes de fonte,
cotes des socles, silhouettes des figures. Les statues sont des silhouettes à
hauteur de voiture, pas des portraits. Ce qui est fidèle, c'est leur position,
leur type (buste sur colonne contre statue en pied), leur matière quand OSM la
donne, et le fait qu'elles diffèrent entre elles. L'éclairage des bassins et du
kiosque est un choix assumé : de nuit, une vasque non éclairée est un trou noir.

`npm run elevation -- kiosque-marengo` (ou n'importe quelle clef d'objet sans
emprise) dessine l'objet seul, à l'échelle, avec une silhouette de 1,70 m comme
étalon.

### Les objets ponctuels : 49 posés, 212 écartés avec une raison

L'export patrimoine contient **261 points isolés**. Les poser tous en props
instanciés aurait été exactement ce qu'on refuse. Le tri est donc mesuré, et ce
qui est écarté l'est pour une raison écrite dans le fichier généré :

| écarté | pourquoi |
| --- | --- |
| 23 musées et galeries, dont **20 à l'intérieur d'un bâtiment** | ce sont des points d'intérêt, il n'y a rien à poser dans la rue |
| 18 points de vue | ce n'est pas un objet |
| 17 tombes | dans les cimetières |
| 11 lieux de culte en point, dont 10 dans un bâtiment | doublon des emprises déjà traitées par la famille culte |
| 6 plaques, 5 peintures murales | c'est sur un mur, pas dans l'espace |
| 32 points « autres » | ce sont des noms de gare et de place |
| **40 sculptures contemporaines** | **leur forme est ce qu'aucune étiquette ne détermine** |
| 8 œuvres postérieures à 1950 taguées `statue` | même raison, et le filtre par type seul les laissait passer |
| 2 déjà posées par un kit bespoke | les reposer les mettrait en double |

Ce dernier point est le plus important. « Les Femmes Noires » de Ndary Lo, « Pouet »
de Rémy Jacquier ou « Une Île Suffisante » d'Ervin Patkaï ne se déduisent pas d'un
tag `artwork_type=sculpture`. Les inventer serait précisément la faute qu'on
évite ailleurs. Elles méritent un traitement individuel sur source, comme les
monuments, et attendront.

**Le filtre par type seul ne suffisait pas.** « Les Femmes Noires » de Ndary Lo
(2005), citée juste au-dessus comme l'exemple même de ce qu'on refuse d'inventer,
sortait en statue sur socle du XIXe parce qu'OSM la tague `artwork_type=statue`.
Mesure : 21 des 57 points retenus étaient des `tourism=artwork`, dont 8
postérieurs à 1950. C'est la **date** qui coupe, pas l'auteur : une statue
académique d'avant-guerre suit une typologie dont la forme découle vraiment du
type, une œuvre d'après 1950 n'en suit aucune.

**Et un objet était posé deux fois.** La Rubanerie est en haut du perron de
l'Hôtel de Ville, posée par le kit du monument avec La Métallurgie (Étienne
Montagny, 1870 et 1872) ; la couche ponctuelle la reposait en silhouette
générique à son point OSM. Seule La Métallurgie y échappait, et par accident,
parce que son point tombe dans l'emprise.

Restent **49 objets de typologies où la forme découle du type** : croix de chemin
(14), monument aux morts (10), stèle (6), buste (6), statue (13). Une croix de
chemin est un fût sur un emmarchement avec sa croix, un monument aux morts un
obélisque sur socle à ressauts, une stèle une dalle dressée. Le tag OSM porte la
forme, et les hauteurs varient de ±10 % sur une graine tirée des coordonnées.

Deux détails de méthode. **Un objet de bord de route peut tomber dans la chaussée
du jeu**, dont la largeur est une convention de dessin : il est poussé
perpendiculairement du minimum nécessaire plutôt que jeté, parce que c'est sa
position qui est juste. Un seul cas, une croix à 2,4 m de l'axe d'un chemin dont
la demi-chaussée fait 2,5 m. Et **tout est fusionné en deux maillages** : passés
par le mécanisme des repères, ces 49 objets auraient coûté jusqu'à 150 draw
calls, contre 194 pour la ville entière. Ils en coûtent deux, pour 5 640
triangles.

`npm run elevation -- type:croix` dessine une typologie seule, à l'échelle.

### La Cité du Design : La Platine, sa tour, la Manufacture

**Ce que dit la source.** La Platine est de **Finn Geipel et Giulia Andi**
(agence LIN), prix spécial du jury de l'Équerre d'argent 2009, sur le site
historique de la Manufacture nationale d'armes. Elle mesure **193,2 m sur 31 m**,
un seul grand espace, sous une enveloppe de **triangles équilatéraux à dix types
de panneaux** (opaques, translucides, photovoltaïques, ventilants). La **tour
observatoire monte à 32 m** pour un panorama à 360°.

**Ce que dit la donnée.** L'emprise OSM de la Platine mesure **193,7 × 31,2 m**
avec un remplissage de 0,99. La source et le cadastre se recoupent **au
décimètre**, ce qui vaut validation croisée. Et la tour est là aussi, id
172156092, 12 × 10 m, **hauteur 31 m taguée** : on garde le tag, c'est une mesure
locale.

**Ce que ça corrige.** Les deux sortaient avec une trame de fenêtres peinte. Or
la photo de référence est sans ambiguïté : la Platine n'a **aucune fenêtre**,
c'est une surface claire et mate d'un seul tenant. Le kit ne peint pas de
triangles, ce qui demanderait une texture ; il enlève la trame (`unlit`) et pose
ce qui reste vrai de nuit, **la lueur diffuse des panneaux translucides**, plus
l'acrotère. La tour reçoit son **belvédère vitré**, qui est la raison d'être d'un
observatoire.

**La Manufacture d'Armes**, elle, sortait à 9,3 m. OSM la donne à trois niveaux,
mais ce sont des niveaux **industriels**, hauts : mise à l'échelle sur la largeur
de 13,8 m relevée dans OSM, la corniche de la photo tombe vers **15 m**. La table
`inferLevels` est calée sur du logement et rate d'un tiers ici. Le kit ajoute sa
**toiture à croupes en tuile**, ce qui a demandé une primitive de plus
(`addHipped`) : deux longs pans trapézoïdaux et deux croupes à 45°, utile aussi
aux 17 emprises taguées `roof:shape=hipped`.

## Aller voir en vrai : les postes de relevé

```bash
npm run field                      # calcule les postes, écrit la planche
npm run field -- --list            # un sujet par ligne, dans le terminal
npm run field -- import <dossier>  # range des photos sur leur EXIF
```

Sur les **17 repères bespoke posés sur une emprise, 6 seulement ont une photo**
dans `reference/photos` : Hôtel de Ville, Platine, Manufacture, Zénith,
Châteaucreux, Nouvelles Galeries. Les onze autres ont été modélisés sur du
texte. Ce que ça coûte est déjà chiffré plus haut : la reprise de l'Hôtel de
Ville, c'est un campanile inventé, deux statues à dix mètres de leur place et un
perron de sept marches au lieu de seize. Aucune de ces erreurs n'était une erreur
de rendu, toutes venaient de l'absence d'image. Et `reference/NOTES.md` note
qu'il n'y a rien d'utilisable sur Commons pour les grands ensembles.

`npm run field` ne produit pas une liste de courses, il calcule un **poste de
prise de vue**. Il part du repère du jeu (`frameOf`, même centre de bbox, même
`rot` mesuré), prend la façade que le kit compose, recule de ce qu'il faut pour
la cadrer au téléphone, et rend **une position GPS et un cap boussole**. Une
photo prise à ce poste se superpose au rendu de `npm run elevation`, affiché en
regard sur la planche : on compare, on n'apprécie pas.

**82 sujets, 98 postes** : les 17 repères sur emprise, le stade et les 7 objets
de la place Jean-Jaurès, et les 49 objets ponctuels, regroupés par typologie
puisque leur forme découle de leur type.

### Ce que le relevé vérifie, et ce qu'il ne peut pas vérifier

Le recul n'est pas théorique. À partir du **nu de façade réel** (l'intersection
de la ligne de visée avec le contour, et non le milieu de la face de bbox, qui
tombe hors du bâtiment dès que l'emprise est en L), le poste s'écarte mètre par
mètre et s'arrête sur deux critères : une **emprise bâtie qui coupe la ligne de
vue**, et l'**espace public** (chaussées hors voies rapides, rues piétonnes,
chemins, places, parcs, parkings). Trois conséquences mesurées :

| sans le test | avec |
| --- | --- |
| Centre Deux à **243 m** de recul, à travers trois îlots | **6 postes**, 265 m de façade couverts sur 321 |
| Nouvelles Galeries à **3 m** de recul, le nu de bbox tombant chez le voisin | **12 m**, la largeur réelle de la rue |
| Daphné photographiée à **3 m**, c'est-à-dire depuis le bassin | **11 m**, sur la margelle |

Le sens de l'appareil est calculé, pas laissé au hasard : la cathédrale fait 30 m
de large pour 40 m de haut, le paysage demande **81 m** de recul et le portrait
**58 m**, ce qui décide si la photo est possible depuis le parvis.

Le nombre de postes se décide sur **neuf sondages** répartis le long de la
façade, pas sur une mesure prise au milieu : le recul disponible varie trop pour
qu'un seul point le résume. Quand aucun sondage ne cadre plus de 8 m, le relevé
arrête de découper et le dit, plutôt que d'aligner huit postes de quatre mètres :
sous le viaduc de Carnot, le quai sud fait 63 m et il s'en photographie 40.

Ce que le relevé **ne sait pas** : ce qui bouche la vue en dehors du bâti. Ni les
arbres, ni les travaux, ni les camions. Au-delà de 80 m de recul il le dit et
laisse trancher sur place. Il ne connaît pas non plus les horaires : une grille
fermée reste une grille fermée.

### La façade principale était dans la ligne de commande

`npm run elevation` prenait le côté à regarder en `--from=`, retapé à chaque
rendu. C'était une mesure qui ne vivait nulle part. Elle est maintenant portée
par le repère (`LANDMARKS.face`, dix repères sur dix-sept), relevée sur ce que
chaque kit compose, et `elevation` la suit par défaut.

La dériver automatiquement ne marche pas, essai à l'appui : la règle naturelle
« la façade la plus proche d'une rue » désigne le côté est de l'Hôtel de Ville,
alors que son perron donne au sud, parce que **la place devant lui est piétonne
et n'existe donc pas dans la couche des routes**. Pour les sept volumes
symétriques qui ne composent aucune façade (une tour, une halle, un auvent de
quai), le côté est choisi par la mesure, sur le critère « d'où voit-on le plus de
sujet » et non « quel côté est le plus accessible » : l'auvent du quai sud de
Carnot fait 63 m de long sur 2,6 m de large, et le photographier par son pignon
est parfaitement accessible et parfaitement inutile.

**Le champ `face` a fait apparaître un bug du rendu d'élévation** : les deux
côtés x étaient inversés, `--from=x+` dessinait la façade x−. Personne ne l'avait
vu tant que tout se rendait depuis `y-`. La Préfecture le montre à l'œil nu, ses
sept baies cintrées sont sur le bout x+ et n'apparaissaient qu'en demandant x−.

### La planche, et le retour

`reference/field/index.html` est une page autonome (images en data URI, aucun
appel réseau) faite pour être ouverte dehors, sur un téléphone : les postes
triés par distance, le cap à viser sur une rose qui suit la boussole, l'élévation
du kit en regard, et **les questions que la photo doit trancher**. Ces questions
ne décrivent pas le bâtiment, elles sortent de ce que le code affirme sans
source : « la cage de scène de 28 m, sa position dans l'emprise est déduite,
faute de plan », « hauteur de 9,3 m : inférence, aucune source ne la donne »,
« les quatre pinacles aux coins du transept : le kit les pose, la source ne les
mentionne pas ».

Au retour, `npm run field -- import` lit l'EXIF (position, cap de la boussole au
déclenchement, focale, date), rattache chaque photo à un sujet et la range dans
`reference/terrain` avec son manifeste. Le rattachement se fait sur la distance
au **poste**, pas au centre du sujet : une photo prise pile au poste de l'Hôtel
de Ville tombe à 76 m de son centre, et notée sur le centre elle était rattachée
à une statue voisine. Le cap sert de garde-fou, un sujet qu'on ne regardait pas
est écarté même si on était juste devant.

Le manifeste garde l'**écart entre le poste calculé et le poste réel**. C'est la
seule façon de savoir si un poste tenait debout sur le terrain, et donc si ce
relevé vaut quelque chose.

## Les trottoirs : ce qu'OSM en dit, et ce que la place permet

Première idée à écarter, parce qu'elle était fausse : « OSM ne contient que les
chaussées, il faudra inventer les trottoirs ». C'est ce que dit `src/lib/osm.ts`,
mais ce fichier ne décrit que les tags **que le parseur garde**. Comptage fait
sur la vraie base : **1 440 rues sur 5 842 portent un tag `sidewalk`**, dont 917
des deux côtés, 229 à droite, 89 à gauche, et **205 qui disent explicitement
qu'il n'y a pas de trottoir**. Le tag apporte ce qu'aucune géométrie ne donne :
le **côté**. Il est tiré par `npm run fetch-osm -- voirie` dans son propre
fichier, clé par id de way, donc sans toucher à `sainte.geojson` ni au réseau
roulable.

Pour les 75 % de rues sans tag, la largeur vient de la place réellement
disponible. Mesure sur 10 073 milieux de segment dans 2,5 km du centre, distance
à la façade la plus proche **de chaque côté**, au-delà du bord de chaussée :

| classe | p10 | médiane | sous 1,5 m |
| --- | --- | --- | --- |
| residential | 2,1 m | 9,5 m | 6 % |
| secondary | 4,7 m | 16,0 m | 3 % |
| tertiary | 3,9 m | 16,5 m | 1 % |
| unclassified | 6,6 m | 17,5 m | 1 % |
| living_street | 1,8 m | 9,3 m | 7 % |

Une largeur fixe par classe rentrerait donc dans la façade une fois sur quinze en
rue résidentielle. Chaque côté est raboté sur un rayon lancé dans **l'index des
murs déjà construit pour la caméra**, ce qui ne coûte aucune structure nouvelle.

**Le rayon part de l'axe, pas du bord de chaussée.** La largeur de chaussée est
une convention de dessin et une façade tombe parfois dedans : parti du bord, le
rayon démarrait déjà dans le mur et ne voyait rien. Mesuré au harnais, **256
bandes finissaient dans une emprise ; il en reste 1** sur la ville entière.

### Le trottoir fait le tour du pâté de maisons

Première version : couper la bande à chaque carrefour et s'arrêter là. Résultat
regardé sur plan, et jugé à juste titre inutilisable, **le réseau se lisait en
pointillés**. Quatre défauts distincts, tous corrigés :

1. **Le trou de carrefour était deux fois trop grand.** Reculer de la
   demi-chaussée croisée plus un trottoir ouvrait près de 10 m de vide pour une
   rue de 5 m. Le trottoir s'arrête au bord de la chaussée qu'il traverse, et
   c'est tout : le reste du carrefour lui appartient.
2. **Il manquait le raccord d'angle.** Un trottoir tourne le coin. Les bouts qui
   arrivent à un même carrefour sont rangés par angle autour du nœud : deux
   bouts séparés de quelques degrés sont les deux moitiés d'un même coin, deux
   bouts séparés de 80 degrés sont les deux rives d'une chaussée et il doit
   rester le vide du passage piéton entre eux. **2 269 raccords** dans la zone
   jouable, 2,9 m² en moyenne.
3. **Une façade serrée coupait toute la bande.** Le seuil de largeur est passé
   de 0,80 m à 0,35 m, sans plancher de dessin : une bande de 40 cm au pied d'un
   immeuble est ce qui existe réellement, une rupture tous les 30 m ne l'est pas.
4. **Les coudes laissaient une encoche.** Des quads posés segment par segment ne
   raccordent pas leurs bords extérieurs dans un virage, et le résultat
   ressemblait à des dalles isolées. Le ruban est maintenant à onglets : le
   décalage se calcule sur la bissectrice au sommet, plafonné à 1,43 pour qu'un
   angle aigu ne déborde pas dans la façade.

Cinquième défaut, que le plan ne pouvait pas montrer parce qu'il ignore
l'enroulement : **une face sur deux était invisible en 3D**. Les bandes de gauche
et de droite s'enroulent en sens inverse et le matériau était en `FrontSide`.

La place libre est mesurée par **échantillons tous les 5 m le long de chaque
segment**, puis ramenée aux sommets pour que le bord extérieur reste continu.
Trois versions ont été nécessaires : par segment, le bord sortait en dents de
scie ; par sommet sur la normale moyenne, la mesure ne s'appliquait pas à la
direction réellement tracée et **74 bandes finissaient dans une emprise** ; par
échantillons, il en reste 9 sur 21 000.

Cette mesure lance 130 000 rayons dans l'index des murs à la construction, et
`WallIndex.clear` allouait un `Set` par appel : **1,6 s de construction, ramenée
à 0,57 s** en réutilisant un marqueur. La caméra, qui interroge le même index à
chaque frame, y gagne aussi.

### Les passages piétons ne sont pas déduits, ils sont relevés

C'est la seule couche de marquage du jeu qui ne soit pas une convention de
dessin. Saint-Étienne cartographie **4 762 passages piétons, dont 4 178 marqués
au sol**, ce qui est considérable pour de la donnée bénévole.

Le tri est mesuré. Sur les 4 178 marqués, **2 324 sont posés** dans la boîte
jouable : 1 499 sont hors boîte, 256 à plus d'une demi-chaussée de tout axe, donc
sur des cheminements piétons que le jeu ne rend pas, et 62 sont des doublons,
OSM cartographiant souvent le même passage en nœud **et** en ligne. Le
regroupement se fait par tronçon et par position le long de l'axe, jamais par
simple distance, sinon les quatre traversées d'un carrefour fusionneraient en
une.

**L'orientation est validée par la donnée, pas supposée.** La position vient d'un
nœud de la chaussée, à 0,0 m de l'axe en médiane : il n'y a rien à projeter,
seulement à orienter. La perpendiculaire à la rue est la règle évidente, et les
81 passages cartographiés en ligne permettent de la vérifier : l'angle entre la
ligne relevée et la tangente de la rue vaut **87 degrés en médiane et 90 au
p90**. Même méthode que l'azimut du viaduc, recoupé par les auvents de quai.

La forme vient du règlement (IISR, article 113-1) : des bandes blanches
**parallèles à l'axe** de la chaussée, larges de 0,50 m, espacées de 0,50 à
0,80 m. C'est ce qui fait qu'un conducteur voit des barres pointées vers lui et
non des barres en travers. Ce qui n'est pas sourcé et qui est annoncé comme tel :
la longueur du passage le long de la rue, qu'OSM ne porte pas, fixée au plancher
réglementaire de 2,50 m et portée à 4 m sur les axes.

Coût : 10 847 bandes, 22 000 triangles, **un seul draw call**, 7 ms. Vérification
au harnais : 3 bandes sur 10 847 débordent de la chaussée.

### Regarder et vérifier la voirie sans GPU

```bash
npm run voirie                     # les chiffres, boîte jouable puis ville entière
npm run voirie -- plan             # trois plans SVG dans reference/
npm run voirie -- plan 4.3874 45.4397 90   # un plan ailleurs, rayon en mètres
```

Les chiffres disent ce qu'aucune capture ne montre (combien de bandes tombent sur
une chaussée voisine, combien finissent dans une emprise), le plan dit où. C'est
le plan qui a révélé les dalles de carrefour, et les chiffres qui ont prouvé que
le rayon de rabotage partait du mauvais point.

## L'usage du sol : le vide n'est pas du vide

Entre une façade et la chaussée, il restait du **noir**. Mesure avant d'écrire
quoi que ce soit, grille de 1 m sur trois fenêtres de 16 ha, chaque cellule
classée par ce qui la couvre :

| fenêtre | bâtiment | sol vide | chaussée | trottoir | décor |
| --- | --- | --- | --- | --- | --- |
| hypercentre | 59,3 % | **14,6 %** | 6,5 % | 2,6 % | 16,9 % |
| tissu résidentiel | 35,3 % | **33,0 %** | 13,0 % | 7,1 % | 11,6 % |
| Châteaucreux | 6,1 % | **82,6 %** | 3,7 % | 2,5 % | 5,1 % |

La totalité de ce vide tombe dans un `landuse` OSM. Mais la couverture ne dit pas
la même chose selon la classe, et c'est ce qui a décidé du contenu de la couche :

| classe | polygones | surface | la plus grande |
| --- | --- | --- | --- |
| residential | 17 | 2 857 ha | **1 069 ha** |
| industrial | 11 | 793 ha | 261 ha |
| allotments | 26 | 24 ha | 3,3 ha |
| railway et quais | 20 | 28,6 ha | 27,7 ha |
| écoles, université, hôpitaux | 53 | 69 ha | 14,3 ha |
| friches et chantiers | 43 | 16 ha | 2,6 ha |

**`landuse=residential` est écarté.** Un seul de ses polygones fait 1 069 ha et
recouvre le centre entier : le peindre ne serait pas suivre la donnée, ce serait
repeindre la ville d'une teinte unique en se donnant l'alibi d'un tag. Les autres
classes, elles, désignent quelque chose de local, et c'est là qu'est la
reconnaissance : les jardins ouvriers sont une signature stéphanoise autant que le
tram, une friche n'est pas une cour d'usine, un ballast n'est pas un parking.

**Le classement se fait en queue de cascade** (`classifyArea`). Une emprise
ferroviaire ou industrielle englobe souvent un parc ou un parking déjà classés :
testée avant eux, elle aurait posé une dalle par-dessus le parc de Carnot, le
même piège que `place=square` avait déjà tendu. De même, les rangs de dessin sont
négatifs, de -3 pour l'industriel à 0 pour les friches : cette couche est un fond
de plan, jamais un dessus. Les quais font exception et remontent au-dessus du
ballast, comme les dalles qu'ils sont.

Résultat mesuré dans les mêmes fenêtres :

| fenêtre | vide avant | vide après | ce qui a comblé |
| --- | --- | --- | --- |
| Châteaucreux | 82,6 % | **22,6 %** | ballast 30,7 %, chantier 24,5 %, école 4,7 % |
| hypercentre | 14,6 % | 14,6 % | rien |
| tissu résidentiel | 33,0 % | 32,4 % | école 0,6 % |

Autrement dit la couche règle Châteaucreux et ne touche pas au reste, parce que
le vide qui reste est **entièrement** sous la couverture résidentielle. Ce
qu'elle coûte : 2 922 triangles, soit 10 % de plus sur la couche de sol, et
978 ha couverts contre 13 409 déjà dessinés.

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
| `amenity=fountain` nœuds + ways | 34 | posées, elles tombent sur les places |
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
scripts/build-notable.mjs  export.geojson -> src/lib/notable.ts (notabilité)
scripts/elevation.mjs   élévation d'un repère en JPEG, sans GPU (+ .entry.ts)
src/lib/rail.ts         voies ferrées, profil en long du viaduc et rampes
src/lib/monuments.ts    objets de place et typologies de l'espace public
src/lib/monumentPoints.ts  GÉNÉRÉ : les 49 objets ponctuels retenus
src/lib/project.ts      lat/lon <-> mètres (équirectangulaire locale)
src/lib/osm.ts          chargement, parsing, palette et largeurs par classe
src/lib/graph.ts        graphe routier + index spatial + nearestEdge
src/lib/car.ts          physique arcade et contrainte au réseau
src/lib/race.ts         checkpoints et placement de la voiture
src/lib/input.ts        clavier
src/lib/buildings.ts    emprises OSM, déduction des hauteurs, retrait de toit
src/lib/archetypes.ts   cascade d'archétypes de façade et palettes
src/lib/features.ts     décor OSM : sols triangulés, arbres, tram, mobilier
src/lib/sidewalks.ts    trottoirs et bordures : côté OSM, largeur bornée sur la façade
src/lib/voirie.ts       côté du trottoir et passages piétons relevés dans OSM
src/lib/places.ts       caractère des espaces ouverts : minéral / jardin / parc
src/lib/frame.ts        repère local d'une emprise (axe principal, bbox locale)
src/lib/notable.ts      GÉNÉRÉ : patrimoine, culte et noms depuis export.geojson
src/lib/families.ts     affectation d'une famille de silhouette à une emprise
src/lib/familyKits.ts   géométrie des familles : clocher, sheds, marquise, édicules
src/lib/landmarks.ts    kits bespoke des monuments (prime sur les familles)
src/lib/streaming.ts    politique de streaming : tuiles, anneaux, hystérésis
src/lib/quality.ts      niveaux de rendu et descente sur frame médiane mesurée
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
