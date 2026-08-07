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

export function useKeyboard(onReset: () => void, onToggleBuildings: () => void) {
  useEffect(() => {
    const apply = () => {
      input.throttle = held.has("up") ? 1 : 0;
      input.brake = held.has("down") ? 1 : 0;
      input.steer = (held.has("left") ? 1 : 0) - (held.has("right") ? 1 : 0);
      input.handbrake = held.has("brake");
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyR") {
        onReset();
        return;
      }
      if (e.code === "KeyB") {
        onToggleBuildings();
        return;
      }
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
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, [onReset, onToggleBuildings]);
}
