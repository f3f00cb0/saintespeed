import * as THREE from "three";

// Reflet d'une source lumineuse sur chaussee mouillee (look cine).
//
// Une vraie reflexion coute une passe. Ici la source pose au sol une trainee qui
// part de son pied et file vers la camera, ce que fait le reflet d'une source
// sur un bitume mouille. L'orientation est calculee dans le vertex shader, donc
// rien a mettre a jour cote CPU, et le meme materiau sert aux lampadaires
// (instancies) comme aux feux des voitures (maillage simple, dans le repere de
// la voiture).
//
// La geometrie attendue est un plan x en travers (-0,5..0,5), y le long
// (0 au pied, 1 vers la camera) : voir streakGeometry().

const vertex = /* glsl */ `
uniform float streak;
uniform float width;
uniform float groundY;
uniform float fadeNear;
uniform float fadeFar;
uniform vec3 facing;
varying vec2 vUv;
varying float vFade;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec3 base = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 toCam = cameraPosition.xz - base.xz;
  float d = length(toCam);
  vec2 dir = toCam / max(d, 1e-3);
  vec2 side = vec2(-dir.y, dir.x);
  // la trainee ne depasse jamais la camera
  float len = min(streak, d * 0.7);
  vec2 p = base.xz + dir * (position.y * len) + side * (position.x * width);
  vUv = uv;
  // de loin, le reflet se noie dans le brouillard avant la source elle-meme
  vFade = 1.0 - smoothstep(fadeNear, fadeFar, d);
  // une source orientee (phare, feu) ne se reflete que du cote ou elle eclaire
  if (dot(facing, facing) > 0.0) {
    vec2 f = normalize((m * vec4(facing, 0.0)).xz);
    vFade *= smoothstep(-0.1, 0.6, dot(f, dir));
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, groundY, p.y, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 color;
varying vec2 vUv;
varying float vFade;
void main() {
  float lat = abs(vUv.x * 2.0 - 1.0);
  float core = pow(1.0 - lat * lat, 3.0);
  float along = vUv.y;
  // pied net sous la source, queue qui s'effiloche vers la camera
  float a = core * smoothstep(0.0, 0.1, along) * pow(1.0 - along, 1.6);
  // ondulation du bitume : la trainee se casse en plaques
  a *= 0.7 + 0.3 * sin(along * 38.0 + lat * 3.0);
  gl_FragColor = vec4(color * a * vFade, 1.0);
}
`;

export function streakGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
}

export function streakMaterial(opts: {
  /** Couleur HDR : au dessus du seuil du bloom, le coeur bave. */
  color: THREE.Color;
  length: number;
  width: number;
  /** Hauteur du reflet dans le monde : au dessus des couches de chaussee. */
  groundY: number;
  fadeNear?: number;
  fadeFar?: number;
  /** Direction d'eclairage dans le repere local ; nulle pour une source omni. */
  facing?: THREE.Vector3;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      streak: { value: opts.length },
      width: { value: opts.width },
      groundY: { value: opts.groundY },
      fadeNear: { value: opts.fadeNear ?? 70 },
      fadeFar: { value: opts.fadeFar ?? 280 },
      facing: { value: opts.facing ?? new THREE.Vector3() },
      color: { value: opts.color },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
