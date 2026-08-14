// Planche de comparaison : les facades generees par le meme code que le jeu
// (src/lib/facades.ts), a cote des photos du vrai Saint-Etienne. Page de dev,
// servie par `npm run dev` sur /reference/index.html — jamais dans le build.
//
// La simulation reproduit ce que fait le GPU : albedo multiplie par la couleur
// du mur (vertex color), puis les fenetres allumees ajoutees en emissif. La
// rampe verticale d'ombrage du pied de facade est approximee en degrade.

import { ARCHETYPE_NAMES, STYLES, type Archetype } from "../src/lib/archetypes";
import { paintFacade, paintShopFront, FLOOR, CELL_PX, FLOORS_PER_TILE } from "../src/lib/facades";

type PhotoRef = {
  archetype: string;
  file: string;
  title: string;
  license: string;
  artist: string;
  page: string;
};

const ROLES: Record<string, string> = {
  pierre: "Le centre autour de l'Hôtel de Ville : pierre de taille crème, toit en zinc.",
  brique: "Les faubourgs miniers et manufacturiers : brique rouge-brun, grandes ouvertures.",
  barre: "Les grands ensembles des années 60-70 : béton délavage, trame serrée, beaucoup de fenêtres allumées.",
  moderne: "Cité du Design, Zénith, promotions récentes : gris froid, grandes baies vitrées.",
  faubourg: "Le tissu ordinaire : enduit beige, toit en tuile, souvent un commerce en rez.",
};

const hexCss = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/**
 * Bande de facade simulee : 2 tuiles de large, 1 tuile de haut (6 etages).
 * Ordre des compositing identique au shader : mur -> albedo (multiply) ->
 * rampe d'ombre (multiply) -> fenetres emissives (lighter).
 */
function paintStrip(facade: ReturnType<typeof paintFacade>, wall: number): HTMLCanvasElement {
  const tw = facade.albedo.width;
  const th = facade.albedo.height;
  const out = document.createElement("canvas");
  out.width = tw * 2;
  out.height = th;
  const c = out.getContext("2d")!;

  c.fillStyle = hexCss(wall);
  c.fillRect(0, 0, out.width, out.height);

  c.globalCompositeOperation = "multiply";
  for (let i = 0; i < 2; i++) c.drawImage(facade.albedo, i * tw, 0);

  // pied de facade dans l'ombre, couronnement expose (ramp() du jeu : 0.62 -> 1)
  const grad = c.createLinearGradient(0, th, 0, 0);
  grad.addColorStop(0, "rgb(158,158,158)");
  grad.addColorStop(1, "rgb(255,255,255)");
  c.fillStyle = grad;
  c.fillRect(0, 0, out.width, out.height);

  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < 2; i++) c.drawImage(facade.glow, i * tw, 0);
  c.globalCompositeOperation = "source-over";

  return out;
}

function photoBlock(refs: PhotoRef[]): HTMLElement {
  const div = document.createElement("div");
  div.className = "reelles";
  const h3 = document.createElement("h3");
  h3.textContent = "Réelle — photos du terrain";
  div.appendChild(h3);

  if (!refs.length) {
    const p = document.createElement("p");
    p.className = "vide";
    p.textContent = "Aucune photo téléchargée pour cet archetype : npm run fetch-reference";
    div.appendChild(p);
    return div;
  }

  const photos = document.createElement("div");
  photos.className = "photos";
  for (const r of refs) {
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = `photos/${r.file}`;
    img.alt = r.title;
    img.loading = "lazy";
    const cap = document.createElement("figcaption");
    const link = document.createElement("a");
    link.href = r.page;
    link.target = "_blank";
    link.textContent = r.title.replace(/^File:/, "");
    cap.appendChild(link);
    cap.append(` — ${r.artist}, ${r.license}`);
    fig.append(img, cap);
    photos.appendChild(fig);
  }
  div.appendChild(photos);
  return div;
}

const main = document.querySelector("#planche")!;

let manifest: PhotoRef[] = [];
try {
  const res = await fetch("photos/manifest.json");
  if (res.ok) manifest = (await res.json()) as PhotoRef[];
} catch {
  /* pas encore de photos : la planche affiche quand meme les facades generees */
}

for (let i = 0; i < ARCHETYPE_NAMES.length; i++) {
  const arch = i as Archetype;
  const name = ARCHETYPE_NAMES[i];
  const style = STYLES[arch];
  const facade = paintFacade(style);

  const section = document.createElement("section");
  const h2 = document.createElement("h2");
  h2.textContent = name;
  const role = document.createElement("p");
  role.className = "role";
  role.textContent = ROLES[name] ?? "";
  section.append(h2, role);

  const face = document.createElement("div");
  face.className = "face";

  const genere = document.createElement("div");
  genere.className = "genere";
  const h3 = document.createElement("h3");
  h3.textContent = "Générée — paintFacade()";
  genere.appendChild(h3);

  const nuancier = document.createElement("div");
  nuancier.className = "nuancier";
  for (const wall of style.wall) {
    const s = document.createElement("span");
    s.style.background = hexCss(wall);
    s.title = hexCss(wall);
    nuancier.appendChild(s);
  }
  const toit = document.createElement("span");
  toit.style.background = hexCss(style.roof);
  toit.title = `toit ${hexCss(style.roof)}`;
  nuancier.appendChild(toit);
  genere.appendChild(nuancier);

  genere.appendChild(paintStrip(facade, style.wall[0]));
  const legende = document.createElement("p");
  legende.className = "legende";
  legende.textContent =
    `tuile de ${style.bays} travées × ${FLOORS_PER_TILE} étages (${CELL_PX} px par cellule), ` +
    `période horizontale ${facade.tileU} m, ${Math.round(style.litRatio * 100)} % de fenêtres allumées, ` +
    `chaque étage fait ${FLOOR} m`;
  genere.appendChild(legende);

  face.append(genere, photoBlock(manifest.filter((m) => m.archetype === name)));
  section.appendChild(face);
  main.appendChild(section);
}

// Le socle commercant est partage par tous les archetypes : une section propre.
{
  const shop = paintShopFront();
  const section = document.createElement("section");
  const h2 = document.createElement("h2");
  h2.textContent = "socle commerçant (partagé)";
  const role = document.createElement("p");
  role.className = "role";
  role.textContent =
    "Rez-de-chaussée vitré posé uniquement sur les bâtiments qu'OSM désigne comme commerçants, au détail plein seulement.";
  section.append(h2, role);

  const genere = document.createElement("div");
  genere.className = "genere";
  const out = document.createElement("canvas");
  out.width = shop.albedo.width;
  out.height = shop.albedo.height;
  const c = out.getContext("2d")!;
  c.drawImage(shop.albedo, 0, 0);
  c.globalCompositeOperation = "lighter";
  c.drawImage(shop.glow, 0, 0);
  genere.appendChild(out);
  section.appendChild(genere);
  main.appendChild(section);
}
