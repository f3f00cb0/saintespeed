import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clampHeight, editView, HEIGHT_MAX, HEIGHT_MIN } from "../lib/editView";
import { zAt } from "../lib/elev";

const TILT = 0.42; // recul sud, pour garder un peu de relief
const FOV = 52;
const held = new Set<string>();

const PAN: Record<string, [number, number]> = {
  KeyW: [0, 1],
  KeyZ: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  KeyQ: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function typing(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function EditorCamera() {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const ready = useRef(false);

  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor = "crosshair";

    const down = (e: PointerEvent) => {
      if (e.button !== 1 && e.button !== 2) return;
      dragging.current = true;
      last.current.x = e.clientX;
      last.current.y = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current.x = e.clientX;
      last.current.y = e.clientY;
      const k = editView.height * 0.0022;
      editView.x -= dx * k;
      editView.y += dy * k;
    };
    const up = () => {
      dragging.current = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1.13 : 1 / 1.13;
      editView.height = clampHeight(editView.height * dir);
    };
    const menu = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", menu);

    const keyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (PAN[e.code]) {
        e.preventDefault();
        held.add(e.code);
      }
    };
    const keyUp = (e: KeyboardEvent) => held.delete(e.code);
    const blur = () => held.clear();
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);

    return () => {
      el.style.cursor = "";
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", menu);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      held.clear();
    };
  }, [gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (held.size) {
      let ax = 0;
      let ay = 0;
      for (const k of held) {
        const d = PAN[k];
        if (!d) continue;
        ax += d[0];
        ay += d[1];
      }
      const n = Math.hypot(ax, ay);
      if (n > 0) {
        const speed = editView.height * 1.15;
        editView.x += (ax / n) * speed * dt;
        editView.y += (ay / n) * speed * dt;
      }
    }

    const cam = camera as THREE.PerspectiveCamera;
    const h = THREE.MathUtils.clamp(editView.height, HEIGHT_MIN, HEIGHT_MAX);
    const tx = editView.x;
    const ty = editView.y;
    const want = new THREE.Vector3(tx, h, -(ty - h * TILT));

    if (!ready.current || editView.jump) {
      cam.position.copy(want);
      ready.current = true;
      editView.jump = false;
    } else {
      cam.position.lerp(want, 1 - Math.exp(-8 * dt));
    }
    cam.lookAt(tx, zAt(tx, ty), -ty);
    if (Math.abs(cam.fov - FOV) > 0.05) {
      cam.fov = FOV;
      cam.updateProjectionMatrix();
    }
  });

  return null;
}
