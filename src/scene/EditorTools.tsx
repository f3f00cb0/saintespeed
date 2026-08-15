import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { RoadGraph } from "../lib/graph";
import { snapCheckpoint } from "../lib/race";
import { editView } from "../lib/editView";
import { useStore } from "../state/store";

const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function groundAt(camera: THREE.Camera, clientX: number, clientY: number) {
  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return { x: hit.x, y: -hit.z };
}

function uiHit(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest(".editor, .overlay");
}

function pickRadius() {
  return Math.max(14, editView.height * 0.032);
}

function nearestCp(x: number, y: number, cps: { x: number; y: number }[]) {
  let best = -1;
  let bestD = pickRadius();
  for (let i = 0; i < cps.length; i++) {
    const d = Math.hypot(cps[i].x - x, cps[i].y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function EditorTools({ graph }: { graph: RoadGraph }) {
  const { camera, gl } = useThree();
  const checkpoints = useStore((s) => s.checkpoints);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef(-1);
  const moved = useRef(false);
  const down = useRef<{ x: number; y: number; button: number } | null>(null);

  const line = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (checkpoints.length >= 2) {
      const pts = checkpoints.map((c) => new THREE.Vector3(c.x, 1.6, -c.y));
      pts.push(pts[0].clone());
      geo.setFromPoints(pts);
    }
    const mat = new THREE.LineBasicMaterial({ color: 0xff5d3b, transparent: true, opacity: 0.72 });
    return new THREE.Line(geo, mat);
  }, [checkpoints]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  useEffect(() => {
    const el = gl.domElement;

    const onDown = (e: PointerEvent) => {
      if (uiHit(e.target)) return;
      if (e.button !== 0 && e.button !== 2) return;
      const p = groundAt(camera, e.clientX, e.clientY);
      if (!p) return;
      const s = useStore.getState();
      const i = nearestCp(p.x, p.y, s.checkpoints);
      down.current = { x: e.clientX, y: e.clientY, button: e.button };
      moved.current = false;
      if (e.button === 0 && i >= 0) {
        drag.current = i;
        s.setSelectedCp(i);
        el.setPointerCapture(e.pointerId);
      } else {
        drag.current = -1;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (uiHit(e.target) && drag.current < 0) {
        setGhost(null);
        return;
      }
      const p = groundAt(camera, e.clientX, e.clientY);
      if (!p) {
        setGhost(null);
        return;
      }
      if (down.current) {
        const dx = e.clientX - down.current.x;
        const dy = e.clientY - down.current.y;
        if (dx * dx + dy * dy > 36) moved.current = true;
      }
      if (drag.current >= 0) {
        useStore.getState().moveCheckpoint(drag.current, p.x, p.y);
        setGhost(null);
        return;
      }
      const snap = snapCheckpoint(graph, p.x, p.y, 80);
      setGhost(snap ? { x: snap.x, y: snap.y } : null);
    };

    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      const wasDrag = drag.current;
      drag.current = -1;
      if (wasDrag >= 0) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* deja relache */
        }
        return;
      }
      if (!start || uiHit(e.target)) return;
      const p = groundAt(camera, e.clientX, e.clientY);
      if (!p) return;
      const s = useStore.getState();
      if (start.button === 2 && !moved.current) {
        const i = nearestCp(p.x, p.y, s.checkpoints);
        if (i >= 0) s.removeCheckpoint(i);
        return;
      }
      if (start.button === 0 && !moved.current) {
        s.addCheckpointAt(p.x, p.y);
      }
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [camera, gl, graph]);

  return (
    <group>
      {checkpoints.length >= 2 && <primitive object={line} />}
      {ghost && (
        <mesh position={[ghost.x, 0.2, -ghost.y]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.4, 4.6, 28]} />
          <meshBasicMaterial color={0xe0b15e} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
