// Trottoirs et bordures, deduits de la geometrie reelle : le reseau routier
// donne l'axe, les emprises OSM donnent la place disponible, et OSM dit le cote
// quand il le sait.
//
// Le modele est celui d'un trottoir reel : une bande CONTINUE qui fait le tour
// du pate de maisons, interrompue seulement par la CHAUSSEE qu'elle croise, et
// qui TOURNE LE COIN au carrefour. La premiere version coupait au carrefour sans
// raccorder les angles, et le resultat se lisait en pointilles.
//
// Ce que la mesure a decide (10 073 milieux de segment testes dans 2,5 km du
// centre, distance a la facade la plus proche de chaque cote, au dela du bord
// de chaussee) :
//
//   classe          p10    mediane   sous 1,5 m
//   residential     2,1 m   9,5 m       6 %
//   secondary       4,7 m  16,0 m       3 %
//   tertiary        3,9 m  16,5 m       1 %
//   unclassified    6,6 m  17,5 m       1 %
//   living_street   1,8 m   9,3 m       7 %
//
// Donc une largeur fixe par classe est fausse une fois sur quinze en rue
// residentielle : elle rentrerait dans la facade. La largeur est donc bornee par
// un rayon lance dans l'index des murs, SOMMET PAR SOMMET et non segment par
// segment, pour que le bord exterieur reste continu au lieu de sauter.
//
// Ce qui n'est pas mesure et qui est donc annonce comme tel : les largeurs
// CIBLES par classe. Elles sont calees sur le plancher reglementaire francais de
// 1,40 m de cheminement libre (arrete du 15 janvier 2007), elargi avec la classe
// de voie. OSM ne porte pas la largeur du trottoir a Saint-Etienne. La hauteur de
// bordure, elle, est la vue standard d'une bordure T2 : 14 cm.

import type { RoadGraph } from "./graph";
import type { WallIndex } from "./buildings";
import { specFor, LAYER_STEP, type Way } from "./osm";
import type { Projector } from "./project";

/** Largeur cible par classe, en metres. Absente = pas de trottoir. */
const WIDTH: Record<string, number> = {
  primary: 3.0,
  secondary: 2.6,
  tertiary: 2.2,
  unclassified: 2.0,
  residential: 1.8,
  living_street: 1.4,
};

// Ni voie rapide ni bretelle : une voie rapide urbaine n'a pas de trottoir, et
// la mesure le confirme (motorway et trunk sont a 13 m et plus de toute facade,
// ils ne longent rien a pieds).

/** Vue de bordure, en metres. Un peu plus haute pour etre lisible en vue basse. */
export const CURB = 0.20;

/**
 * Sous cette largeur libre, la facade est sur la bordure : il n'y a pas de
 * trottoir et la bande s'arrete. Le seuil est bas VOLONTAIREMENT. A 0,8 m un
 * seul segment serre contre une facade coupait toute la bande, ce qui donnait
 * des ruptures en pleine rue. Une bande etroite au pied d'un immeuble est ce qui
 * existe reellement ; une rupture, non.
 */
const MIN_WIDTH = 0.35;

/** Marge entre le bord du trottoir et la facade. */
const WALL_GAP = 0.15;

/** Pas d'echantillonnage de la place libre le long d'un segment, en metres. */
const SAMPLE_STEP = 2.5;

/**
 * Marge au dela de la demi-chaussee de la voie CROISEE. Le trottoir s'arrete au
 * bord de la chaussee qu'il traverse, pas plus loin : c'est la que passe le
 * passage pieton, et l'angle lui-meme est rempli par le raccord.
 */
const JUNCTION_GAP = 0.12;

/**
 * En dessous, ce n'est plus un trottoir mais une dalle isolee. Le seuil porte
 * sur la bande CONTINUE et non sur le segment : une rue en courbe est decoupee
 * par OSM en segments de 2 a 3 m, et les juger un par un lui retirerait son
 * trottoir.
 */
const MIN_RUN = 8.0;

/** Surélévation de la dalle pour éviter le z-fighting avec la chaussée. */
const TOP_LIFT = 0.015;

/** Bande de rive sombre entre chaussee et dalle. */
const LIP = 0.22;

/** Quantification des sommets pour retrouver les carrefours (0,1 m, comme graph.ts). */
const QUANT = 10;

export type SidewalkMesh = {
  /** Triangles de la bande, en xyz. */
  top: Float32Array;
  /** Triangles de la face verticale de bordure, en xyz. */
  curb: Float32Array;
  /** Bande sombre au bord chaussee (lisibilite). */
  lip: Float32Array;
  stats: {
    segments: number;
    posed: number;
    skippedNoRoom: number;
    skippedJunction: number;
    skippedOverlap: number;
    narrowed: number;
    fromTag: number;
    deniedByTag: number;
    droppedShort: number;
    runs: number;
    runLengths: number[];
    triangles: number;
    ms: number;
  };
};

type Junction = { deg: number; ways: Map<number, number> };

const keyOf = (x: number, y: number) => Math.round(x * QUANT) + ":" + Math.round(y * QUANT);

/**
 * Carrefours du reseau : un sommet partage par trois incidences ou plus, avec la
 * demi-chaussee de chaque rue qui s'y presente.
 *
 * On le reconstruit ici plutot que de le demander au graphe : graph.ts porte le
 * gameplay, et cette couche est purement visuelle.
 */
function findJunctions(ways: Way[], proj: Projector): Map<string, Junction> {
  const j = new Map<string, Junction>();
  for (const w of ways) {
    const half = specFor(w.type).w / 2;
    const n = w.pts.length;
    for (let i = 0; i < n; i++) {
      const p = proj.project(w.pts[i][0], w.pts[i][1]);
      const key = keyOf(p.x, p.y);
      let e = j.get(key);
      if (!e) j.set(key, (e = { deg: 0, ways: new Map() }));
      e.deg += i === 0 || i === n - 1 ? 1 : 2;
      e.ways.set(w.id, Math.max(e.ways.get(w.id) ?? 0, half));
    }
  }
  return j;
}

/**
 * Recul du trottoir a un carrefour : la demi-chaussee de la voie CROISEE la plus
 * large, et rien de plus.
 *
 * Trois reglages ont ete essayes et regardes sur plan. Reculer d'une
 * demi-demi-chaussee laissait 4 dalles isolees de 2,1 m sur un seul carrefour a
 * trois branches. Reculer de la demi-chaussee la plus large PLUS un trottoir
 * ouvrait un trou de pres de 10 m pour une rue de 5 m, et le reseau se lisait en
 * pointilles. La bonne valeur est le bord de la chaussee croisee, l'angle etant
 * rempli par le raccord.
 */
function junctionBite(
  j: Map<string, Junction>,
  x: number,
  y: number,
  wayId: number,
  ownHalf: number,
): number {
  const e = j.get(keyOf(x, y));
  if (!e || e.deg < 3) return 0;
  let other = 0;
  for (const [id, half] of e.ways) {
    if (id !== wayId && half > other) other = half;
  }
  // Recul = chaussee croisee + une fraction de la notre : evite que la bande
  // deborde dans l'ile du carrefour (visible en X sur les captures).
  return other > 0 ? other + ownHalf * 0.35 + JUNCTION_GAP : 0;
}

/**
 * Construit les maillages du trottoir.
 *
 * @param area demi-cote de la boite ou l'on pose des trottoirs, autour de
 *   `centre`. Meme convention que les lampadaires : c'est un detail de
 *   proximite, inutile de le construire a 5 km. Passer Infinity pour la ville.
 */
export function buildSidewalks(
  ways: Way[],
  proj: Projector,
  graph: RoadGraph,
  walls: WallIndex | null,
  centre: { x: number; y: number },
  area = Infinity,
  sides: Map<number, number> | null = null,
): SidewalkMesh {
  const t0 = Date.now();
  const junctions = findJunctions(ways, proj);
  const top: number[] = [];
  const curb: number[] = [];
  const lip: number[] = [];
  let segments = 0;
  let posed = 0;
  let skippedNoRoom = 0;
  let skippedJunction = 0;
  let skippedOverlap = 0;
  let narrowed = 0;
  let fromTag = 0;
  let deniedByTag = 0;
  let droppedShort = 0;
  const runLengths: number[] = [];

  /** Point au coeur d'une chaussee (pas sur le bord du trottoir). */
  const onCarriageway = (x: number, y: number, ownWayId: number) => {
    const hit = graph.nearestEdge(x, y, 25);
    if (!hit) return false;
    if (hit.dist < hit.edge.halfWidth - 0.2) return true;
    return hit.edge.wayId !== ownWayId && hit.dist < hit.edge.halfWidth - 0.05;
  };

  type Pt = { ix: number; iy: number; ox: number; oy: number };

  /** Le bord interieur touche la chaussee par design : on ne teste que l'exterieur. */
  const quadOnCarriageway = (a: Pt, b: Pt, ownWayId: number) => {
    const cx = (a.ix + b.ix + b.ox + a.ox) / 4;
    const cy = (a.iy + b.iy + b.oy + a.oy) / 4;
    if (onCarriageway(cx, cy, ownWayId)) return true;
    return onCarriageway(a.ox, a.oy, ownWayId) || onCarriageway(b.ox, b.oy, ownWayId);
  };

  // Un morceau de bande en attente : rien n'est emis avant de connaitre la
  // longueur totale de la bande. On garde l'AXE et la normale, pas les points
  // deja decales : le decalage se fait a l'emission, sur la bissectrice du
  // sommet (onglet), sinon deux segments qui forment un coude laissent une
  // encoche entre leurs bords exterieurs. C'etait le dernier defaut visible au
  // carrefour, et il ressemblait a une dalle isolee.
  type Piece = {
    ax: number; ay: number; bx: number; by: number; // axe, deja coupe au carrefour
    nx: number; ny: number;
    wa: number; wb: number;
    /** L'axe de ce morceau touche-t-il le precedent ? Sinon, pas d'onglet. */
    joined: boolean;
  };

  // Un quad, en deux triangles. Les deux enroulements sont poses : le maillage
  // est vu de dessus mais les bandes de gauche et de droite s'enroulent en sens
  // inverse, et une seule orientation en aurait rendu la moitie invisible.
  const emitQuad = (
    x0: number, y0: number, x1: number, y1: number,
    x2: number, y2: number, x3: number, y3: number,
    hSurf: number,
  ) => {
    top.push(x0, hSurf, -y0, x1, hSurf, -y1, x2, hSurf, -y2, x0, hSurf, -y0, x2, hSurf, -y2, x3, hSurf, -y3);
  };

  /** Bande de rive sombre posée juste au-dessus de la chaussée. */
  const emitLip = (a: Pt, b: Pt, nx: number, ny: number, h: number) => {
    const la = Math.min(LIP, Math.hypot(a.ox - a.ix, a.oy - a.iy));
    const lb = Math.min(LIP, Math.hypot(b.ox - b.ix, b.oy - b.iy));
    if (la < 0.05 || lb < 0.05) return;
    const push = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      lip.push(x0, h, -y0, x1, h, -y1, x2, h, -y2, x0, h, -y0, x2, h, -y2, x3, h, -y3);
    };
    push(
      a.ix, a.iy, b.ix, b.iy,
      b.ix + nx * lb, b.iy + ny * lb,
      a.ix + nx * la, a.iy + ny * la,
    );
  };
  /** Face verticale de bordure entre deux points du bord interieur ou exterieur. */
  const emitCurb = (
    x0: number, y0: number, x1: number, y1: number,
    hRoad: number, hSurf: number,
  ) => {
    curb.push(
      x0, hRoad, -y0, x1, hRoad, -y1, x1, hSurf, -y1,
      x0, hRoad, -y0, x1, hSurf, -y1, x0, hSurf, -y0,
    );
  };

  for (const w of ways) {
    const want = WIDTH[w.type];
    if (!want) continue;

    // Ce qu'OSM dit du cote, quand il le dit : 1 = gauche du sens du way,
    // 2 = droite, 3 = les deux, 0 = pas de trottoir du tout. Le tag prime sur la
    // deduction geometrique, parce qu'il vient du terrain et qu'aucune mesure ne
    // peut deviner de quel cote la ville a mis son trottoir.
    const tag = sides?.get(w.id);
    const spec = specFor(w.type);
    const half = spec.w / 2;
    const hRoad = spec.z * LAYER_STEP;
    const hSurf = hRoad + CURB + TOP_LIFT;
    const minRun = w.name && /^place\b/i.test(w.name) ? 4.0 : MIN_RUN;

    const P = w.pts.map((p) => proj.project(p[0], p[1]));

    // Abscisse curviligne des sommets, et intervalle interdit autour de chaque
    // carrefour. Le recul se mesure LE LONG de la rue et non segment par
    // segment : une rue arrive souvent au carrefour par deux sommets rapproches
    // (releve : 3,35 m puis 2,05 m), et un recul applique au seul segment
    // terminal laissait le suivant plante dans la gueule du carrefour.
    const S: number[] = [0];
    for (let i = 1; i < P.length; i++) {
      S.push(S[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
    }
    const bites: { t: number; b: number; x: number; y: number }[] = [];
    for (let i = 0; i < P.length; i++) {
      const b = junctionBite(junctions, P[i].x, P[i].y, w.id, half);
      if (b > 0) bites.push({ t: S[i], b, x: P[i].x, y: P[i].y });
    }

    // Les segments se comptent sur le premier cote reellement traite : sinon une
    // rue dont OSM refuse le cote gauche ne compterait aucun segment.
    let countedSide: number | null = null;

    for (const side of [1, -1] as const) {
      // La normale (-dy, dx) pointe a GAUCHE du sens du way, comme le tag OSM.
      if (tag !== undefined) {
        const bit = side === 1 ? 1 : 2;
        if (!(tag & bit)) {
          deniedByTag++;
          continue;
        }
        fromTag++;
      }
      if (countedSide === null) countedSide = side;

      // Largeur libre, mesuree par ECHANTILLONS le long de chaque segment puis
      // ramenee aux sommets. Trois versions ont ete necessaires :
      //
      //   - par segment : le bord exterieur sautait d'un segment a l'autre, en
      //     dents de scie ;
      //   - par sommet sur la normale moyenne : faux dans un virage, parce que
      //     ce n'est pas la direction dans laquelle le quad est construit, et
      //     74 bandes finissaient dans une emprise ;
      //   - par echantillons sur la normale du segment, propages aux deux
      //     sommets : une facade qui avance ENTRE deux sommets est vue, et le
      //     bord reste continu puisque la largeur vit sur les sommets.
      //
      // Le rayon part de l'AXE, pas du bord de chaussee : la largeur de chaussee
      // est une convention de dessin et une facade tombe parfois dedans. Parti
      // du bord, il demarrait deja dans le mur et ne voyait rien.
      const cap: number[] = new Array(Math.max(0, P.length - 1)).fill(want);
      if (walls) {
        const reach = half + want + WALL_GAP;
        for (let k = 0; k + 1 < P.length; k++) {
          const ddx = P[k + 1].x - P[k].x;
          const ddy = P[k + 1].y - P[k].y;
          const l = Math.hypot(ddx, ddy);
          if (l < 1e-6) continue;
          const nx = (-ddy / l) * side;
          const ny = (ddx / l) * side;
          const n = Math.max(2, Math.min(24, Math.ceil(l / SAMPLE_STEP)));
          let free = want;
          for (let t = 0; t <= n; t++) {
            const f = t / n;
            const px = P[k].x + ddx * f;
            const py = P[k].y + ddy * f;
            const hitF = walls.clear(px, py, px + nx * reach, py + ny * reach, 0.5);
            const room = hitF * reach - half - WALL_GAP;
            if (room < free) free = room;
          }
          if (free < cap[k]) {
            cap[k] = free;
            narrowed++;
          }
        }
      }
      const wv: number[] = new Array(P.length);
      for (let i = 0; i < P.length; i++) {
        let width = want;
        if (i > 0 && cap[i - 1] < width) width = cap[i - 1];
        if (i < cap.length && cap[i] < width) width = cap[i];
        wv[i] = width;
      }

      let run: Piece[] = [];
      let runLen = 0;
      let pendingStart: { x: number; y: number } | null = null;

      const flush = () => {
        if (runLen >= minRun && run.length) {
          runLengths.push(runLen);
          // Bissectrice au coude, SANS allongement : l'allongement (scale > 1)
          // envoyait des triangles dans les carrefours sur les captures.
          const mitre = (i: number, at: "a" | "b") => {
            const p = run[i];
            const other = at === "a" ? run[i - 1] : run[i + 1];
            const use = other && (at === "a" ? p.joined : other.joined);
            let mx = p.nx;
            let my = p.ny;
            if (use) {
              mx = p.nx + other.nx;
              my = p.ny + other.ny;
              const l = Math.hypot(mx, my);
              if (l > 1e-6) {
                mx /= l;
                my /= l;
              } else {
                mx = p.nx;
                my = p.ny;
              }
            }
            const x = at === "a" ? p.ax : p.bx;
            const y = at === "a" ? p.ay : p.by;
            const wd = at === "a" ? p.wa : p.wb;
            return {
              ix: x + mx * half,
              iy: y + my * half,
              ox: x + mx * (half + wd),
              oy: y + my * (half + wd),
            };
          };
          for (let i = 0; i < run.length; i++) {
            const A = mitre(i, "a");
            const B = mitre(i, "b");
            if (quadOnCarriageway(A, B, w.id)) {
              skippedOverlap++;
              continue;
            }
            posed++;
            const p = run[i];
            emitQuad(A.ix, A.iy, B.ix, B.iy, B.ox, B.oy, A.ox, A.oy, hSurf);
            emitCurb(A.ix, A.iy, B.ix, B.iy, hRoad, hSurf);
            emitLip(A, B, p.nx, p.ny, hRoad + 0.004);
          }
        } else if (run.length) {
          droppedShort += run.length;
        }
        run = [];
        runLen = 0;
        pendingStart = null;
      };

      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i];
        const b = P[i + 1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) continue;
        if (Math.abs((a.x + b.x) / 2 - centre.x) > area || Math.abs((a.y + b.y) / 2 - centre.y) > area) {
          flush();
          continue;
        }
        dx /= len;
        dy /= len;
        if (side === countedSide) segments++;

        // Le trottoir s'arrete au bord de la chaussee qu'il croise. La coupe se
        // fait sur l'abscisse curviligne, donc elle traverse les sommets voisins.
        const mid = (S[i] + S[i + 1]) / 2;
        let lo = S[i];
        let hi = S[i + 1];
        let loJ: { x: number; y: number } | null = null;
        let hiJ: { x: number; y: number } | null = null;
        for (const j of bites) {
          if (j.t <= mid) {
            if (j.t + j.b > lo) {
              lo = j.t + j.b;
              loJ = j;
            }
          } else if (j.t - j.b < hi) {
            hi = j.t - j.b;
            hiJ = j;
          }
        }
        if (lo > S[i]) {
          flush();
          pendingStart = loJ;
        }
        const s0 = lo - S[i];
        const s1 = hi - S[i];
        if (s1 - s0 < 0.3) {
          skippedJunction++;
          flush();
          continue;
        }

        // largeur interpolee aux deux bouts du morceau reellement dessine
        const f0 = s0 / len;
        const f1 = s1 / len;
        const wa = wv[i] + (wv[i + 1] - wv[i]) * f0;
        const wb = wv[i] + (wv[i + 1] - wv[i]) * f1;
        if (wa < MIN_WIDTH || wb < MIN_WIDTH) {
          skippedNoRoom++;
          flush();
          continue;
        }

        const nx = -dy * side;
        const ny = dx * side;
        const ax = a.x + dx * s0;
        const ay = a.y + dy * s0;
        const bx = a.x + dx * s1;
        const by = a.y + dy * s1;

        // Un trottoir ne se pose pas sur la chaussee d'a cote. On teste le
        // milieu de la bande ET le bord interieur (cote chaussee), parce que
        // le milieu peut rester libre alors que le bord mord sur la voie voisine.
        const probe = (px: number, py: number) => {
          const hit = graph.nearestEdge(px, py, 25);
          return hit && hit.edge.wayId !== w.id && hit.dist < hit.edge.halfWidth + 0.05;
        };
        const mx = (ax + bx) / 2 + nx * (half + Math.max(wa, wb) / 2);
        const my = (ay + by) / 2 + ny * (half + Math.max(wa, wb) / 2);
        const ix = (ax + bx) / 2 + nx * half;
        const iy = (ay + by) / 2 + ny * half;
        if (probe(mx, my) || probe(ix, iy)) {
          skippedNoRoom++;
          flush();
          continue;
        }

        // On dessine la largeur MESUREE, sans plancher : un plancher de 0,6 m
        // poussait la bande dans la facade la ou la place manquait, mesure a
        // 108 bandes dans une emprise. Une bande de 40 cm au pied d'un immeuble
        // n'est plus qu'une bordure, et c'est exactement ce qui existe la.
        const prev = run[run.length - 1];
        const piece: Piece = {
          ax, ay, bx, by, nx, ny, wa, wb,
          joined: !!prev && Math.hypot(prev.bx - ax, prev.by - ay) < 0.05,
        };
        if (!run.length && pendingStart) pendingStart = null;
        run.push(piece);
        runLen += s1 - s0;
        if (hi < S[i + 1] && hiJ) flush();
      }
      flush();
    }
  }

  return {
    top: new Float32Array(top),
    curb: new Float32Array(curb),
    lip: new Float32Array(lip),
    stats: {
      segments,
      posed,
      skippedNoRoom,
      skippedJunction,
      skippedOverlap,
      narrowed,
      fromTag,
      deniedByTag,
      droppedShort,
      runs: runLengths.length,
      runLengths,
      triangles: (top.length + curb.length + lip.length) / 9,
      ms: Date.now() - t0,
    },
  };
}
