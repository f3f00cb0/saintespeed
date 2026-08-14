# Références façades — observations et calage

Ce dossier ancre l'apparence des bâtiments sur le vrai Saint-Étienne : des
photos du terrain (Wikimedia Commons, `photos/`), une mesure objective des
couleurs (`npm run palette-reference`), et une planche de comparaison servie
par Vite (`reference/index.html`, visible pendant `npm run dev`).

## Le workflow

```bash
npm run fetch-reference            # (re)télécharge la sélection curatée + manifeste
npm run fetch-reference -- --list  # liste les candidates par catégorie Commons
npm run palette-reference          # mesure les couleurs dominantes par archétype
npm run dev                        # puis ouvrir /reference/index.html
```

- La sélection des photos est curatée en dur dans `scripts/fetch-reference.mjs`
  (déterministe, comme le reste du projet). Pour ajouter une photo : repérer le
  titre Commons avec `--list`, l'ajouter à `SELECTION`, relancer.
- `photos/manifest.json` porte la provenance : licence, auteur, page d'origine.
  Les photos restent hors de `public/` : outil de dev, jamais dans le build.
- La planche peint les façades avec **le même code que le jeu**
  (`src/lib/facades.ts`), en simulant ce que fait le GPU : albedo × couleur du
  mur, rampe d'ombre verticale, fenêtres allumées additives.

## Limites des mesures

Les photos sont prises de jour, souvent par ciel couvert : les couleurs sont
désaturées et le ciel est retiré du calcul, mais pas les ombres portées. Le jeu
est de nuit, sous une lumière froide ; on ne cherche donc pas l'égalité de
teinte mais la bonne **famille** de couleur (chaude/neutre/froide, saturée ou
non). Les vitres éteintes, en journée, reflètent le ciel : leur bleu mesuré
renseigne surtout sur la réflexion, pas sur l'aspect nocturne.

## Calage du 2026-08-07 (première passe)

Mesures `palette-reference` sur les 15 photos, clusters dominants des familles
« murs clairs » et « matière saturée », comparés aux `STYLES` de
`src/lib/archetypes.ts`.

### pierre

- Mesuré : gris-beige neutre `#918f8c` / `#73706f`, très peu de jaune ;
  zinc sombre `#2e2e2d` ; vitrages gris-bleu `#353a47`.
- Le crème `0xddd6c2` du jeu était franchement jaune à côté de la pierre
  réelle, qui tire au maximum sur un beige-gris.
- Décision : murs déjaunis en beige-gris clair, vitres éteintes bleu-gris.
  Le zinc du toit était déjà juste.

### brique

- Mesuré : briques en familles sombres et peu saturées `#4c3529`, `#684d33` ;
  les parties pierre/enduit sortent en gris neutre `#90908e`.
- Les rouges du jeu étaient plausibles mais uniformément vifs ; la brique
  manufacturière réelle est plus sombre et brune, surtout côté cour.
- Décision : palette brique assombrie avec une variante brune, vitres éteintes
  bleu-gris comme partout.

### barre

- Mesuré : bétons gris **froids** `#b4b4b5`, `#babcc2` (panoramas).
- Le jeu utilisait un gris chaud `0x9a9488` : sous la lumière bleue de nuit il
  convergeait vers le faubourg.
- Décision : palette béton refroidie (gris légèrement bleuté), pour garder la
  distinction barre/faubourg mesurée de jour comme de nuit.

### moderne

- Mesuré : gris neutres `#908f90`, `#b0afaf` (Platine), vitrages `#343a48`.
- Déjà cohérent avec le jeu ; rien de bougé hors l'harmonisation des vitres.

### faubourg

- Mesuré : enduits neutres à peine chauds `#908676`, `#8e8e8e`, avec des
  accents rougeâtres `#6c362d` (enduits anciens, briques).
- L'ocre `0xc4ac82` du jeu était trop saturé par rapport aux façades réelles,
  même en tenant compte du ciel couvert des photos.
- Décision : ocre rabattu vers un beige-gris, une pointe de chaleur en moins.

### Vitres éteintes (tous archetypes)

- Mesuré : les vitrages réfléchissent en bleu-gris `#343a48`…`#464b53` partout.
- Les `dark` du jeu tiraient au vert/kaki pour la pierre et le faubourg.
- Décision : toutes les vitres éteintes passent en bleu-gris sombre, chaque
  archetype gardant un léger écart pour rester lisible.

## Fait en même temps que le calage

- **Variation des façades** (2026-08-07) : chaque bâtiment décale désormais sa
  tuile de façade d'un nombre entier de travées et d'étages, seedé sur son id
  OSM (`src/scene/Buildings.tsx`, `du`/`dv`). Les niveaux restent alignés et
  les fenêtres entières aux angles, mais deux bâtiments d'un même archétype ne
  montrent plus jamais la même trame de fenêtres allumées. C'est ce qui cassait
  le plus la crédibilité : la même façade répétée tous les 18,6 m.

## Prochaines pistes (non faites)

- **Relief** : normal map procédurale (fenêtres enfoncées, bandeaux saillants),
  supportée par MeshLambertMaterial en three 0.169.
- **Photos manquantes** : pas de vraie photo de rue des grands ensembles
  (Montchovet, Beaulieu) sur Commons ; les panoramas servent de pis-aller.
  Compléter la sélection si de meilleures sources apparaissent.
