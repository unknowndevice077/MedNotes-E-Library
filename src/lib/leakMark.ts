// Hidden buyer mark: 36 bits tiled over the reader at ~1.6% strength. Nobody can see it, but a
// screenshot keeps it, so a leaked screenshot can be traced to the account that took it
// (Admin → Restrictions → Trace a leaked screenshot).
// 36 bits = 4 sync bits + 24 bits of the buyer's id + 8-bit check, laid out 6 × 6. Each bit is a
// 2 × 2 checker of darker/lighter cells (flipped for 0), so page edges, toolbars and other straight
// lines in the screenshot cancel out when it's read back.

const SYNC = [1, 0, 1, 0];
export const CELL = 4; // CSS px per cell; a bit is 2 × 2 cells, a tile is 6 × 6 bits = 48px
export const TILE = CELL * 12;
export const STRENGTH = 4 / 255;

function crc8(bytes: number[]) {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

const bitsOf = (n: number, len: number) => Array.from({ length: len }, (_, i) => (n >> (len - 1 - i)) & 1);
const checkOf = (id: number) => crc8([id >> 16, (id >> 8) & 0xff, id & 0xff]);

/** The 36 bits for a user: the first 6 hex digits of their id, plus a check. */
export function markBits(uid: string) {
  const id = parseInt(uid.replace(/-/g, '').slice(0, 6), 16);
  return [...SYNC, ...bitsOf(id, 24), ...bitsOf(checkOf(id), 8)];
}

/** One tile as a PNG data URL (black = darker, white = lighter); shown at STRENGTH opacity. */
export function markTile(uid: string) {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d')!;
  markBits(uid).forEach((b, i) => {
    const bx = (i % 6) * 2 * CELL, by = Math.floor(i / 6) * 2 * CELL;
    for (let k = 0; k < 4; k++) {
      const diag = k === 0 || k === 3; // top-left and bottom-right
      ctx.fillStyle = diag === !!b ? '#000' : '#fff';
      ctx.fillRect(bx + (k % 2) * CELL, by + Math.floor(k / 2) * CELL, CELL, CELL);
    }
  });
  return c.toDataURL('image/png');
}

/** What the last readMark() saw (for checking a hard case by hand). */
export let lastRead: { bits: number[]; score: number; scale: number } | null = null;

/**
 * Reads the mark back from a screenshot. Tries the usual screen scales (100–300%), folds the whole
 * picture onto one tile so the page content averages out, then finds the position where every bit
 * reads most clearly. Returns the 6-hex-digit id prefix, or null.
 */
export function readMark(img: { data: Uint8ClampedArray; width: number; height: number }): string | null {
  const { data, width, height } = img;
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
  let best: { bits: number[]; score: number; scale: number } | null = null; // clearest valid reading
  let strongest = 0; // clearest reading of any kind, valid or not
  for (const scale of [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3]) {
    const c = CELL * scale, period = Math.round(TILE * scale);
    if (period * 2 > Math.min(width, height)) continue;
    // fold onto one tile
    const sum = new Float64Array(period * period), cnt = new Float64Array(period * period);
    for (let y = 0; y < height; y++) {
      const ty = (y % period) * period;
      for (let x = 0; x < width; x++) { const k = ty + (x % period); sum[k]! += lum[y * width + x]!; cnt[k]!++; }
    }
    // doubled tile + prefix sums, so any cell at any shift is one lookup
    const P = period * 2, W = P + 1, pre = new Float64Array(W * W);
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      const k = (y % period) * period + (x % period);
      pre[(y + 1) * W + x + 1] = sum[k]! / cnt[k]! + pre[y * W + x + 1]! + pre[(y + 1) * W + x]! - pre[y * W + x]!;
    }
    const m = c >= 4 ? 1 : 0;
    const cell = (x: number, y: number) => {
      const x0 = Math.round(x) + m, y0 = Math.round(y) + m, x1 = Math.round(x + c) - m, y1 = Math.round(y + c) - m;
      return (pre[y1 * W + x1]! - pre[y0 * W + x1]! - pre[y1 * W + x0]! + pre[y0 * W + x0]!) / ((x1 - x0) * (y1 - y0));
    };
    const v = new Float64Array(36);
    for (let oy = 0; oy < period; oy++) for (let ox = 0; ox < period; ox++) {
      // per bit: (top-left + bottom-right) − (top-right + bottom-left); positive = lighter diagonal = 0
      let weakest = Infinity;
      for (let i = 0; i < 36; i++) {
        const x = ox + (i % 6) * 2 * c, y = oy + Math.floor(i / 6) * 2 * c;
        v[i] = cell(x, y) + cell(x + c, y + c) - cell(x + c, y) - cell(x, y + c);
        weakest = Math.min(weakest, Math.abs(v[i]!));
      }
      if (weakest > strongest) strongest = weakest;
      if (best && weakest <= best.score) continue;
      const bits: number[] = Array.from(v, (d) => (d < 0 ? 1 : 0));
      if (bits[0] !== 1 || bits[1] !== 0 || bits[2] !== 1 || bits[3] !== 0) continue;
      // page content can line up with the tile and read as a strong but wrong pattern, so only
      // readings whose check also passes count
      const id = bits.slice(4, 28).reduce((a, b) => (a << 1) | b, 0);
      if (bits.slice(28).reduce((a, b) => (a << 1) | b, 0) !== checkOf(id)) continue;
      best = { bits, score: weakest, scale };
    }
  }
  lastRead = best;
  // a real mark reads about as clearly as the strongest pattern in the picture; a lucky match in noise doesn't
  if (!best || best.score < 2 || best.score < strongest * 0.5) return null;
  return best.bits.slice(4, 28).reduce((a, b) => (a << 1) | b, 0).toString(16).padStart(6, '0');
}
