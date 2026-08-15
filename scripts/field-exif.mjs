// Lecture EXIF minimale : position, cap de la boussole, focale, date.
//
// Sans dependance, et volontairement partielle. Ce qui est lu est ce dont le
// releve a besoin pour rattacher une photo a un sujet et mesurer l'ecart au
// poste calcule : la position (GPS IFD), le CAP AU DECLENCHEMENT
// (GPSImgDirection, que les telephones enregistrent et qui vaut cent fois mieux
// que la position seule pour savoir ce qui etait vise), la focale ramenee au
// 35 mm (elle dit quel objectif a servi, donc quel champ) et la date.
//
// Les macOS mdls / Spotlight donnent les memes champs, mais seulement si
// l'indexation a tourne sur le dossier : un dossier fraichement copie depuis un
// telephone n'est pas indexe. On lit donc le fichier.

const TAILLE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** @returns {{lon?:number,lat?:number,cap?:number,focale35?:number,date?:string}|null} */
export function lisExif(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // pas un JPEG

  // Parcours des marqueurs jusqu'au segment APP1 "Exif\0\0".
  let p = 2;
  let tiff = -1;
  while (p + 4 < buf.length) {
    if (buf[p] !== 0xff) break;
    const marqueur = buf[p + 1];
    if (marqueur === 0xda || marqueur === 0xd9) break; // debut des donnees image
    const taille = buf.readUInt16BE(p + 2);
    if (marqueur === 0xe1 && buf.toString("ascii", p + 4, p + 10) === "Exif\0\0") {
      tiff = p + 10;
      break;
    }
    p += 2 + taille;
  }
  if (tiff < 0 || tiff + 8 > buf.length) return null;

  const ordre = buf.toString("ascii", tiff, tiff + 2);
  if (ordre !== "II" && ordre !== "MM") return null;
  const le = ordre === "II";
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const valeurs = (o) => {
    const type = u16(o + 2);
    const n = u32(o + 4);
    const taille = (TAILLE[type] ?? 0) * n;
    if (!taille) return null;
    const base = taille <= 4 ? o + 8 : tiff + u32(o + 8);
    if (base + taille > buf.length) return null;
    if (type === 2) return buf.toString("ascii", base, base + n).replace(/\0.*$/, "");
    const out = [];
    for (let i = 0; i < n; i++) {
      const q = base + i * TAILLE[type];
      if (type === 1 || type === 7) out.push(buf[q]);
      else if (type === 3) out.push(u16(q));
      else if (type === 4 || type === 9) out.push(u32(q));
      else if (type === 5 || type === 10) {
        const d = u32(q + 4);
        out.push(d === 0 ? 0 : u32(q) / d);
      }
    }
    return out;
  };

  /** Toutes les entrees d'un IFD, indexees par tag. */
  const ifd = (offset) => {
    const table = new Map();
    if (offset + 2 > buf.length) return table;
    const n = u16(offset);
    for (let i = 0; i < n; i++) {
      const o = offset + 2 + i * 12;
      if (o + 12 > buf.length) break;
      table.set(u16(o), o);
    }
    return table;
  };

  const zero = ifd(tiff + u32(tiff + 4));
  const out = {};

  const gpsPtr = zero.get(0x8825);
  if (gpsPtr !== undefined) {
    const gps = ifd(tiff + valeurs(gpsPtr)[0]);
    const dms = (tag, refTag, negatif) => {
      const o = gps.get(tag), r = gps.get(refTag);
      if (o === undefined) return undefined;
      const v = valeurs(o);
      if (!v || v.length < 3) return undefined;
      const deg = v[0] + v[1] / 60 + v[2] / 3600;
      const ref = r === undefined ? "" : String(valeurs(r) ?? "");
      return negatif.includes(ref) ? -deg : deg;
    };
    const lat = dms(2, 1, "S");
    const lon = dms(4, 3, "W");
    if (lat !== undefined) out.lat = +lat.toFixed(6);
    if (lon !== undefined) out.lon = +lon.toFixed(6);
    const dir = gps.get(17);
    if (dir !== undefined) {
      const v = valeurs(dir);
      // Le ref vaut "M" (magnetique) ou "T" (vrai). A Saint-Etienne la
      // declinaison est d'environ 2 degres est, sous la precision utile ici :
      // on ne corrige pas, mais on ne pretend pas non plus au degre pres.
      if (v && v.length) out.cap = +v[0].toFixed(1);
    }
  }

  const exifPtr = zero.get(0x8769);
  if (exifPtr !== undefined) {
    const ex = ifd(tiff + valeurs(exifPtr)[0]);
    const f35 = ex.get(0xa405);
    if (f35 !== undefined) {
      const v = valeurs(f35);
      if (v && v.length) out.focale35 = v[0];
    }
    const date = ex.get(0x9003);
    if (date !== undefined) {
      const v = valeurs(date);
      if (typeof v === "string" && v.length) out.date = v;
    }
  }

  return out;
}
