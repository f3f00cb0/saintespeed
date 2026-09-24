import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";

// Sensation de vitesse : des lignes de vitesse de manga. Elles lisent un seul
// uniforme, `amount` (0..1), pousse chaque frame depuis la vitesse de la
// voiture (Post.tsx) ; a l'arret elles ne changent rien a l'image.
//
// Des rayons fins partent du
// point de fuite, seulement en peripherie, et se redistribuent une douzaine de
// fois par seconde pour vibrer. Pas de convolution : ca se fond dans la meme
// passe que le dessin.
const linesFragment = /* glsl */ `
uniform float amount;
uniform vec2 focus;
uniform vec3 lineColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 d = (uv - focus) * vec2(aspect, 1.0);
  float r = length(d);
  float ang = atan(d.y, d.x) / 6.2831853 + 0.5;
  float slot = floor(ang * 180.0);
  float frame = floor(time * 12.0);
  float on = step(1.0 - 0.35 * amount, hash(slot * 13.1 + frame * 7.7));
  // rayon fin : plus etroit au centre de sa tranche angulaire
  float w = abs(fract(ang * 180.0) - 0.5) * 2.0;
  float thin = smoothstep(0.55, 0.1, w);
  float reach = mix(0.95, 0.45, amount) + 0.2 * hash(slot + frame);
  float mask = smoothstep(reach, reach + 0.25, r);
  float a = on * thin * mask * amount;
  outputColor = vec4(mix(inputColor.rgb, lineColor, a * 0.75), inputColor.a);
}
`;

export class SpeedLinesEffect extends Effect {
  constructor() {
    super("SpeedLinesEffect", linesFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["amount", new THREE.Uniform(0)],
        ["focus", new THREE.Uniform(new THREE.Vector2(0.5, 0.56))],
        ["lineColor", new THREE.Uniform(new THREE.Color(0xe8ecf4))],
      ]),
    });
  }
}

/** Vitesse (m/s) -> intensite 0..1 : rien sous 90 km/h, plein vers 190. */
export function speedAmount(speed: number): number {
  const t = (Math.abs(speed) - 25) / 28;
  return Math.max(0, Math.min(1, t));
}
