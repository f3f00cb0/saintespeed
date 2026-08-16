import { useEffect } from "react";
import { input } from "./car";

// AZERTY et QWERTY, fleches, plus espace = frein a main.
const KEYS: Record<string, string> = {
  KeyW: "up",
  KeyZ: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  KeyQ: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "brake",
};

const held = new Set<string>();

// Zone morte du stick, en fraction de l'axe complet.
const DEADZONE = 0.12;

// Etat precedent des boutons manette, pour detecter les appuis uniques.
const prevBtn = new Map<number, boolean>();

function dead(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
}

function edge(gp: Gamepad, i: number): boolean {
  const on = gp.buttons[i]?.pressed ?? false;
  const was = prevBtn.get(i) ?? false;
  prevBtn.set(i, on);
  return on && !was;
}

function activePad(): Gamepad | null {
  const pads = navigator.getGamepads?.();
  if (!pads) return null;
  for (const p of pads) {
    if (p?.connected) return p;
  }
  return null;
}

type PadActions = { reset: boolean; toggleBuildings: boolean };

function readPad(): PadActions & {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
} {
  const gp = activePad();
  if (!gp) {
    return { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false, toggleBuildings: false };
  }

  // Mapping standard W3C (Xbox, DualSense sur Chrome/Edge/Firefox).
  const throttle = gp.buttons[7]?.value ?? 0; // RT / R2
  const brake = gp.buttons[6]?.value ?? 0; // LT / L2
  const throttleBtn = gp.buttons[0]?.pressed ? 1 : 0; // A / Croix
  const brakeBtn = gp.buttons[1]?.pressed ? 1 : 0; // B / Cercle

  let steer = dead(gp.axes[0] ?? 0);
  if (gp.buttons[14]?.pressed) steer = -1; // croix gauche
  if (gp.buttons[15]?.pressed) steer = 1; // croix droite

  const handbrake = (gp.buttons[2]?.pressed || gp.buttons[5]?.pressed) ?? false; // X / RB

  return {
    throttle: Math.max(throttle, throttleBtn),
    brake: Math.max(brake, brakeBtn),
    steer,
    handbrake,
    reset: edge(gp, 3), // Y / Triangle
    toggleBuildings: edge(gp, 8), // Back / Select
  };
}

function typing(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function apply() {
  const kb = {
    throttle: held.has("up") ? 1 : 0,
    brake: held.has("down") ? 1 : 0,
    steer: (held.has("left") ? 1 : 0) - (held.has("right") ? 1 : 0),
    handbrake: held.has("brake"),
  };
  const pad = readPad();

  input.throttle = Math.max(kb.throttle, pad.throttle);
  input.brake = Math.max(kb.brake, pad.brake);
  input.steer = Math.abs(pad.steer) > 0 ? pad.steer : kb.steer;
  input.handbrake = kb.handbrake || pad.handbrake;

  return pad;
}

export function useInput(
  onReset: () => void,
  onToggleBuildings: () => void,
  onToggleEdit: () => void,
  driving: boolean,
  onJump?: () => void,
) {
  useEffect(() => {
    if (!driving) {
      input.throttle = 0;
      input.brake = 0;
      input.steer = 0;
      input.handbrake = false;
      held.clear();
    }
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === "KeyG") {
        onJump?.();
        return;
      }
      if (e.code === "KeyE") {
        onToggleEdit();
        return;
      }
      if (e.code === "KeyR") {
        if (driving) onReset();
        return;
      }
      if (e.code === "KeyB") {
        onToggleBuildings();
        return;
      }
      if (!driving) return;
      const k = KEYS[e.code];
      if (!k) return;
      e.preventDefault();
      held.add(k);
      apply();
    };
    const up = (e: KeyboardEvent) => {
      const k = KEYS[e.code];
      if (!k) return;
      e.preventDefault();
      held.delete(k);
      apply();
    };
    const blur = () => {
      held.clear();
      apply();
    };

    let raf = 0;
    const tick = () => {
      const pad = apply();
      if (driving && pad.reset) onReset();
      if (pad.toggleBuildings) onToggleBuildings();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      blur();
      prevBtn.clear();
    };
  }, [onReset, onToggleBuildings, onToggleEdit, driving, onJump]);
}

/** @deprecated utiliser useInput */
export const useKeyboard = useInput;
