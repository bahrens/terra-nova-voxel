// Procedurally draw a stylized isometric grass "voxel block" and emit PWA icon
// PNGs. Keeps the project's canvas-drawn / zero-asset ethos: the source of truth
// is this script; it just writes real PNG files because PWA manifest and
// apple-touch icons must be fetchable images. No dependencies — Node zlib only.
//
//   node tools/make-icons.mjs
//
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// ---- minimal PNG encoder (8-bit RGBA, filter 0) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, colour type 6 (RGBA)
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- the icon: an isometric grass block on a sky gradient ----
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
// Deterministic per-cell speckle so the texture is stable across sizes/runs.
const speckle = (ox, oy, amt) => {
  let h = (ox * 73856093) ^ (oy * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 2 * amt;
};

// geometry (normalized 0..1)
const CX = 0.5, TOP_CY = 0.35, W2 = 0.27, H2 = 0.135, H = 0.30, LIP = 0.052;
const SKY_TOP = [0x6d, 0xb7, 0xea], SKY_BOT = [0xc2, 0xe6, 0xf6];
const GRASS = [0x74, 0xc2, 0x47];       // top face
const LIP_R = [0x63, 0xa8, 0x3d], LIP_L = [0x52, 0x8f, 0x33]; // side grass overhang
const DIRT_R = [0x9c, 0x6e, 0x45], DIRT_L = [0x74, 0x4f, 0x2f]; // lit / shaded dirt
const SEAM = [0x2f, 0x25, 0x1a];

// Colour (opaque) at normalized (u,v); `cell` is the output-pixel index for speckle.
function colourAt(u, v, cx, cy) {
  const dxN = (u - CX) / W2, dyN = (v - TOP_CY) / H2;
  const rim = Math.abs(dxN) + Math.abs(dyN);
  if (rim <= 1) {
    if (rim > 0.965) return SEAM;                 // top-face outline
    const c = GRASS, s = speckle(cx, cy, 9);
    return [c[0] + s, c[1] + s * 1.4, c[2] + s];
  }
  // near-vertical front seam of the block
  const frontSeam = Math.abs(u - CX) < 0.006 && v > TOP_CY + H2 - 0.02;
  if (u >= CX && u <= CX + W2) {
    const topY = TOP_CY + H2 * ((CX + W2 - u) / W2);
    if (v >= topY && v <= topY + H) {
      if (frontSeam || u > CX + W2 - 0.006) return SEAM;
      const vOff = v - topY, s = speckle(cx, cy, 8);
      const base = vOff < LIP ? LIP_R : DIRT_R;
      return [base[0] + s, base[1] + s, base[2] + s];
    }
  } else if (u < CX && u >= CX - W2) {
    const topY = TOP_CY + H2 * ((u - (CX - W2)) / W2);
    if (v >= topY && v <= topY + H) {
      if (frontSeam || u < CX - W2 + 0.006) return SEAM;
      const vOff = v - topY, s = speckle(cx, cy, 8);
      const base = vOff < LIP ? LIP_L : DIRT_L;
      return [base[0] + s, base[1] + s, base[2] + s];
    }
  }
  return mix(SKY_TOP, SKY_BOT, v); // background sky
}

function draw(size) {
  const SS = 4; // supersample for smooth edges
  const out = Buffer.alloc(size * size * 4);
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (ox + (sx + 0.5) / SS) / size;
          const v = (oy + (sy + 0.5) / SS) / size;
          const c = colourAt(u, v, ox, oy);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (oy * size + ox) * 4;
      out[i] = Math.max(0, Math.min(255, Math.round(r / n)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round(g / n)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round(b / n)));
      out[i + 3] = 255;
    }
  }
  return out;
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [180, 192, 512]) {
  const png = encodePNG(size, draw(size));
  const path = new URL(`../icons/icon-${size}.png`, import.meta.url);
  writeFileSync(path, png);
  console.log(`wrote icons/icon-${size}.png (${png.length} bytes)`);
}
