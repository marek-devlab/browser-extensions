// Toolbar/store icon generator for the four browser extensions.
//
// No image libraries are installed (no sharp/canvas/jimp) and none are needed:
// the rasterizer + PNG encoder live in ./lib/draw.mjs and build the files from
// raw RGBA buffers (4x supersampled, box-downsampled for anti-aliasing, then
// framed as IHDR/IDAT/IEND with CRC32 and zlib DEFLATE).
//
// Regenerate with:  npm run icons
// Output:           extensions/<name>/public/icon/{16,32,48,128}.png
//
// Design notes for the suite live at the bottom of scripts/lib/draw.mjs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRAND, downsample, drawIcon, encodePng, makeCanvas } from './lib/draw.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor

let count = 0;
for (const name of Object.keys(BRAND)) {
  for (const size of SIZES) {
    const hi = size * SS;
    const canvas = makeCanvas(hi, hi);
    drawIcon(canvas, name, 0, 0, hi);
    const rgba = downsample(canvas, SS);
    const png = encodePng(rgba, size, size);
    const outPath = resolve(repoRoot, 'extensions', name, 'public', 'icon', `${size}.png`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, png);
    count++;
    console.log(`  extensions/${name}/public/icon/${size}.png  (${png.length} bytes)`);
  }
}
console.log(`Generated ${count} PNG icons.`);
