import { BlendFunction, Effect, EffectAttribute, EffectComposer } from "postprocessing";
import * as THREE from "three";

// La nuit dessinee, en une seule passe plein ecran branchee apres le tone
// mapping (donc en LDR, ou les aplats ont un sens).
//
// Les contours ne demandent pas de passe de normales : ils sortent du tampon de
// profondeur que le composer a deja. L'astuce est de travailler sur l'INVERSE de
// la distance, et pas sur la distance : 1/z varie lineairement a l'ecran sur un
// plan, donc son laplacien est nul sur une facade, un toit ou la chaussee, et ne
// s'allume que sur les plis (arete de batiment, bord de trottoir) et les
// silhouettes. On le divise par la valeur centrale pour qu'un pli au loin pese
// autant qu'un pli tout pres, puis on estompe l'encre avec la distance, comme
// le brouillard, sinon le fond de ville devient un gribouillis.
//
// Les aplats gardent la teinte et ne quantifient que la luminance : la couleur
// des facades, calee sur les photos (reference/NOTES.md), survit au dessin.
// Les ombres les plus basses remontent vers un bleu d'encre, sinon la moitie de
// l'ecran serait un noir plat sans matiere.

const fragment = /* glsl */ `
uniform vec3 ink;
uniform vec3 night;
uniform float bands;
uniform float thickness;
uniform float fadeNear;
uniform float fadeFar;

float invDist(const in vec2 uv) {
  return 1.0 / max(-getViewZ(readDepth(uv)), 1e-3);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec2 o = texelSize * thickness;
  float c = invDist(uv);
  float l = invDist(uv - vec2(o.x, 0.0));
  float r = invDist(uv + vec2(o.x, 0.0));
  float d = invDist(uv - vec2(0.0, o.y));
  float u = invDist(uv + vec2(0.0, o.y));

  // pli : laplacien relatif ; silhouette : plus grand saut relatif
  float crease = abs(l + r + u + d - 4.0 * c) / c;
  float jump = max(max(abs(l - c), abs(r - c)), max(abs(u - c), abs(d - c))) / c;
  float edge = max(smoothstep(0.015, 0.05, crease), smoothstep(0.06, 0.18, jump));
  edge *= 1.0 - smoothstep(fadeNear, fadeFar, 1.0 / c);

  vec3 col = inputColor.rgb;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // bandes quantifiees en racine de la luminance, donc a peu pres
  // perceptuelles : quantifier la luminance lineaire relevait tous les noirs
  // au premier palier, et la nuit virait au jour gris
  float p = floor(sqrt(lum) * bands + 0.5) / bands;
  float q = mix(p * p, lum, 0.15);
  vec3 poster = col / max(lum, 1e-4) * q;
  float g = dot(poster, vec3(0.2126, 0.7152, 0.0722));
  poster = max(mix(vec3(g), poster, 1.2), 0.0);
  // les noirs remontent vers le bleu de nuit
  poster += night * (1.0 - smoothstep(0.0, 0.04, q));

  outputColor = vec4(mix(poster, ink, edge * 0.92), inputColor.a);
}
`;

export class GraphicEffect extends Effect {
  constructor() {
    super("GraphicEffect", fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ["ink", new THREE.Uniform(new THREE.Color(0x07080d))],
        ["night", new THREE.Uniform(new THREE.Color(0x0b1122))],
        ["bands", new THREE.Uniform(6)],
        ["thickness", new THREE.Uniform(1.5)],
        ["fadeNear", new THREE.Uniform(220)],
        ["fadeFar", new THREE.Uniform(900)],
      ]),
    });
  }
}

// Correctif de compatibilite postprocessing 6.39 / three 0.169, sans lequel
// aucun effet de profondeur ne marche : le composer fabrique ses trois textures
// de profondeur (entree, sortie, copie stable) par `clone()`, et depuis que
// three partage l'image GPU entre textures de meme `source`, les trois pointent
// sur la meme image. La copie de profondeur echoue alors a chaque frame
// ("Read and write depth stencil attachments cannot be the same image") et
// l'effet lit un tampon vide, tout a 1. On redonne a chacune sa propre source,
// avant la premiere initialisation GL.
type DepthComposer = {
  createDepthTexture(): void;
  inputBuffer: THREE.WebGLRenderTarget;
  outputBuffer: THREE.WebGLRenderTarget;
  depthRenderTarget: THREE.WebGLRenderTarget | null;
};
const proto = EffectComposer.prototype as unknown as DepthComposer;
const createDepthTexture = proto.createDepthTexture;
proto.createDepthTexture = function (this: DepthComposer) {
  createDepthTexture.call(this);
  const textures = [
    this.inputBuffer.depthTexture,
    this.outputBuffer.depthTexture,
    this.depthRenderTarget?.depthTexture,
  ];
  for (const t of textures) {
    if (t) t.source = new THREE.Source({ ...t.image });
  }
};
