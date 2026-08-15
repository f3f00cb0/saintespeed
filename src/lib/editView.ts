// Vue de l'éditeur : singleton comme `car`, lu chaque frame, pas de React.

export const HEIGHT_MIN = 70;
export const HEIGHT_MAX = 1600;

export const editView = {
  x: 0,
  y: 0,
  height: 280,
  jump: false,
};

export function clampHeight(h: number) {
  return Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, h));
}

export function jumpEditView(x: number, y: number, height?: number) {
  editView.x = x;
  editView.y = y;
  if (height != null) editView.height = clampHeight(height);
  editView.jump = true;
}

export function framePoints(pts: { x: number; y: number }[]) {
  if (!pts.length) {
    editView.jump = true;
    return;
  }
  if (pts.length === 1) {
    jumpEditView(pts[0].x, pts[0].y, 220);
    return;
  }
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const x = sx / pts.length;
  const y = sy / pts.length;
  let span = 80;
  for (const p of pts) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d * 2.6 > span) span = d * 2.6;
  }
  jumpEditView(x, y, span * 0.95);
}
