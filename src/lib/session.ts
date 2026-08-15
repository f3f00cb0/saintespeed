// Depart partage : un timestamp local, assez bon entre potes sur le meme wifi.

export const COUNTDOWN_MS = 3000;

export const session = {
  goAt: 0,
};

export function countdownLeft() {
  if (session.goAt <= 0) return 0;
  return Math.max(0, session.goAt - performance.now());
}

export function armGo(delay = COUNTDOWN_MS) {
  session.goAt = performance.now() + delay;
}

export function clearGo() {
  session.goAt = 0;
}
