/** Threshold matrices for ordered dithering: Bayer, clustered-dot, blue noise. */

/** Recursively build a Bayer matrix of size 2^level, values 0..n-1. */
function bayerMatrix(level: number): { size: number; values: Int32Array } {
  let size = 1;
  let values = new Int32Array([0]);
  for (let l = 0; l < level; l++) {
    const next = size * 2;
    const out = new Int32Array(next * next);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = values[y * size + x] * 4;
        out[y * next + x] = v;
        out[y * next + (x + size)] = v + 2;
        out[(y + size) * next + x] = v + 3;
        out[(y + size) * next + (x + size)] = v + 1;
      }
    }
    size = next;
    values = out;
  }
  return { size, values };
}

/** Classic clustered-dot (halftone) screens — dots grow outward from a centre. */
const CLUSTER_4 = new Int32Array([
  12, 5, 6, 13,
  4, 0, 1, 7,
  11, 3, 2, 8,
  15, 10, 9, 14,
]);

const CLUSTER_8 = new Int32Array([
  24, 10, 12, 26, 35, 47, 49, 37,
  8, 0, 2, 14, 45, 59, 61, 51,
  22, 6, 4, 16, 43, 57, 63, 53,
  30, 20, 18, 28, 33, 41, 55, 39,
  34, 46, 48, 36, 25, 11, 13, 27,
  44, 58, 60, 50, 9, 1, 3, 15,
  42, 56, 62, 52, 23, 7, 5, 17,
  32, 40, 54, 38, 31, 21, 19, 29,
]);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Blue-noise threshold matrix via Ulichney's void-and-cluster method.
 * Energy is tracked incrementally so a 64x64 tile builds in a few milliseconds.
 */
function voidAndCluster(size: number, seed = 1337): Int32Array {
  const n = size * size;
  const sigma = 1.9;
  const radius = Math.ceil(sigma * 2.5);
  const taps: { dx: number; dy: number; w: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      if (w > 1e-4) taps.push({ dx, dy, w });
    }
  }

  const binary = new Uint8Array(n);
  const energy = new Float64Array(n);

  const toggle = (index: number, sign: number) => {
    const cx = index % size;
    const cy = (index / size) | 0;
    for (const t of taps) {
      const x = (cx + t.dx + size) % size;
      const y = (cy + t.dy + size) % size;
      energy[y * size + x] += sign * t.w;
    }
  };

  const tightestCluster = () => {
    let best = -1;
    let bestE = -Infinity;
    for (let i = 0; i < n; i++) {
      if (binary[i] === 1 && energy[i] > bestE) {
        bestE = energy[i];
        best = i;
      }
    }
    return best;
  };

  const largestVoid = () => {
    let best = -1;
    let bestE = Infinity;
    for (let i = 0; i < n; i++) {
      if (binary[i] === 0 && energy[i] < bestE) {
        bestE = energy[i];
        best = i;
      }
    }
    return best;
  };

  // Seed with a sparse random set.
  const rand = mulberry32(seed);
  const initialOnes = Math.max(1, Math.round(n * 0.1));
  let placed = 0;
  while (placed < initialOnes) {
    const i = (rand() * n) | 0;
    if (binary[i] === 0) {
      binary[i] = 1;
      toggle(i, 1);
      placed++;
    }
  }

  // Spread the seed pattern out until it is maximally homogeneous.
  for (;;) {
    const cluster = tightestCluster();
    binary[cluster] = 0;
    toggle(cluster, -1);
    const voidPos = largestVoid();
    if (voidPos === cluster) {
      binary[cluster] = 1;
      toggle(cluster, 1);
      break;
    }
    binary[voidPos] = 1;
    toggle(voidPos, 1);
  }

  const prototype = Uint8Array.from(binary);
  const ranks = new Int32Array(n).fill(-1);

  // Phase 1: strip the prototype back to nothing, ranking downwards.
  for (let rank = initialOnes - 1; rank >= 0; rank--) {
    const cluster = tightestCluster();
    binary[cluster] = 0;
    toggle(cluster, -1);
    ranks[cluster] = rank;
  }

  // Phase 2: refill from the prototype, ranking upwards to the last pixel.
  binary.set(prototype);
  energy.fill(0);
  for (let i = 0; i < n; i++) if (binary[i] === 1) toggle(i, 1);
  for (let rank = initialOnes; rank < n; rank++) {
    const voidPos = largestVoid();
    binary[voidPos] = 1;
    toggle(voidPos, 1);
    ranks[voidPos] = rank;
  }

  return ranks;
}

export interface ThresholdMatrix {
  size: number;
  /** Threshold per cell, normalized to (0..1). */
  values: Float32Array;
}

const cache = new Map<string, ThresholdMatrix>();

function normalize(size: number, raw: Int32Array): ThresholdMatrix {
  const n = size * size;
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = (raw[i] + 0.5) / n;
  return { size, values };
}

/** Ordered-dither matrix for a method id, or null if the method is not ordered. */
export function getThresholdMatrix(method: string): ThresholdMatrix | null {
  const hit = cache.get(method);
  if (hit) return hit;

  let built: ThresholdMatrix | null = null;
  switch (method) {
    case 'bayer2': {
      const m = bayerMatrix(1);
      built = normalize(m.size, m.values);
      break;
    }
    case 'bayer4': {
      const m = bayerMatrix(2);
      built = normalize(m.size, m.values);
      break;
    }
    case 'bayer8': {
      const m = bayerMatrix(3);
      built = normalize(m.size, m.values);
      break;
    }
    case 'cluster4':
      built = normalize(4, CLUSTER_4);
      break;
    case 'cluster8':
      built = normalize(8, CLUSTER_8);
      break;
    case 'bluenoise':
      built = normalize(64, voidAndCluster(64));
      break;
    default:
      return null;
  }

  cache.set(method, built);
  return built;
}
