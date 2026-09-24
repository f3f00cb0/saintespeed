// Onomatopees de BD : les evenements de course s'ecrivent a l'ecran, en grosses
// lettres encrees (src/ui/Bangs.tsx). Ce module n'est qu'un bus : la scene et le
// store y publient, le HUD s'y abonne. Pas de React ici, pour que la boucle de
// jeu puisse publier sans rendu.

export type BangKind = "go" | "check" | "lap" | "record" | "drift" | "zoom" | "offroad";

export type Bang = { id: number; kind: BangKind; text: string; at: number };

// Plusieurs graphies par evenement : la meme onomatopee a chaque checkpoint
// devient un tampon, on tire donc dans une courte liste.
const WORDS: Record<BangKind, string[]> = {
  go: ["VROOOM !", "VRAOUM !"],
  check: ["CHECK !", "PASSÉ !", "TCHAK !"],
  lap: ["TOUR !", "ET UN TOUR !"],
  record: ["RECORD !!"],
  drift: ["SKRRRT !", "SKRIIICH !", "CRIIII !"],
  zoom: ["ZOOOOM !", "FWOOOSH !"],
  offroad: ["BADABOUM !", "OUPS !", "BONK !"],
};

// Delai minimal entre deux onomatopees du meme genre : un derapage tenu ne
// doit pas ecrire SKRRRT a chaque frame.
const COOLDOWN: Record<BangKind, number> = {
  go: 3000,
  check: 500,
  lap: 500,
  record: 500,
  drift: 1800,
  zoom: 6000,
  offroad: 2500,
};

const last = new Map<BangKind, number>();
const listeners = new Set<(b: Bang) => void>();
let seq = 0;

export function bang(kind: BangKind) {
  const now = performance.now();
  if (now - (last.get(kind) ?? -Infinity) < COOLDOWN[kind]) return;
  last.set(kind, now);
  const words = WORDS[kind];
  const b: Bang = { id: ++seq, kind, text: words[seq % words.length], at: now };
  for (const l of listeners) l(b);
}

export function onBang(fn: (b: Bang) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
