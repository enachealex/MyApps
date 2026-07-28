/**
 * Rasterises public/icon.svg into the PNGs iOS and Android home screens need.
 *
 *   node scripts/make-icons.mjs
 *
 * sharp is not a project dependency — this runs by hand when the mark changes,
 * not on every build:
 *
 *   npm install --no-save sharp && node scripts/make-icons.mjs
 *
 * icon.svg has a corner radius baked in. That is right for a standalone image
 * and wrong for both home screens: iOS applies its own squircle mask, and
 * Android's maskable spec expects the background to bleed past the edges.
 * Rounded corners inside either mask show up as dark notches, so these are
 * generated from a squared-off variant while icon.svg is left as it is.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const BRAND = "#5B5FC7";

const src = readFileSync(join(PUBLIC_DIR, "icon.svg"), "utf8");
const square = src.replace(/\s+rx="96"/, "");

const targets = [
  ["apple-touch-icon.png", 180], // iOS home screen
  ["icon-192.png", 192], // PWA / Android
  ["icon-512.png", 512], // PWA splash and store listings
  ["favicon-64.png", 64], // browser tab
];

for (const [name, size] of targets) {
  const buf = await sharp(Buffer.from(square), { density: 384 })
    .resize(size, size)
    /* iOS paints any transparency black. The mark already has a solid ground;
       flattening makes that guaranteed rather than incidental. */
    .flatten({ background: BRAND })
    .png()
    .toBuffer();
  writeFileSync(join(PUBLIC_DIR, name), buf);
  console.log(`${name.padEnd(22)} ${size}x${size}  ${buf.length} bytes`);
}
