// Deux directions artistiques pour la meme ville, qu'on bascule a chaud.
//
//   - cine : la nuit photographique. Bloom, ACES, vignette, grain, et la
//     chaussee mouillee qui renvoie les lampadaires en longues trainees.
//   - graphique : la nuit dessinee. La geometrie pauvre est assumee et
//     soulignee : contours encres tires de la profondeur, lumiere en aplats,
//     plus de grain ni de reflets.
//
// Le choix est une preference de joueur, pas un niveau de qualite : il est
// memorise dans le navigateur, et l'URL (?look=graphique) le force, ce qui sert
// aux captures.

export type Look = "cine" | "graphique";

export const LOOKS: Look[] = ["cine", "graphique"];
export const LOOK_NAMES: Record<Look, string> = { cine: "ciné", graphique: "graphique" };

const KEY = "saintespeed.look";

function isLook(v: unknown): v is Look {
  return v === "cine" || v === "graphique";
}

export function initialLook(): Look {
  try {
    const q = new URLSearchParams(window.location.search).get("look");
    if (isLook(q)) return q;
    const saved = window.localStorage.getItem(KEY);
    if (isLook(saved)) return saved;
  } catch {
    // stockage bloque : on retombe sur le defaut
  }
  return "cine";
}

export function saveLook(look: Look) {
  try {
    window.localStorage.setItem(KEY, look);
  } catch {
    // pas grave, le choix vaut pour la session
  }
}

export function nextLook(look: Look): Look {
  return LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length];
}
