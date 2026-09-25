// Drapé : poser sur le relief une geometrie dessinee a plat.
//
// Le decor au sol (places, parcs, trottoirs, passages pietons, rails, allees)
// a ete construit pour un sol plat : des triangles qui peuvent faire 200 m de
// cote sur une place, a une hauteur constante de quelques centimetres. Sur une
// colline, soulever leurs seuls sommets les ferait couper la pente. On les
// redecoupe donc, puis chaque sommet recoit l'altitude du sol de la ville
// (surfaceY) en plus de son decalage d'origine, qui garde l'ordre des couches.
//
// Le decoupage est ADAPTATIF : on coupe le cote le plus long d'un triangle tant
// qu'il depasse MAX_EDGE, ou tant que le sol s'ecarte de plus de TOL de la
// corde entre ses deux bouts. Une grande place plate reste en quelques
// triangles ; une rue en pente est recoupee au pas du relief.

import * as THREE from "three";
import { elevation, surfaceY } from "./elevation";

/** Cote maximal d'un triangle drape, en metres, meme sur sol plat. */
const DEFAULT_MAX_EDGE = 48;
/** En dessous, on ne coupe plus, quelle que soit la courbure. */
const DEFAULT_MIN_EDGE = 3;
/** Ecart toleré entre le sol et la corde d'un cote, en metres. */
const DEFAULT_TOL = 0.08;

/**
 * Altitude du sol sous (x, z three.js), memoisee au centimetre : les triangles
 * voisins partagent leurs sommets, et les coupes produisent les memes milieux.
 */
function makeSampler() {
  const cache = new Map<number, number>();
  return (x: number, z: number) => {
    const k = Math.round(x * 50) * 1e7 + Math.round(z * 50);
    let v = cache.get(k);
    if (v === undefined) {
      v = surfaceY(x, -z);
      cache.set(k, v);
    }
    return v;
  };
}

/**
 * Renvoie une geometrie NON indexee, recoupee et posee sur le sol. Tous les
 * attributs (uv, couleur...) sont interpoles aux coupes. Sans relief, la
 * geometrie est rendue telle quelle.
 */
export type DrapeOptions = { maxEdge?: number; minEdge?: number; tol?: number };

export function drapeGeometry(src: THREE.BufferGeometry, opt: DrapeOptions = {}): THREE.BufferGeometry {
  if (!elevation.on) return src;
  const MAX_EDGE = opt.maxEdge ?? DEFAULT_MAX_EDGE;
  const MIN_EDGE = opt.minEdge ?? DEFAULT_MIN_EDGE;
  const TOL = opt.tol ?? DEFAULT_TOL;
  const geo = src.index ? src.toNonIndexed() : src;
  const names = Object.keys(geo.attributes);
  const attrs = names.map((n) => geo.getAttribute(n) as THREE.BufferAttribute);
  const sizes = attrs.map((a) => a.itemSize);
  const posIdx = names.indexOf("position");
  const stride = sizes.reduce((a, b) => a + b, 0);
  const posOff = sizes.slice(0, posIdx).reduce((a, b) => a + b, 0);
  const ground = makeSampler();

  // Un sommet = tous ses attributs a la suite, pour interpoler d'un coup.
  const vert = (i: number): Float64Array => {
    const v = new Float64Array(stride);
    let o = 0;
    for (let a = 0; a < attrs.length; a++) {
      const arr = attrs[a].array;
      const s = sizes[a];
      for (let k = 0; k < s; k++) v[o + k] = arr[i * s + k];
      o += s;
    }
    return v;
  };
  const mid = (p: Float64Array, q: Float64Array) => {
    const m = new Float64Array(stride);
    for (let k = 0; k < stride; k++) m[k] = (p[k] + q[k]) / 2;
    return m;
  };
  const len2 = (p: Float64Array, q: Float64Array) => {
    const dx = p[posOff] - q[posOff];
    const dz = p[posOff + 2] - q[posOff + 2];
    return dx * dx + dz * dz;
  };
  // faut-il couper le cote pq ?
  const needs = (p: Float64Array, q: Float64Array, l2: number) => {
    if (l2 > MAX_EDGE * MAX_EDGE) return true;
    if (l2 < MIN_EDGE * MIN_EDGE) return false;
    const mx = (p[posOff] + q[posOff]) / 2;
    const mz = (p[posOff + 2] + q[posOff + 2]) / 2;
    const chord = (ground(p[posOff], p[posOff + 2]) + ground(q[posOff], q[posOff + 2])) / 2;
    return Math.abs(ground(mx, mz) - chord) > TOL;
  };

  const out: number[] = [];
  const emit = (v: Float64Array) => {
    for (let k = 0; k < stride; k++) out.push(k === posOff + 1 ? v[k] + ground(v[posOff], v[posOff + 2]) : v[k]);
  };

  const count = geo.getAttribute("position").count;
  const stack: Float64Array[][] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    stack.push([vert(t), vert(t + 1), vert(t + 2)]);
    while (stack.length) {
      const [a, b, c] = stack.pop()!;
      const ab = len2(a, b);
      const bc = len2(b, c);
      const ca = len2(c, a);
      // on ne coupe que le plus long cote : les triangles restent bien formes
      if (ab >= bc && ab >= ca && needs(a, b, ab)) {
        const m = mid(a, b);
        stack.push([a, m, c], [m, b, c]);
      } else if (bc >= ab && bc >= ca && needs(b, c, bc)) {
        const m = mid(b, c);
        stack.push([a, b, m], [a, m, c]);
      } else if (ca >= ab && ca >= bc && needs(c, a, ca)) {
        const m = mid(c, a);
        stack.push([a, b, m], [m, b, c]);
      } else {
        emit(a);
        emit(b);
        emit(c);
      }
    }
  }

  const n = out.length / stride;
  const res = new THREE.BufferGeometry();
  let o = 0;
  for (let a = 0; a < attrs.length; a++) {
    const s = sizes[a];
    const Ctor = attrs[a].array.constructor as Float32ArrayConstructor;
    const arr = new Ctor(n * s);
    for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[i * s + k] = out[i * stride + o + k];
    res.setAttribute(names[a], new THREE.BufferAttribute(arr, s, attrs[a].normalized));
    o += s;
  }
  if (res.getAttribute("normal")) res.computeVertexNormals();
  res.computeBoundingSphere();
  if (geo !== src) geo.dispose();
  return res;
}
