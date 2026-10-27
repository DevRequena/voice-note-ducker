// Generates the placeholder icons (no dependencies): a purple rounded square
// with four white bars getting shorter, i.e. "volume going down".
// Also writes the 300×300 store logo. Usage: node tools/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../icons/', import.meta.url));
const STORE_DIR = fileURLToPath(new URL('../store/images/', import.meta.url));
const SIZES = [16, 32, 48, 128];
const BG = [91, 75, 214];
const SUPERSAMPLE = 4;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shape in unit coordinates (0..1). Returns 0 = transparent, 1 = background, 2 = bar.
function shapeAt(x, y) {
  const r = 0.22;
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  if (dx * dx + dy * dy > r * r) return 0;
  const heights = [0.6, 0.45, 0.3, 0.18];
  const barWidth = 0.12;
  const gap = 0.06;
  const left = (1 - (heights.length * barWidth + (heights.length - 1) * gap)) / 2;
  const bottom = 0.78;
  for (let i = 0; i < heights.length; i++) {
    const x0 = left + i * (barWidth + gap);
    if (x >= x0 && x <= x0 + barWidth && y <= bottom && y >= bottom - heights[i]) return 2;
  }
  return 1;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let bar = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const hit = shapeAt((px + (sx + 0.5) / SUPERSAMPLE) / size, (py + (sy + 0.5) / SUPERSAMPLE) / size);
          if (hit === 1) bg++;
          if (hit === 2) bar++;
        }
      }
      const total = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = (bg + bar) / total;
      const white = alpha ? bar / (bg + bar) : 0;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] + (255 - BG[c]) * white);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) writeFileSync(`${OUT_DIR}icon${size}.png`, render(size));
mkdirSync(STORE_DIR, { recursive: true });
writeFileSync(`${STORE_DIR}logo-300x300.png`, render(300));
console.log(`Wrote ${SIZES.length} icons to ${OUT_DIR} and the store logo to ${STORE_DIR}`);
