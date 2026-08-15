// La planche de terrain : la page qu'on emporte dehors.
//
// Elle est autonome (images en data URI, aucun appel reseau) parce qu'elle est
// faite pour etre ouverte dans la rue, eventuellement sans reseau, et parce
// qu'un artifact publie n'a de toute facon pas le droit d'aller chercher quoi
// que ce soit dehors.
//
// Elle reprend la teinte de la planche de references (reference/index.html) :
// encre bleu nuit, accent chaud. En clair, le fond passe au papier froid et
// l'accent a l'orange de l'encadrement metallique des quais de Carnot, qui est
// une couleur du projet et non une couleur d'illustration.
//
// Ce n'est pas un document, c'est un instrument : on le tient d'une main, on
// lit trois nombres (le cap a viser, le recul a prendre, la distance qui reste
// a marcher) et on releve la tete. Tout le reste est secondaire.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CSS = `
:root {
  color-scheme: light;
  --fond: #e6eaee;
  --carte: #f8f9fa;
  --encre: #101a2e;
  --encre-2: #4d5a70;
  --trait: #ccd4dc;
  --accent: #b8501a;
  --accent-doux: rgba(184, 80, 26, 0.1);
  --alerte-fond: #f6e6d2;
  --alerte-encre: #7a3d05;
  --fait: #3d6b50;
  --ombre: 0 1px 2px rgba(16, 26, 46, 0.08), 0 4px 14px rgba(16, 26, 46, 0.06);
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --texte: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --fond: #0e1526;
    --carte: #161f36;
    --encre: #cdd6e4;
    --encre-2: #8b98ae;
    --trait: #26334f;
    --accent: #ffca7a;
    --accent-doux: rgba(255, 202, 122, 0.12);
    --alerte-fond: #2e2415;
    --alerte-encre: #f0c489;
    --fait: #7fb08c;
    --ombre: 0 1px 2px rgba(0, 0, 0, 0.4);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --fond: #0e1526;
  --carte: #161f36;
  --encre: #cdd6e4;
  --encre-2: #8b98ae;
  --trait: #26334f;
  --accent: #ffca7a;
  --accent-doux: rgba(255, 202, 122, 0.12);
  --alerte-fond: #2e2415;
  --alerte-encre: #f0c489;
  --fait: #7fb08c;
  --ombre: 0 1px 2px rgba(0, 0, 0, 0.4);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fond);
  color: var(--encre);
  font-family: var(--texte);
  font-size: 16px;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}
.enveloppe { max-width: 44rem; margin: 0 auto; padding: 0 0 4rem; }

/* --- bandeau ------------------------------------------------------------- */
header {
  position: sticky; top: 0; z-index: 5;
  background: var(--fond);
  border-bottom: 1px solid var(--trait);
  padding: 0.7rem clamp(0.8rem, 3vw, 1.4rem) 0.6rem;
}
h1 {
  margin: 0; font-size: 1rem; font-weight: 600;
  letter-spacing: 0.02em;
  display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap;
}
h1 .compte { font-family: var(--mono); font-size: 0.78rem; color: var(--encre-2); font-weight: 400; }
.etat {
  font-family: var(--mono); font-size: 0.72rem; color: var(--encre-2);
  margin-top: 0.15rem; display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
}
.etat b { color: var(--accent); font-weight: 600; }
.barre { display: flex; gap: 0.35rem; margin-top: 0.55rem; overflow-x: auto; padding-bottom: 0.15rem; }
.barre button, .outil {
  font: 500 0.76rem/1 var(--texte);
  color: var(--encre-2); background: transparent;
  border: 1px solid var(--trait); border-radius: 999px;
  padding: 0.42rem 0.72rem; white-space: nowrap; cursor: pointer;
}
.barre button[aria-pressed="true"] {
  color: var(--accent); border-color: var(--accent); background: var(--accent-doux);
}
.barre button:focus-visible, .outil:focus-visible, .fiche button:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}

/* --- fiche --------------------------------------------------------------- */
.liste { display: flex; flex-direction: column; gap: 0.8rem; padding: 0.8rem clamp(0.8rem, 3vw, 1.4rem) 0; }
.fiche {
  background: var(--carte); border: 1px solid var(--trait); border-radius: 10px;
  box-shadow: var(--ombre); overflow: hidden;
}
.fiche.fait { opacity: 0.55; }
.tete {
  display: flex; align-items: flex-start; gap: 0.6rem;
  padding: 0.75rem 0.85rem 0.6rem;
}
.tete h2 { margin: 0; font-size: 1.02rem; font-weight: 600; line-height: 1.25; text-wrap: balance; flex: 1; }
.genre {
  font-family: var(--mono); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.09em;
  color: var(--encre-2); border: 1px solid var(--trait); border-radius: 4px;
  padding: 0.12rem 0.32rem; white-space: nowrap; margin-top: 0.18rem;
}
.coche {
  flex: none; width: 2rem; height: 2rem; border-radius: 6px;
  border: 1px solid var(--trait); background: transparent; color: var(--encre-2);
  font-size: 1rem; line-height: 1; cursor: pointer;
}
.fiche.fait .coche { color: var(--fait); border-color: var(--fait); }

/* trois nombres, c'est tout ce qu'on lit en marchant */
.chiffres {
  display: grid; grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--trait); border-bottom: 1px solid var(--trait);
}
.chiffre { padding: 0.5rem 0.85rem 0.55rem; }
.chiffre + .chiffre { border-left: 1px solid var(--trait); }
.chiffre .v {
  font-family: var(--mono); font-size: 1.5rem; font-weight: 600;
  font-variant-numeric: tabular-nums; letter-spacing: -0.02em; display: block;
}
.chiffre .u { font-size: 0.8rem; font-weight: 400; color: var(--encre-2); }
.chiffre .l {
  font-family: var(--mono); font-size: 0.6rem; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--encre-2);
}
.chiffre.vise .v { color: var(--accent); }

/* la rose : tick fixe sur le cap a viser, aiguille sur le cap courant */
.viseur { display: flex; align-items: center; gap: 0.8rem; padding: 0.6rem 0.85rem; }
.rose { flex: none; width: 62px; height: 62px; }
.rose .cadran { fill: none; stroke: var(--trait); stroke-width: 1.5; }
.rose .cible { stroke: var(--accent); stroke-width: 3; stroke-linecap: round; }
.rose .aiguille { stroke: var(--encre); stroke-width: 1.5; stroke-linecap: round; }
.rose .n { fill: var(--encre-2); font: 600 8px var(--mono); text-anchor: middle; }
.consigne { font-size: 0.84rem; color: var(--encre-2); }
.consigne b { color: var(--encre); font-weight: 600; }

.detail { padding: 0.1rem 0.85rem 0.85rem; }
.elev {
  width: 100%; display: block; border-radius: 6px; border: 1px solid var(--trait);
  background: #0e1526; margin: 0.35rem 0 0.6rem;
}
.legende {
  font-family: var(--mono); font-size: 0.66rem; color: var(--encre-2);
  margin: -0.35rem 0 0.7rem; line-height: 1.45;
}
ul.questions { margin: 0 0 0.7rem; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.3rem; }
ul.questions li {
  font-size: 0.87rem; line-height: 1.4; padding-left: 1.05rem; position: relative; color: var(--encre);
}
ul.questions li::before {
  content: ""; position: absolute; left: 0; top: 0.55em;
  width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
}
.postes { display: flex; flex-direction: column; gap: 0.4rem; }
.poste {
  display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;
  font-family: var(--mono); font-size: 0.74rem; color: var(--encre-2);
  border-top: 1px dashed var(--trait); padding-top: 0.4rem;
}
.poste .rang { color: var(--accent); font-weight: 600; }
.poste a {
  color: var(--encre); text-decoration: none; border-bottom: 1px solid var(--accent);
  padding-bottom: 1px; margin-left: auto;
}
.alerte {
  background: var(--alerte-fond); color: var(--alerte-encre);
  font-size: 0.78rem; line-height: 1.4; padding: 0.45rem 0.85rem;
  border-top: 1px solid var(--trait);
}
.vide { padding: 2rem 1rem; text-align: center; color: var(--encre-2); font-size: 0.9rem; }
footer {
  margin: 1.6rem clamp(0.8rem, 3vw, 1.4rem) 0; padding-top: 0.9rem;
  border-top: 1px solid var(--trait);
  font-size: 0.72rem; line-height: 1.55; color: var(--encre-2);
}
footer b { color: var(--encre); font-weight: 600; }
@media (prefers-reduced-motion: no-preference) {
  .rose .aiguille, .rose g.tourne { transition: transform 0.18s linear; }
}
`;

/** Le script embarque : tri par distance, boussole, memoire des sujets faits. */
const JS = String.raw`
const $ = (s, r) => (r || document).querySelector(s);
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + " km" : Math.round(n) + " m");
const R = 6378137, D2R = Math.PI / 180;
function metres(a, b) {
  const k = Math.cos(((a.lat + b.lat) / 2) * D2R);
  return Math.hypot((b.lon - a.lon) * D2R * k * R, (b.lat - a.lat) * D2R * R);
}
function capVers(a, b) {
  const k = Math.cos(((a.lat + b.lat) / 2) * D2R);
  return ((Math.atan2((b.lon - a.lon) * k, b.lat - a.lat) * 180) / Math.PI + 360) % 360;
}
const ecart = (a, b) => ((b - a + 540) % 360) - 180;

const FAITS = new Set(JSON.parse(localStorage.getItem("saintespeed-terrain") || "[]"));
const garde = () => localStorage.setItem("saintespeed-terrain", JSON.stringify([...FAITS]));

let moi = null, cap = null, filtre = "tout", recherche = "";

function cartes() {
  let v = PLAN.filter((s) => {
    if (filtre === "reperes" && s.genre === "objet") return false;
    if (filtre === "objets" && s.genre !== "objet") return false;
    if (filtre === "reste" && FAITS.has(s.clef)) return false;
    if (filtre === "alertes" && !s.alertes.length) return false;
    if (recherche && !(s.label + " " + s.clef).toLowerCase().includes(recherche)) return false;
    return true;
  });
  if (moi) {
    for (const s of v) s._d = metres(moi, s.postes[0]);
    v.sort((a, b) => a._d - b._d);
  }
  return v;
}

function rose(vise) {
  return (
    '<svg class="rose" viewBox="-32 -32 64 64" aria-hidden="true">' +
    '<circle class="cadran" r="27"></circle>' +
    '<g class="tourne" data-vise="' + vise + '">' +
    '<line class="cible" x1="0" y1="-17" x2="0" y2="-27" transform="rotate(' + vise + ')"></line>' +
    '<text class="n" x="0" y="-20">N</text>' +
    "</g>" +
    '<line class="aiguille" x1="0" y1="8" x2="0" y2="-12"></line>' +
    '<circle r="2" fill="currentColor"></circle>' +
    "</svg>"
  );
}

function fiche(s) {
  const p = s.postes[0];
  const dist = s._d === undefined ? null : s._d;
  const img = IMG[s.elevation];
  const distTxt = dist === null ? "&mdash;" : fmt(dist).replace(/ (m|km)$/, '<span class="u"> $1</span>');
  return (
    '<article class="fiche' + (FAITS.has(s.clef) ? " fait" : "") + '" data-clef="' + s.clef + '" data-lat="' + p.lat + '" data-lon="' + p.lon + '">' +
      '<div class="tete">' +
        "<h2>" + s.label + "</h2>" +
        '<span class="genre">' + (s.genre === "objet" ? "objet" : s.genre === "synthetique" ? "sans emprise" : "repère") + "</span>" +
        '<button class="coche" type="button" aria-pressed="' + FAITS.has(s.clef) + '" title="marquer comme photographié">' + (FAITS.has(s.clef) ? "✓" : "") + "</button>" +
      "</div>" +
      '<div class="chiffres">' +
        '<div class="chiffre vise"><span class="l">cap</span><span class="v">' + p.cap + '<span class="u">°</span></span></div>' +
        '<div class="chiffre"><span class="l">recul</span><span class="v">' + p.recul + '<span class="u"> m</span></span></div>' +
        '<div class="chiffre"><span class="l">distance</span><span class="v js-dist">' + distTxt + "</span></div>" +
      "</div>" +
      '<div class="viseur">' + rose(p.cap) +
        '<div class="consigne js-consigne">' + consigne(s, p, null) + "</div>" +
      "</div>" +
      (s.alertes.length ? '<p class="alerte">' + s.alertes.join(" · ") + "</p>" : "") +
      '<div class="detail">' +
        (img ? '<img class="elev" src="' + img + '" alt="élévation du kit ' + s.label + '" loading="lazy">' : "") +
        '<p class="legende">' + legende(s) + "</p>" +
        "<ul class=\"questions\">" + s.questions.map((q) => "<li>" + q + "</li>").join("") + "</ul>" +
        '<div class="postes">' + s.postes.map(ligne).join("") + "</div>" +
      "</div>" +
    "</article>"
  );
}

function legende(s) {
  const f = { "y-": "sud du repère local", "y+": "nord du repère local", "x-": "bout x−", "x+": "bout x+" }[s.face];
  const source = s.faceSource === "repere" ? "façade portée par le kit"
    : s.faceSource === "mesure" ? "côté choisi par la mesure, le kit n'en désigne pas"
    : "objet sans façade";
  return (
    "sujet " + s.largeur + " × " + s.hauteur + " m, " + (s.portrait ? "à tenir en PORTRAIT" : "en paysage") +
    " · " + f + ", " + source +
    " · l'image est le rendu du kit vu de ce poste"
  );
}

function ligne(p, i) {
  const url = "https://maps.apple.com/?daddr=" + p.lat + "," + p.lon + "&dirflg=w";
  return (
    '<div class="poste">' +
      '<span class="rang">' + (i + 1) + "</span>" +
      "<span>cap " + p.cap + "° · recul " + p.recul + " m · cadre " + p.couvre + " m</span>" +
      "<span>· " + p.sol + (p.marche > 0 ? " à " + p.marche + " m" : "") + "</span>" +
      '<a href="' + url + '" target="_blank" rel="noopener">y aller</a>' +
    "</div>"
  );
}

function consigne(s, p, capCourant) {
  if (capCourant === null) return "vise <b>" + p.cap + "°</b>, recule de <b>" + p.recul + " m</b>";
  const d = ecart(capCourant, p.cap);
  if (Math.abs(d) < 8) return "<b>tu es dans l'axe</b>, recule de " + p.recul + " m";
  return "tourne de <b>" + (d > 0 ? "+" : "") + Math.round(d) + "°</b> vers la " + (d > 0 ? "droite" : "gauche");
}

function peins() {
  const v = cartes();
  $("#liste").innerHTML = v.length ? v.map(fiche).join("") : '<p class="vide">rien ne correspond</p>';
  $("#compte").textContent = v.length + " sur " + PLAN.length;
  boussole();
}

function boussole() {
  document.querySelectorAll(".fiche").forEach((f) => {
    const g = $(".tourne", f), a = $(".aiguille", f);
    if (!g) return;
    if (cap === null) { g.style.transform = ""; a.style.opacity = "0.25"; return; }
    a.style.opacity = "1";
    g.style.transform = "rotate(" + -cap + "deg)";
  });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".coche");
  if (b) {
    const f = b.closest(".fiche"), clef = f.dataset.clef;
    if (FAITS.has(clef)) FAITS.delete(clef); else FAITS.add(clef);
    garde(); peins();
    return;
  }
  const t = e.target.closest("[data-filtre]");
  if (t) {
    filtre = t.dataset.filtre;
    document.querySelectorAll("[data-filtre]").forEach((x) => x.setAttribute("aria-pressed", x === t));
    peins();
  }
});

$("#chercher").addEventListener("input", (e) => { recherche = e.target.value.toLowerCase(); peins(); });

// --- position et boussole ---------------------------------------------------
// Les deux peuvent etre refusees, et la page doit rester utile sans elles : le
// cap et le recul sont calcules d'avance, ils ne dependent pas du telephone.
$("#situer").addEventListener("click", () => {
  if (!navigator.geolocation) { $("#position").textContent = "pas de géolocalisation ici"; return; }
  $("#position").textContent = "recherche…";
  navigator.geolocation.watchPosition(
    (pos) => {
      moi = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      $("#position").innerHTML = "position à <b>±" + Math.round(pos.coords.accuracy) + " m</b>";
      peins();
    },
    (err) => { $("#position").textContent = "position refusée (" + err.code + ")"; },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
});

function ecouteCap() {
  const prend = (e) => {
    const h = e.webkitCompassHeading !== undefined
      ? e.webkitCompassHeading
      : e.absolute && e.alpha !== null ? (360 - e.alpha) % 360 : null;
    if (h === null) return;
    cap = h;
    $("#capNum").textContent = Math.round(h) + "°";
    document.querySelectorAll(".fiche").forEach((f) => {
      const s = PLAN.find((x) => x.clef === f.dataset.clef);
      if (s) $(".js-consigne", f).innerHTML = consigne(s, s.postes[0], cap);
    });
    boussole();
  };
  window.addEventListener("deviceorientationabsolute", prend);
  window.addEventListener("deviceorientation", prend);
}

$("#viser").addEventListener("click", async () => {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    try {
      if ((await D.requestPermission()) !== "granted") { $("#capNum").textContent = "refusée"; return; }
    } catch { $("#capNum").textContent = "refusée"; return; }
  }
  $("#capNum").textContent = "…";
  ecouteCap();
});

peins();
`;

const echappe = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * @param {any[]} sujets le plan calcule
 * @param {string} dossier ou trouver les elevations rendues
 */
export function planche(sujets, dossier) {
  // Les images sont embarquees une seule fois : les 57 objets ponctuels
  // partagent cinq planches de typologie, les inclure a chaque fiche
  // multiplierait la page par dix pour rien.
  const images = {};
  for (const s of sujets) {
    if (!s.elevation || images[s.elevation]) continue;
    const p = resolve(dossier, s.elevation);
    if (!existsSync(p)) continue;
    images[s.elevation] = `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
  }

  const propre = sujets.map((s) => ({
    ...s,
    label: echappe(s.label),
    questions: s.questions.map(echappe),
    alertes: s.alertes.map(echappe),
  }));

  const nbPostes = sujets.reduce((n, s) => n + s.postes.length, 0);
  const nbAlertes = sujets.filter((s) => s.alertes.length).length;

  // Le charset d'abord : la planche s'ouvre aussi en local, hors de tout
  // serveur, et un fichier UTF-8 sans declaration se lit alors en latin-1.
  return `<meta charset="utf-8">
<title>Postes de relevé</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${CSS}</style>
<div class="enveloppe">
<header>
  <h1>Postes de relevé <span class="compte" id="compte">${sujets.length} sur ${sujets.length}</span></h1>
  <div class="etat">
    <span id="position">position non demandée</span>
    <span>cap <b id="capNum">—</b></span>
  </div>
  <div class="barre">
    <button type="button" data-filtre="tout" aria-pressed="true">tout</button>
    <button type="button" data-filtre="reperes" aria-pressed="false">repères</button>
    <button type="button" data-filtre="objets" aria-pressed="false">objets</button>
    <button type="button" data-filtre="reste" aria-pressed="false">reste à faire</button>
    <button type="button" data-filtre="alertes" aria-pressed="false">alertes (${nbAlertes})</button>
  </div>
  <div class="barre">
    <button type="button" class="outil" id="situer">me situer</button>
    <button type="button" class="outil" id="viser">boussole</button>
    <input class="outil" id="chercher" type="search" placeholder="chercher" aria-label="chercher un sujet"
      style="flex:1;min-width:6rem;color:var(--encre)">
  </div>
</header>
<main class="liste" id="liste"></main>
<footer>
  <p><b>${sujets.length} sujets, ${nbPostes} postes.</b> Le cap et le recul sont calculés depuis le repère
  du jeu : une photo prise à ce cap, à ce recul, se superpose au rendu affiché sous chaque fiche. C'est ce
  qui permet de comparer au lieu d'apprécier.</p>
  <p>Le relevé vérifie qu'on peut se tenir au poste (chaussée, rue piétonne, place, parc, parking) et que
  rien de bâti ne coupe la ligne de vue. Il ne connaît ni les arbres, ni les travaux, ni les voitures
  garées : au-delà de 80 m de recul, il le dit et laisse trancher sur place.</p>
  <p>Données © contributeurs OpenStreetMap, sous ODbL. Les photos prises depuis ces postes sont les vôtres.</p>
</footer>
</div>
<script>
const IMG = ${JSON.stringify(images)};
const PLAN = ${JSON.stringify(propre)};
${JS}
</script>
`;
}
