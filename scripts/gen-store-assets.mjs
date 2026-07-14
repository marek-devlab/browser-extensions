// Chrome Web Store listing assets that CAN be generated deterministically.
//
// Emits, per extension, the Chrome "small promo tile" at exactly 440x280 px:
//   store-assets/<extension>/promo-tile-440x280.png
//
// Everything is rendered with the same dependency-free rasterizer + PNG encoder
// used for the toolbar icons (scripts/lib/draw.mjs) -- 4x supersampled, box
// downsampled. Type is drawn with a hand-built geometric stroke font (there is
// no font rasterizer available); see store-assets/README.md for what a human
// still has to produce by hand (screenshots, marquee tile, ...).
//
// Regenerate with:  npm run store-assets

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BRAND,
  dGradient,
  downsample,
  drawIcon,
  drawText,
  encodePng,
  makeCanvas,
  measureText,
  mix,
  softCircle,
  WHITE,
} from './lib/draw.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const W = 440;
const H = 280;
const SS = 4;

// Dark neutral field: keeps the brand hue as the only saturated thing on the
// tile and guarantees white type stays high-contrast. Not near-black, so the
// tile still has body on the store's dark theme.
const FIELD_TOP = [23, 30, 46];
const FIELD_BOTTOM = [12, 17, 28];

const PUBLISHER = 'Blockaly';

/** Balanced greedy word wrap into exactly `n` lines (null if impossible). */
function wrapInto(words, n) {
  if (words.length < n) return null;
  const target = measureText(words.join(' ')) / n;
  const lines = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const linesLeft = n - lines.length; // lines still to emit, incl. the current one
    const wordsLeft = words.length - i; // words still to place, incl. `word`
    if (cur.length > 0 && linesLeft > 1) {
      // Forced break: every remaining line needs at least one word.
      const forced = wordsLeft <= linesLeft - 1;
      // Optional break: adding this word overshoots the balanced target.
      const overshoot = measureText([...cur, word].join(' ')) > target * 1.1;
      if (forced || (overshoot && wordsLeft > linesLeft - 1)) {
        lines.push(cur);
        cur = [];
      }
    }
    cur.push(word);
  }
  if (cur.length) lines.push(cur);
  if (lines.length !== n) return null;
  return lines.map((l) => l.join(' '));
}

/** Pick the line-breaking that lets the name render at the largest cap height. */
function layoutName(name, maxW, maxH) {
  const words = name.toUpperCase().split(/\s+/);
  const MAX_SCALE = 3.4; // cap height 34px
  const LINE_ADV = 15.5; // glyph units between baselines (cap 10 + leading)
  let best = null;
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const lines = wrapInto(words, n);
    if (!lines) continue;
    const widest = Math.max(...lines.map((l) => measureText(l)));
    const scale = Math.min(MAX_SCALE, maxW / widest, maxH / ((n - 1) * LINE_ADV + 10));
    if (!best || scale > best.scale) best = { lines, scale, lineAdv: LINE_ADV };
  }
  return best;
}

function renderTile(key) {
  const brand = BRAND[key];
  const c = makeCanvas(W * SS, H * SS);
  const S = (v) => v * SS; // final px -> canvas px

  // Field.
  const field = dGradient(0, 0, S(W), S(H), FIELD_TOP, FIELD_BOTTOM);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const [r, g, b] = field(x, y);
      const i = (y * c.w + x) * 4;
      c.px[i] = r;
      c.px[i + 1] = g;
      c.px[i + 2] = b;
      c.px[i + 3] = 1;
    }
  }

  // Brand glow behind the mark + a faint one bleeding off the right edge, so
  // the tile carries the product's hue without touching legibility.
  softCircle(c, S(90), S(140), S(190), brand.base, 0.42, 0);
  softCircle(c, S(430), S(40), S(160), brand.light, 0.14, 0);

  // The mark: the exact same artwork as the toolbar icon, at 120px.
  const ICON = 120;
  const iconX = 34;
  const iconY = (H - ICON) / 2;
  // Drop shadow to lift the plate off the field.
  softCircle(c, S(iconX + ICON / 2), S(iconY + ICON / 2 + 10), S(ICON * 0.72), [0, 0, 0], 0.35, 0.1);
  drawIcon(c, key, S(iconX), S(iconY), S(ICON));

  // Name.
  const textX = iconX + ICON + 28;
  const maxW = W - textX - 26;
  const layout = layoutName(brand.name, maxW, 150);
  const blockH = (layout.lines.length - 1) * layout.lineAdv * layout.scale + 10 * layout.scale;
  const pubCap = 9; // publisher cap height in final px
  const gap = 20;
  const totalH = blockH + gap + pubCap;
  let y = (H - totalH) / 2;

  for (const line of layout.lines) {
    drawText(c, line, S(textX), S(y), S(layout.scale), WHITE, { weight: 1.45 });
    y += layout.lineAdv * layout.scale;
  }

  // Publisher line, muted brand tint, wide tracking.
  const pubY = (H - totalH) / 2 + blockH + gap;
  drawText(c, PUBLISHER, S(textX), S(pubY), S(pubCap / 10), mix(brand.light, WHITE, 0.25), {
    weight: 1.7,
    tracking: 4.2,
    alpha: 0.85,
  });

  return encodePng(downsample(c, SS), W, H);
}

let count = 0;
for (const key of Object.keys(BRAND)) {
  const png = renderTile(key);
  const outPath = resolve(repoRoot, 'store-assets', key, 'promo-tile-440x280.png');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  count++;
  console.log(`  store-assets/${key}/promo-tile-440x280.png  (440x280, ${png.length} bytes)`);
}
console.log(`Generated ${count} Chrome small promo tiles.`);
console.log('Screenshots and the 1400x560 marquee tile CANNOT be generated here -- see store-assets/README.md.');
