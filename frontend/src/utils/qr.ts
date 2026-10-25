// A small, dependency-free QR code generator.
//
// Scope (on purpose): byte mode, error-correction level M, versions 1-6.
// That holds up to 106 characters — plenty for a Case ID such as
// "CASE-2026-000047". Longer text throws an error instead of making a
// broken code.

// ---- Tables (error-correction level M) ----
// Index 0 = version 1 ... index 5 = version 6.
const DATA_CODEWORDS = [16, 28, 44, 64, 86, 108];
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16];
const BLOCKS = [1, 1, 1, 2, 2, 4];
const ALIGNMENT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

// ---- Math over GF(256), used for the error-correction codewords ----
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], ecLen: number): number[] {
  const gen = generatorPoly(ecLen);
  const result = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < ecLen; i++) result[i] ^= gfMul(gen[i + 1], factor);
  }
  return result;
}

// ---- Building the code ----
function toBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function buildCodewords(bytes: number[], version: number): number[] {
  const v = version - 1;
  const capacityBits = DATA_CODEWORDS[v] * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // length (8 bits for versions 1-9)
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  for (let pad = 0xec; data.length < DATA_CODEWORDS[v]; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);

  // Split into blocks, add error correction, then interleave.
  const blocks = BLOCKS[v];
  const perBlock = DATA_CODEWORDS[v] / blocks;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < blocks; b++) {
    const chunk = data.slice(b * perBlock, (b + 1) * perBlock);
    dataBlocks.push(chunk);
    ecBlocks.push(reedSolomon(chunk, EC_PER_BLOCK[v]));
  }
  const out: number[] = [];
  for (let i = 0; i < perBlock; i++) for (const blk of dataBlocks) out.push(blk[i]);
  for (let i = 0; i < EC_PER_BLOCK[v]; i++) for (const blk of ecBlocks) out.push(blk[i]);
  return out;
}

type Grid = (boolean | null)[][]; // null = not yet filled

function newGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFinder(grid: Grid, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= grid.length || cc >= grid.length) continue;
      const onRing = r === 0 || r === 6 || c === 0 || c === 6;
      const inCentre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      grid[rr][cc] = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (onRing || inCentre);
    }
  }
}

function placeAlignment(grid: Grid, version: number) {
  const centres = ALIGNMENT[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      if (grid[r][c] !== null) continue; // would overlap a finder pattern
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          grid[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        }
      }
    }
  }
}

function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  // Rule 1: runs of 5+ same-colour modules in a row or column.
  for (let i = 0; i < n; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const cur = horizontal ? m[i][j] : m[j][i];
        const prev = horizontal ? m[i][j - 1] : m[j - 1][i];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++)
      if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  // Rule 3: finder-like 1:1:3:1:1 patterns.
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= n - 11; j++) {
      for (const horizontal of [true, false]) {
        const get = (k: number) => (horizontal ? m[i][j + k] : m[j + k][i]);
        let a = true;
        let b = true;
        for (let k = 0; k < 11; k++) {
          if (get(k) !== pat1[k]) a = false;
          if (get(k) !== pat2[k]) b = false;
        }
        if (a || b) score += 40;
      }
    }
  }
  // Rule 4: balance of dark and light modules.
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

// Returns a square grid of booleans: true = dark module.
export function makeQr(text: string): boolean[][] {
  const bytes = toBytes(text);
  const version = [14, 26, 42, 62, 84, 106].findIndex((max) => bytes.length <= max) + 1;
  if (version === 0) throw new Error("Text is too long for this QR generator.");

  const size = 17 + 4 * version;
  const grid = newGrid(size);
  placeFinder(grid, 0, 0);
  placeFinder(grid, 0, size - 7);
  placeFinder(grid, size - 7, 0);
  placeAlignment(grid, version);
  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }
  // Reserve the format-information areas and the always-dark module.
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  grid[size - 8][8] = true;
  reserved[size - 8][8] = true;

  const isFunction = (r: number, c: number) => grid[r][c] !== null || reserved[r][c];

  // Place data bits in the zig-zag order the standard defines.
  const codewords = buildCodewords(bytes, version);
  const bits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  const remainder = version === 1 ? 0 : 7;
  for (let i = 0; i < remainder; i++) bits.push(0);

  const dataMask: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const matrix: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (isFunction(row, c)) continue;
        matrix[row][c] = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        dataMask[row][c] = true;
        bitIndex++;
      }
    }
    upward = !upward;
  }

  // Try all 8 masks and keep the one with the lowest penalty.
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate: boolean[][] = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => {
        if (dataMask[r][c]) return matrix[r][c] !== maskFn(mask, r, c);
        return grid[r][c] === true;
      })
    );
    const fmt = formatBits(mask);
    const bit = (i: number) => ((fmt >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) candidate[i][8] = bit(i);
    candidate[7][8] = bit(6);
    candidate[8][8] = bit(7);
    candidate[8][7] = bit(8);
    for (let i = 9; i < 15; i++) candidate[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) candidate[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) candidate[size - 15 + i][8] = bit(i);
    candidate[size - 8][8] = true;
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best as boolean[][];
}
