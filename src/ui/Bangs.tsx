import { useEffect, useState } from "react";
import { onBang, type Bang } from "../lib/bangs";

// Les onomatopees, posees autour de la voiture dans une bulle eclatee. Chacune
// vit un peu plus d'une seconde : entree en claque, tenue, fuite vers le haut.
// L'animation est en CSS (index.css, .bang), React ne fait qu'ajouter et
// retirer les elements.

const LIFE_MS = 1300;

// ou poser la bulle, en % de l'ecran, et de combien la pencher
const SPOTS: Record<Bang["kind"], { x: number; y: number; tilt: number }> = {
  go: { x: 50, y: 42, tilt: -6 },
  check: { x: 50, y: 30, tilt: 4 },
  lap: { x: 50, y: 30, tilt: -4 },
  record: { x: 50, y: 44, tilt: 6 },
  drift: { x: 34, y: 62, tilt: -10 },
  zoom: { x: 70, y: 40, tilt: 8 },
  offroad: { x: 62, y: 60, tilt: 10 },
};

type Live = Bang & { x: number; y: number; tilt: number };

export function Bangs() {
  const [live, setLive] = useState<Live[]>([]);

  useEffect(
    () =>
      onBang((b) => {
        const s = SPOTS[b.kind];
        // un peu de jeu dans la pose, deterministe sur l'identifiant
        const jx = ((b.id * 37) % 9) - 4;
        const jy = ((b.id * 53) % 7) - 3;
        const item = { ...b, x: s.x + jx, y: s.y + jy, tilt: s.tilt + (((b.id * 11) % 5) - 2) };
        setLive((l) => [...l.slice(-4), item]);
        window.setTimeout(() => setLive((l) => l.filter((x) => x.id !== b.id)), LIFE_MS);
      }),
    [],
  );

  return (
    <div className="bangs">
      {live.map((b) => (
        <div
          key={b.id}
          className={`bang bang-${b.kind}`}
          style={{ left: `${b.x}%`, top: `${b.y}%`, ["--tilt" as string]: `${b.tilt}deg` }}
        >
          <svg className="burst" viewBox="-50 -50 100 100" preserveAspectRatio="none">
            <polygon points={BURST} />
          </svg>
          <span>{b.text}</span>
        </div>
      ))}
    </div>
  );
}

// eclat a quatorze pointes, rayons alternes
const BURST = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  const r = i % 2 ? 34 : 48 - ((i * 7) % 5);
  return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
}).join(" ");
