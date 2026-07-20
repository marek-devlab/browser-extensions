// Shared, dependency-free 2D rasterizer + PNG encoder.
//
// No image libraries are installed (no sharp/canvas/jimp) and none should be
// added. Everything here is built from scratch:
//   * a software rasterizer that renders into a float RGBA canvas at NxN
//     supersampling, then box-downsamples for anti-aliasing;
//   * a PNG encoder (signature + IHDR/IDAT/IEND chunks, CRC32 per PNG spec
//     Annex D) using only Node's built-in `zlib` for the DEFLATE step.
//
// Consumed by:
//   scripts/gen-icons.mjs         -> extension toolbar icons (square)
//   scripts/gen-store-assets.mjs  -> Chrome 440x280 promo tiles (rectangular)
//
// The canvas is rectangular (w x h); square icons are just the w === h case.

import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG framing
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Encode a raw RGBA buffer (w*h*4 bytes) into a PNG file buffer. */
export function encodePng(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Canvas + compositing
// ---------------------------------------------------------------------------

export function makeCanvas(w, h = w) {
  return { w, h, px: new Float32Array(w * h * 4) }; // straight-alpha RGBA
}

export function blend(c, x, y, r, g, b, a) {
  if (a <= 0) return;
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const p = c.px;
  const dstA = p[i + 3];
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  p[i] = (r * a + p[i] * dstA * (1 - a)) / outA;
  p[i + 1] = (g * a + p[i + 1] * dstA * (1 - a)) / outA;
  p[i + 2] = (b * a + p[i + 2] * dstA * (1 - a)) / outA;
  p[i + 3] = outA;
}

const lerp = (a, b, t) => a + (b - a) * t;
export const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// A "paint" is either a [r,g,b] triple or a function (x, y) -> [r,g,b].
function paintAt(paint, x, y) {
  return typeof paint === 'function' ? paint(x, y) : paint;
}

/**
 * Vertical linear gradient paint between two colors over [y0, y1].
 * Used for the shared background treatment across the whole icon suite.
 */
export function vGradient(y0, y1, top, bottom) {
  return (_x, y) => {
    const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0 || 1)));
    return mix(top, bottom, t);
  };
}

/** Diagonal gradient paint (top-left -> bottom-right). */
export function dGradient(x0, y0, x1, y1, from, to) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    return mix(from, to, t);
  };
}

// ---------------------------------------------------------------------------
// Primitives. All coordinates are in canvas (hi-res) space. Hard edges: the
// anti-aliasing comes from the supersample downsample.
// ---------------------------------------------------------------------------

export function fillRect(c, x0, y0, w, h, paint, a = 1) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) continue;
      const [r, g, b] = paintAt(paint, x, y);
      blend(c, x, y, r, g, b, typeof a === 'function' ? a(x, y) : a);
    }
  }
}

export function fillRoundRect(c, x0, y0, w, h, radius, paint, a = 1) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      let cx = null;
      let cy = null;
      if (x < x0 + radius && y < y0 + radius) { cx = x0 + radius; cy = y0 + radius; }
      else if (x >= x1 - radius && y < y0 + radius) { cx = x1 - radius; cy = y0 + radius; }
      else if (x < x0 + radius && y >= y1 - radius) { cx = x0 + radius; cy = y1 - radius; }
      else if (x >= x1 - radius && y >= y1 - radius) { cx = x1 - radius; cy = y1 - radius; }
      if (cx !== null) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      const [r, g, b] = paintAt(paint, x, y);
      blend(c, x, y, r, g, b, typeof a === 'function' ? a(x, y) : a);
    }
  }
}

export function fillCircle(c, cx, cy, radius, paint, a = 1) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y < Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x < Math.ceil(cx + radius); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const [r, g, b] = paintAt(paint, x, y);
      blend(c, x, y, r, g, b, typeof a === 'function' ? a(x, y) : a);
    }
  }
}

/**
 * Circle with a radial alpha falloff -- a real soft/blurred blob, not a hard
 * disc. `inner` is the fraction of the radius that stays at full alpha; alpha
 * then eases to 0 at the rim (smoothstep).
 */
export function softCircle(c, cx, cy, radius, paint, aMax = 1, inner = 0.25) {
  for (let y = Math.floor(cy - radius); y < Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x < Math.ceil(cx + radius); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / radius;
      if (d > 1) continue;
      let t = d <= inner ? 0 : (d - inner) / (1 - inner);
      const falloff = 1 - t * t * (3 - 2 * t); // smoothstep, 1 at core -> 0 at rim
      const [r, g, b] = paintAt(paint, x, y);
      blend(c, x, y, r, g, b, aMax * falloff);
    }
  }
}

export function fillRing(c, cx, cy, rOuter, rInner, paint, a = 1) {
  const ro2 = rOuter * rOuter;
  const ri2 = rInner * rInner;
  for (let y = Math.floor(cy - rOuter); y < Math.ceil(cy + rOuter); y++) {
    for (let x = Math.floor(cx - rOuter); x < Math.ceil(cx + rOuter); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > ro2 || d2 < ri2) continue;
      const [r, g, b] = paintAt(paint, x, y);
      blend(c, x, y, r, g, b, typeof a === 'function' ? a(x, y) : a);
    }
  }
}

const DEG = Math.PI / 180;

/**
 * Stroked elliptical arc. Angles in degrees, screen space (0 = +x / right,
 * 90 = +y / down). Ranges may wrap (e.g. -90 -> 90). `t` is stroke thickness.
 * Round caps are added for partial arcs so joins with lines look clean.
 */
export function strokeEllipseArc(c, cx, cy, rx, ry, t, a0, a1, paint, alpha = 1) {
  const rxo = rx + t / 2;
  const ryo = ry + t / 2;
  const rxi = Math.max(0.0001, rx - t / 2);
  const ryi = Math.max(0.0001, ry - t / 2);

  let lo = ((a0 % 360) + 360) % 360;
  let hi = lo + (a1 - a0);
  const full = Math.abs(a1 - a0) >= 359.9;

  for (let y = Math.floor(cy - ryo); y < Math.ceil(cy + ryo); y++) {
    for (let x = Math.floor(cx - rxo); x < Math.ceil(cx + rxo); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const uo = dx / rxo;
      const vo = dy / ryo;
      if (uo * uo + vo * vo > 1) continue;
      const ui = dx / rxi;
      const vi = dy / ryi;
      if (ui * ui + vi * vi < 1) continue;
      if (!full) {
        let ang = Math.atan2(dy, dx) / DEG;
        if (ang < 0) ang += 360;
        const inRange = (ang >= lo && ang <= hi) || (ang + 360 >= lo && ang + 360 <= hi);
        if (!inRange) continue;
      }
      const [r, g, b] = paintAt(paint, x, y);
      blend(c, x, y, r, g, b, typeof alpha === 'function' ? alpha(x, y) : alpha);
    }
  }

  if (!full) {
    for (const ang of [a0, a1]) {
      const px = cx + Math.cos(ang * DEG) * rx;
      const py = cy + Math.sin(ang * DEG) * ry;
      fillCircle(c, px, py, t / 2, paint, alpha);
    }
  }
}

/** Thick line segment with round caps. */
export function strokeLine(c, x0, y0, x1, y1, width, paint, a = 1) {
  const hw = width / 2;
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy || 1;
  const hw2 = hw * hw;
  for (let y = Math.floor(Math.min(y0, y1) - hw); y < Math.ceil(Math.max(y0, y1) + hw); y++) {
    for (let x = Math.floor(Math.min(x0, x1) - hw); x < Math.ceil(Math.max(x0, x1) + hw); x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      let t = (px * vx + py * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const dx = px - t * vx;
      const dy = py - t * vy;
      if (dx * dx + dy * dy > hw2) continue;
      const [r, g, b] = paintAt(paint, x, y);
      blend(c, x, y, r, g, b, typeof a === 'function' ? a(x, y) : a);
    }
  }
}

export function fillTriangle(c, ax, ay, bx, by, cx, cy, paint, a = 1) {
  fillPolygon(c, [[ax, ay], [bx, by], [cx, cy]], paint, a);
}

/** Even-odd scanline polygon fill (points: [[x,y], ...]). */
export function fillPolygon(c, pts, paint, a = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
    const py = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 === y2) continue;
      if (py >= Math.min(y1, y2) && py < Math.max(y1, y2)) {
        xs.push(x1 + ((py - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.floor(xs[k]); x < Math.ceil(xs[k + 1]); x++) {
        if (x + 0.5 < xs[k] || x + 0.5 > xs[k + 1]) continue;
        const [r, g, b] = paintAt(paint, x, y);
        blend(c, x, y, r, g, b, typeof a === 'function' ? a(x, y) : a);
      }
    }
  }
}

/** Box-downsample the hi-res canvas by `factor`. Returns an RGBA Buffer. */
export function downsample(c, factor) {
  const w = Math.round(c.w / factor);
  const h = Math.round(c.h / factor);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * c.w + (x * factor + sx)) * 4;
          const pa = c.px[i + 3];
          r += c.px[i] * pa;
          g += c.px[i + 1] * pa;
          b += c.px[i + 2] * pa;
          a += pa;
        }
      }
      const n = factor * factor;
      const oi = (y * w + x) * 4;
      const avgA = a / n;
      if (avgA > 0) {
        out[oi] = Math.round(r / a);
        out[oi + 1] = Math.round(g / a);
        out[oi + 2] = Math.round(b / a);
      }
      out[oi + 3] = Math.round(avgA * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stroke font (geometric uppercase). Glyphs live in a 0..W x 0..10 box, y down,
// y=0 is the cap line and y=10 the baseline. Ops:
//   ['l', x0, y0, x1, y1]                     line
//   ['a', cx, cy, rx, ry, startDeg, endDeg]   elliptical arc
// Only what a promo tile needs: A-Z, digits, space, '&', '.', '-'.
// ---------------------------------------------------------------------------

const GLYPHS = {
  A: { w: 6.4, ops: [['l', 0.2, 10, 3.2, 0], ['l', 3.2, 0, 6.2, 10], ['l', 1.3, 6.9, 5.1, 6.9]] },
  B: { w: 6.0, ops: [['l', 0, 0, 0, 10], ['l', 0, 0, 1.0, 0], ['l', 0, 5, 1.0, 5], ['l', 0, 10, 1.0, 10], ['a', 1.0, 2.5, 2.6, 2.5, -90, 90], ['a', 1.0, 7.5, 2.9, 2.5, -90, 90]] },
  C: { w: 6.2, ops: [['a', 3.1, 5, 3.0, 5.0, 40, 320]] },
  D: { w: 6.4, ops: [['l', 0, 0, 0, 10], ['l', 0, 0, 1.6, 0], ['l', 0, 10, 1.6, 10], ['a', 1.6, 5, 3.4, 5, -90, 90]] },
  E: { w: 5.4, ops: [['l', 0, 0, 0, 10], ['l', 0, 0, 5.2, 0], ['l', 0, 5, 4.3, 5], ['l', 0, 10, 5.2, 10]] },
  F: { w: 5.4, ops: [['l', 0, 0, 0, 10], ['l', 0, 0, 5.2, 0], ['l', 0, 5, 4.3, 5]] },
  G: { w: 6.6, ops: [['a', 3.1, 5, 3.0, 5.0, 40, 320], ['l', 3.4, 5.6, 6.2, 5.6], ['l', 6.2, 5.6, 6.2, 8.4]] },
  H: { w: 6.2, ops: [['l', 0, 0, 0, 10], ['l', 6.2, 0, 6.2, 10], ['l', 0, 5, 6.2, 5]] },
  I: { w: 0.6, ops: [['l', 0.3, 0, 0.3, 10]] },
  J: { w: 5.2, ops: [['l', 5.0, 0, 5.0, 7.4], ['a', 2.5, 7.4, 2.5, 2.6, 0, 180]] },
  K: { w: 6.0, ops: [['l', 0, 0, 0, 10], ['l', 5.8, 0, 0.4, 5.6], ['l', 1.6, 4.4, 6.0, 10]] },
  L: { w: 5.2, ops: [['l', 0, 0, 0, 10], ['l', 0, 10, 5.2, 10]] },
  M: { w: 7.6, ops: [['l', 0, 10, 0, 0], ['l', 0, 0, 3.8, 6.4], ['l', 3.8, 6.4, 7.6, 0], ['l', 7.6, 0, 7.6, 10]] },
  N: { w: 6.4, ops: [['l', 0, 10, 0, 0], ['l', 0, 0, 6.4, 10], ['l', 6.4, 10, 6.4, 0]] },
  O: { w: 6.6, ops: [['a', 3.3, 5, 3.3, 5, 0, 360]] },
  P: { w: 6.0, ops: [['l', 0, 0, 0, 10], ['l', 0, 0, 1.4, 0], ['l', 0, 5.4, 1.4, 5.4], ['a', 1.4, 2.7, 3.2, 2.7, -90, 90]] },
  Q: { w: 6.6, ops: [['a', 3.3, 5, 3.3, 5, 0, 360], ['l', 3.9, 7.2, 6.6, 10.6]] },
  R: { w: 6.2, ops: [['l', 0, 0, 0, 10], ['l', 0, 0, 1.4, 0], ['l', 0, 5.4, 1.4, 5.4], ['a', 1.4, 2.7, 3.2, 2.7, -90, 90], ['l', 2.2, 5.4, 6.2, 10]] },
  S: { w: 6.0, ops: [['a', 3.0, 2.7, 2.6, 2.7, 95, 340], ['a', 3.0, 7.3, 2.6, 2.7, -85, 160]] },
  T: { w: 6.0, ops: [['l', 0, 0, 6.0, 0], ['l', 3.0, 0, 3.0, 10]] },
  U: { w: 6.4, ops: [['l', 0, 0, 0, 6.6], ['l', 6.4, 0, 6.4, 6.6], ['a', 3.2, 6.6, 3.2, 3.4, 0, 180]] },
  V: { w: 6.4, ops: [['l', 0, 0, 3.2, 10], ['l', 3.2, 10, 6.4, 0]] },
  W: { w: 9.0, ops: [['l', 0, 0, 1.8, 10], ['l', 1.8, 10, 4.5, 3.6], ['l', 4.5, 3.6, 7.2, 10], ['l', 7.2, 10, 9.0, 0]] },
  X: { w: 6.2, ops: [['l', 0, 0, 6.2, 10], ['l', 6.2, 0, 0, 10]] },
  Y: { w: 6.2, ops: [['l', 0, 0, 3.1, 5.2], ['l', 6.2, 0, 3.1, 5.2], ['l', 3.1, 5.2, 3.1, 10]] },
  Z: { w: 6.0, ops: [['l', 0, 0, 6.0, 0], ['l', 6.0, 0, 0, 10], ['l', 0, 10, 6.0, 10]] },
  '&': {
    w: 7.0,
    ops: [
      // Bowl (top loop) + the diagonal that sweeps down-right + bottom-left bowl.
      ['a', 2.6, 2.4, 2.0, 2.4, 0, 360],
      ['a', 2.8, 7.0, 2.8, 3.0, 100, 330],
      ['l', 4.0, 4.2, 7.0, 10],
    ],
  },
  '.': { w: 0.8, ops: [['l', 0.4, 9.7, 0.4, 10]] },
  '-': { w: 4.0, ops: [['l', 0, 5, 4.0, 5]] },
  '0': { w: 6.0, ops: [['a', 3.0, 5, 3.0, 5, 0, 360]] },
  '1': { w: 3.0, ops: [['l', 0.2, 1.8, 2.0, 0], ['l', 2.0, 0, 2.0, 10]] },
  '2': { w: 6.0, ops: [['a', 3.0, 3.0, 3.0, 3.0, 180, 350], ['l', 5.6, 4.2, 0, 10], ['l', 0, 10, 6.0, 10]] },
  '3': { w: 6.0, ops: [['a', 2.6, 2.6, 2.6, 2.6, 190, 90], ['a', 2.6, 7.4, 2.6, 2.6, 270, 170]] },
  '4': { w: 6.4, ops: [['l', 4.8, 0, 0, 7.0], ['l', 0, 7.0, 6.4, 7.0], ['l', 4.8, 0, 4.8, 10]] },
  '5': { w: 6.0, ops: [['l', 5.6, 0, 0.6, 0], ['l', 0.6, 0, 0.2, 4.2], ['a', 3.0, 6.9, 3.0, 3.1, 250, 160]] },
  '6': { w: 6.0, ops: [['a', 3.0, 6.7, 3.0, 3.3, 0, 360], ['l', 0.2, 6.0, 3.2, 0]] },
  '7': { w: 6.0, ops: [['l', 0, 0, 6.0, 0], ['l', 6.0, 0, 2.4, 10]] },
  '8': { w: 6.0, ops: [['a', 3.0, 2.6, 2.6, 2.6, 0, 360], ['a', 3.0, 7.4, 3.0, 2.6, 0, 360]] },
  '9': { w: 6.0, ops: [['a', 3.0, 3.3, 3.0, 3.3, 0, 360], ['l', 5.8, 4.0, 2.8, 10]] },
};

const SPACE_W = 3.2;
const TRACKING = 2.2; // extra advance between glyphs, in glyph units

/** Width of `text` in glyph units at scale 1 (cap height 10). */
export function measureText(text, { tracking = TRACKING } = {}) {
  let w = 0;
  const chars = [...text.toUpperCase()];
  chars.forEach((ch, i) => {
    if (ch === ' ') w += SPACE_W + tracking;
    else {
      const g = GLYPHS[ch];
      if (!g) return;
      w += g.w + (i === chars.length - 1 ? 0 : tracking);
    }
  });
  return w;
}

/**
 * Draw `text` with the geometric stroke font.
 * @param scale     multiplier on the 10-unit cap height (cap height = 10*scale)
 * @param weight    stroke width in glyph units (1.5 ~= a bold geometric sans)
 */
export function drawText(c, text, x, y, scale, paint, { weight = 1.5, alpha = 1, tracking = TRACKING } = {}) {
  const sx = (u) => x + u * scale;
  const sy = (v) => y + v * scale;
  const sw = weight * scale;
  let pen = 0;
  for (const ch of [...text.toUpperCase()]) {
    if (ch === ' ') {
      pen += SPACE_W + tracking;
      continue;
    }
    const g = GLYPHS[ch];
    if (!g) continue;
    for (const op of g.ops) {
      if (op[0] === 'l') {
        const [, x0, y0, x1, y1] = op;
        strokeLine(c, sx(pen + x0), sy(y0), sx(pen + x1), sy(y1), sw, paint, alpha);
      } else if (op[0] === 'a') {
        const [, cx, cy, rx, ry, a0, a1] = op;
        strokeEllipseArc(c, sx(pen + cx), sy(cy), rx * scale, ry * scale, sw, a0, a1, paint, alpha);
      }
    }
    pen += g.w + tracking;
  }
  return pen * scale;
}

// ---------------------------------------------------------------------------
// Brand palette + the four product marks.
//
// Shared visual language across the suite:
//   * full-bleed rounded square, corner radius = 0.22 * S, 2% inset
//   * background = diagonal gradient from a lighter to a deeper tint of the
//     brand hue (saturated mid-tones: never near-white, never near-black, so
//     the tile holds its own on both light and dark toolbars)
//   * mark = white (pure or translucent), bold, few shapes, no thin strokes,
//     no text; sized so it still reads as a silhouette at 16x16
//   * each product owns a distinct hue AND a distinct silhouette:
//       blur    blue    dissolving disc      (soft round blob, fades right)
//       adblock red     shield with slash    (pointed heraldic shape)
//       perf    green   speed gauge          (fat arc + needle)
//       seo     purple  magnifier            (ring + diagonal handle)
// ---------------------------------------------------------------------------

export const WHITE = [255, 255, 255];

export const BRAND = {
  blur: { light: [96, 165, 250], base: [37, 99, 235], deep: [29, 78, 216], name: 'Content Blur' },
  adblock: { light: [248, 113, 113], base: [220, 38, 38], deep: [185, 28, 28], name: 'Ad & Tracker Blocker' },
  perf: { light: [52, 211, 153], base: [16, 163, 90], deep: [4, 120, 87], name: 'Page Performance & Network' },
  seo: { light: [167, 139, 250], base: [124, 58, 237], deep: [91, 33, 182], name: 'SEO & Accessibility Auditor' },
  // Second wave. Same rules: own hue, own silhouette, readable at 16x16.
  //   devdata amber   chevrons        (< >, the only opposed pair)
  //   export  teal    arrow into tray (the only downward arrow)
  //   assets  pink    crosshair       (the only reticle)
  //   whoami  indigo  signal arcs     (the only stack of arcs)
  //   capture orange  record dot      (the only solid dot in brackets)
  //   compose cyan    text lines      (the only stack of bars)
  devdata: { light: [252, 211, 77], base: [245, 158, 11], deep: [180, 83, 9], name: 'Data Format Toolkit' },
  export: { light: [45, 212, 191], base: [13, 148, 136], deep: [15, 118, 110], name: 'Page Content Exporter' },
  assets: { light: [244, 114, 182], base: [219, 39, 119], deep: [157, 23, 77], name: 'Asset Inspector' },
  whoami: { light: [129, 140, 248], base: [79, 70, 229], deep: [55, 48, 163], name: 'Connection & Device Info' },
  capture: { light: [251, 146, 60], base: [234, 88, 12], deep: [154, 52, 18], name: 'Capture Studio' },
  compose: { light: [103, 232, 249], base: [8, 145, 178], deep: [14, 116, 144], name: 'Markdown Workbench' },
  // Third wave. Same rules: own hue, own silhouette, readable at 16x16.
  //   convert   lime      swap arrows      (the only opposed ⇄ pair)
  //   linksafe  slate     redirect arrow   (the only bent ↳ arrow)
  //   vision    fuchsia   spectacles       (the only twin-lens)
  //   sessions  rose      tabbed window    (the only window-with-tabs)
  convert: { light: [163, 230, 53], base: [132, 204, 22], deep: [77, 124, 15], name: 'Universal Converter' },
  linksafe: { light: [148, 163, 184], base: [100, 116, 139], deep: [51, 65, 85], name: 'Link Inspector' },
  vision: { light: [232, 121, 249], base: [217, 70, 239], deep: [162, 28, 175], name: 'Vision Simulator' },
  sessions: { light: [251, 113, 133], base: [244, 63, 94], deep: [159, 18, 57], name: 'Session Saver' },
};

/** The shared background plate: rounded square, brand diagonal gradient. */
export function drawPlate(c, x, y, S, brand) {
  const inset = S * 0.02;
  const paint = dGradient(x, y, x + S, y + S, brand.light, brand.deep);
  fillRoundRect(c, x + inset, y + inset, S - inset * 2, S - inset * 2, S * 0.22, paint);
  // Soft top-left sheen ties the four together and gives the plate depth.
  softCircle(c, x + S * 0.28, y + S * 0.2, S * 0.55, WHITE, 0.1, 0);
}

// blur -- a crisp disc that dissolves into a soft gradient toward the lower
// right. Silhouette: a bright round core with a fading halo (nothing else in
// the suite is a soft blob).
function markBlur(c, x, y, S) {
  const cx = x + S * 0.42;
  const cy = y + S * 0.44;
  // Dissolving halo: three progressively larger, softer, offset blobs.
  softCircle(c, x + S * 0.62, y + S * 0.62, S * 0.36, WHITE, 0.34, 0);
  softCircle(c, x + S * 0.55, y + S * 0.55, S * 0.3, WHITE, 0.4, 0.05);
  softCircle(c, cx, cy, S * 0.33, WHITE, 0.6, 0.15);
  // Crisp core: the "un-blurred" half of the mark. Hard edge = the contrast
  // that makes the halo read as blur rather than as a fuzzy mistake.
  fillCircle(c, cx, cy, S * 0.19, WHITE, 1);
  // Hard sliver on the left keeps a sharp edge even at 16px.
  fillCircle(c, x + S * 0.34, y + S * 0.36, S * 0.1, WHITE, 1);
}

// adblock -- heraldic shield with a bold slash. Silhouette: pointed shield.
function markAdblock(c, x, y, S) {
  const cx = x + S * 0.5;
  const top = y + S * 0.2;
  const halfW = S * 0.29;
  const shoulder = y + S * 0.55;
  const tip = y + S * 0.83;
  fillPolygon(
    c,
    [
      [cx - halfW, top],
      [cx + halfW, top],
      [cx + halfW, shoulder],
      [cx, tip],
      [cx - halfW, shoulder],
    ],
    WHITE,
    1,
  );
  // Round the shield's top corners a touch so it matches the plate radius.
  fillCircle(c, cx - halfW + S * 0.03, top + S * 0.03, S * 0.03, WHITE, 1);
  fillCircle(c, cx + halfW - S * 0.03, top + S * 0.03, S * 0.03, WHITE, 1);
  // The slash: knocked out in the deep brand tint so it reads as a "blocked"
  // bar rather than as a separate white shape.
  const midY = (top + tip) / 2;
  const deepRed = [140, 18, 18];
  strokeLine(c, cx - S * 0.18, midY + S * 0.08, cx + S * 0.18, midY - S * 0.08, S * 0.105, deepRed, 1);
}

// perf -- speed gauge: a fat arc with a chunky needle. Silhouette: a wide
// horseshoe. Deliberately fat (arc band ~0.13*S) so it survives 16px.
function markPerf(c, x, y, S) {
  const cx = x + S * 0.5;
  const cy = y + S * 0.64;
  const r = S * 0.3;
  strokeEllipseArc(c, cx, cy, r, r, S * 0.13, 180, 360, WHITE, 0.95);
  // Needle pointing to the "fast" end (up-right).
  const ang = -55 * DEG;
  strokeLine(c, cx - Math.cos(ang) * S * 0.04, cy - Math.sin(ang) * S * 0.04, cx + Math.cos(ang) * S * 0.29, cy + Math.sin(ang) * S * 0.29, S * 0.085, WHITE, 1);
  // Hub.
  fillCircle(c, cx, cy, S * 0.075, WHITE, 1);
}

// seo -- magnifier. Silhouette: ring + diagonal handle (the only diagonal
// stick in the suite). Lens is tinted so the mark has mass at 16px.
function markSeo(c, x, y, S) {
  const cx = x + S * 0.43;
  const cy = y + S * 0.41;
  const rOuter = S * 0.28;
  const rInner = S * 0.17;
  // Handle first, so the ring sits cleanly on top of it.
  const hx = cx + Math.cos(45 * DEG) * (rOuter - S * 0.02);
  const hy = cy + Math.sin(45 * DEG) * (rOuter - S * 0.02);
  strokeLine(c, hx, hy, hx + S * 0.19, hy + S * 0.19, S * 0.13, WHITE, 1);
  fillCircle(c, cx, cy, rInner, WHITE, 0.35); // glass
  fillRing(c, cx, cy, rOuter, rInner, WHITE, 1);
}

// devdata -- opposed chevrons. Silhouette: two arrowheads pointing away from a
// gap. Strokes are fat (0.11*S) because two thin V's would mush together at 16px.
function markDevdata(c, x, y, S) {
  const w = S * 0.1;
  const midY = y + S * 0.5;
  const dy = S * 0.16;
  // Left chevron "<".
  strokeLine(c, x + S * 0.4, midY - dy, x + S * 0.24, midY, w, WHITE, 1);
  strokeLine(c, x + S * 0.24, midY, x + S * 0.4, midY + dy, w, WHITE, 1);
  // Right chevron ">".
  strokeLine(c, x + S * 0.6, midY - dy, x + S * 0.76, midY, w, WHITE, 1);
  strokeLine(c, x + S * 0.76, midY, x + S * 0.6, midY + dy, w, WHITE, 1);
  // Center slash: what turns "<>" into "data between delimiters" rather than a tag.
  strokeLine(c, x + S * 0.54, midY - dy - S * 0.04, x + S * 0.46, midY + dy + S * 0.04, S * 0.07, WHITE, 0.75);
}

// export -- an arrow dropping into an open tray. Silhouette: down arrow above a
// U. The tray is open at the top so it never reads as a closed box (that's the
// "save" gesture, not "download to disk").
function markExport(c, x, y, S) {
  const cx = x + S * 0.5;
  const shaftTop = y + S * 0.2;
  const shaftBottom = y + S * 0.5;
  strokeLine(c, cx, shaftTop, cx, shaftBottom, S * 0.1, WHITE, 1);
  fillTriangle(c, cx - S * 0.17, shaftBottom - S * 0.02, cx + S * 0.17, shaftBottom - S * 0.02, cx, y + S * 0.68, WHITE, 1);
  // Tray: two shoulders + a floor.
  const trayY = y + S * 0.58;
  const floorY = y + S * 0.78;
  const half = S * 0.27;
  strokeLine(c, cx - half, trayY, cx - half, floorY, S * 0.09, WHITE, 1);
  strokeLine(c, cx + half, trayY, cx + half, floorY, S * 0.09, WHITE, 1);
  strokeLine(c, cx - half, floorY, cx + half, floorY, S * 0.09, WHITE, 1);
}

// assets -- a reticle over the picked element. Silhouette: ring with four ticks
// breaking out of it, plus a solid center. Nothing else in the suite is a
// symmetric cross.
function markAssets(c, x, y, S) {
  const cx = x + S * 0.5;
  const cy = y + S * 0.5;
  const rOuter = S * 0.27;
  const rInner = S * 0.19;
  fillRing(c, cx, cy, rOuter, rInner, WHITE, 1);
  fillCircle(c, cx, cy, S * 0.075, WHITE, 1);
  const t = S * 0.085;
  const reach = S * 0.36;
  strokeLine(c, cx, cy - rOuter + S * 0.02, cx, cy - reach, t, WHITE, 1);
  strokeLine(c, cx, cy + rOuter - S * 0.02, cx, cy + reach, t, WHITE, 1);
  strokeLine(c, cx - rOuter + S * 0.02, cy, cx - reach, cy, t, WHITE, 1);
  strokeLine(c, cx + rOuter - S * 0.02, cy, cx + reach, cy, t, WHITE, 1);
}

// whoami -- signal arcs rising from a point. Silhouette: a fan of nested arcs
// over a dot: "this device, and what it reaches".
function markWhoami(c, x, y, S) {
  const cx = x + S * 0.5;
  const cy = y + S * 0.74;
  fillCircle(c, cx, cy, S * 0.085, WHITE, 1);
  strokeEllipseArc(c, cx, cy, S * 0.19, S * 0.19, S * 0.085, 200, 340, WHITE, 1);
  strokeEllipseArc(c, cx, cy, S * 0.3, S * 0.3, S * 0.085, 205, 335, WHITE, 0.78);
  strokeEllipseArc(c, cx, cy, S * 0.41, S * 0.41, S * 0.085, 210, 330, WHITE, 0.5);
}

// capture -- record dot inside viewfinder brackets. Silhouette: solid disc with
// four corner ticks. The disc is the only fully solid circle in the suite.
function markCapture(c, x, y, S) {
  const cx = x + S * 0.5;
  const cy = y + S * 0.5;
  fillCircle(c, cx, cy, S * 0.17, WHITE, 1);
  const t = S * 0.075;
  const a = S * 0.2; // bracket start (from edge)
  const b = S * 0.34; // bracket arm length
  const near = S * 0.22;
  const far = S * 0.78;
  // Top-left / top-right / bottom-left / bottom-right corner brackets.
  strokeLine(c, x + near, y + near, x + near + (b - a), y + near, t, WHITE, 0.9);
  strokeLine(c, x + near, y + near, x + near, y + near + (b - a), t, WHITE, 0.9);
  strokeLine(c, x + far, y + near, x + far - (b - a), y + near, t, WHITE, 0.9);
  strokeLine(c, x + far, y + near, x + far, y + near + (b - a), t, WHITE, 0.9);
  strokeLine(c, x + near, y + far, x + near + (b - a), y + far, t, WHITE, 0.9);
  strokeLine(c, x + near, y + far, x + near, y + far - (b - a), t, WHITE, 0.9);
  strokeLine(c, x + far, y + far, x + far - (b - a), y + far, t, WHITE, 0.9);
  strokeLine(c, x + far, y + far, x + far, y + far - (b - a), t, WHITE, 0.9);
}

// compose -- lines of text with a caret. Silhouette: a stack of bars of
// unequal length (a paragraph being written), with the last one short and a
// solid cursor block after it.
function markCompose(c, x, y, S) {
  const left = x + S * 0.24;
  const t = S * 0.095;
  const rows = [
    [0.3, 0.52], // y fraction, bar width fraction
    [0.44, 0.44],
    [0.58, 0.52],
  ];
  for (const [fy, fw] of rows) {
    strokeLine(c, left, y + S * fy, left + S * fw, y + S * fy, t, WHITE, 1);
  }
  // Short final line + caret block: the "still typing" beat.
  strokeLine(c, left, y + S * 0.72, left + S * 0.22, y + S * 0.72, t, WHITE, 1);
  fillRect(c, left + S * 0.28, y + S * 0.66, S * 0.075, S * 0.13, WHITE, 1);
}

// convert -- opposed swap arrows (⇄). Silhouette: two horizontal arrows pointing
// opposite ways. The only opposed arrow PAIR in the suite (devdata's chevrons are
// static, export's arrow is a single downward stroke).
function markConvert(c, x, y, S) {
  const t = S * 0.09;
  const left = x + S * 0.26;
  const right = x + S * 0.74;
  const yTop = y + S * 0.4;
  const yBot = y + S * 0.6;
  // Top arrow → right.
  strokeLine(c, left, yTop, right - S * 0.13, yTop, t, WHITE, 1);
  fillTriangle(c, right, yTop, right - S * 0.16, yTop - S * 0.12, right - S * 0.16, yTop + S * 0.12, WHITE, 1);
  // Bottom arrow ← left.
  strokeLine(c, right, yBot, left + S * 0.13, yBot, t, WHITE, 1);
  fillTriangle(c, left, yBot, left + S * 0.16, yBot - S * 0.12, left + S * 0.16, yBot + S * 0.12, WHITE, 1);
}

// linksafe -- a redirect arrow (↳) from a source node. Silhouette: a dot, a down
// stroke, then a right stroke into an arrowhead: "where this link actually goes".
// The only bent arrow in the suite.
function markLinksafe(c, x, y, S) {
  const t = S * 0.09;
  const sx = x + S * 0.33;
  const sy = y + S * 0.24;
  const cornerY = y + S * 0.64;
  const ex = x + S * 0.68;
  fillCircle(c, sx, sy, S * 0.075, WHITE, 1); // the source link node
  strokeLine(c, sx, sy, sx, cornerY, t, WHITE, 1);
  strokeLine(c, sx - t * 0.4, cornerY, ex, cornerY, t, WHITE, 1);
  fillTriangle(c, ex + S * 0.03, cornerY, ex - S * 0.13, cornerY - S * 0.12, ex - S * 0.13, cornerY + S * 0.12, WHITE, 1);
}

// vision -- spectacles: two lenses, a bridge, temple arms. Silhouette: a twin-lens
// pair (the only double-ring; seo is a single ring with a handle, assets a single
// ring with a cross).
function markVision(c, x, y, S) {
  const cy = y + S * 0.54;
  const r = S * 0.19;
  const ri = S * 0.115;
  const lx = x + S * 0.33;
  const rx = x + S * 0.67;
  strokeLine(c, lx - r + S * 0.02, cy - S * 0.04, x + S * 0.14, y + S * 0.34, S * 0.07, WHITE, 1); // left arm
  strokeLine(c, rx + r - S * 0.02, cy - S * 0.04, x + S * 0.86, y + S * 0.34, S * 0.07, WHITE, 1); // right arm
  strokeLine(c, lx + r - S * 0.02, cy - S * 0.02, rx - r + S * 0.02, cy - S * 0.02, S * 0.07, WHITE, 1); // bridge
  fillCircle(c, lx, cy, ri, WHITE, 0.3); // glass
  fillCircle(c, rx, cy, ri, WHITE, 0.3);
  fillRing(c, lx, cy, r, ri, WHITE, 1);
  fillRing(c, rx, cy, r, ri, WHITE, 1);
}

// sessions -- a browser window with three tabs. Silhouette: a solid body with a
// tabbed top (the gaps between tabs show the plate). The only window-with-tabs.
function markSessions(c, x, y, S) {
  const wx = x + S * 0.22;
  const ww = S * 0.56;
  const wy = y + S * 0.44;
  const wh = S * 0.32;
  const tw = S * 0.155;
  const th = S * 0.15;
  const ty = y + S * 0.29;
  const gap = S * 0.0475; // 3*tw + 2*gap === ww; tabs meet the window top (ty+th===wy)
  fillRect(c, wx, ty, tw, th, WHITE, 1);
  fillRect(c, wx + tw + gap, ty, tw, th, WHITE, 1);
  fillRect(c, wx + 2 * (tw + gap), ty, tw, th, WHITE, 1);
  fillRect(c, wx, wy, ww, wh, WHITE, 1);
}

export const MARKS = {
  blur: markBlur,
  adblock: markAdblock,
  perf: markPerf,
  seo: markSeo,
  devdata: markDevdata,
  export: markExport,
  assets: markAssets,
  whoami: markWhoami,
  capture: markCapture,
  compose: markCompose,
  convert: markConvert,
  linksafe: markLinksafe,
  vision: markVision,
  sessions: markSessions,
};

/** Full icon = shared plate + product mark, drawn at (x, y) with side S. */
export function drawIcon(c, name, x, y, S) {
  drawPlate(c, x, y, S, BRAND[name]);
  MARKS[name](c, x, y, S);
}
