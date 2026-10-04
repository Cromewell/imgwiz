import { createBitmap, cloneBitmap, type Bitmap, type ResampleKernel } from './types';

interface Filter {
  support: number;
  fn: (x: number) => number;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

const FILTERS: Record<ResampleKernel, Filter> = {
  nearest: { support: 0.5, fn: (x) => (Math.abs(x) <= 0.5 ? 1 : 0) },
  box: { support: 0.5, fn: (x) => (Math.abs(x) <= 0.5 ? 1 : 0) },
  bilinear: { support: 1, fn: (x) => Math.max(0, 1 - Math.abs(x)) },
  mitchell: {
    support: 2,
    fn: (x) => {
      const B = 1 / 3;
      const C = 1 / 3;
      const ax = Math.abs(x);
      const x2 = ax * ax;
      if (ax < 1) {
        return ((12 - 9 * B - 6 * C) * x2 * ax + (-18 + 12 * B + 6 * C) * x2 + (6 - 2 * B)) / 6;
      }
      if (ax < 2) {
        return ((-B - 6 * C) * x2 * ax + (6 * B + 30 * C) * x2 + (-12 * B - 48 * C) * ax + (8 * B + 24 * C)) / 6;
      }
      return 0;
    },
  },
  lanczos3: { support: 3, fn: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
};

interface WeightTable {
  starts: Int32Array;
  counts: Int32Array;
  weights: Float32Array;
  stride: number;
}

/**
 * Per-output-pixel filter weights for one axis. When downscaling, the kernel is
 * stretched to the destination pixel footprint — that is what prevents aliasing.
 */
function buildWeights(srcSize: number, dstSize: number, filter: Filter): WeightTable {
  const scale = dstSize / srcSize;
  const filterScale = scale < 1 ? 1 / scale : 1;
  const support = filter.support * filterScale;
  const stride = Math.max(1, Math.ceil(support * 2) + 2);

  const starts = new Int32Array(dstSize);
  const counts = new Int32Array(dstSize);
  const weights = new Float32Array(dstSize * stride);

  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) / scale;
    let left = Math.ceil(center - support - 0.5);
    let right = Math.floor(center + support - 0.5);
    if (left < 0) left = 0;
    if (right > srcSize - 1) right = srcSize - 1;
    if (right < left) {
      left = Math.min(srcSize - 1, Math.max(0, Math.round(center - 0.5)));
      right = left;
    }

    const base = i * stride;
    let sum = 0;
    let count = 0;
    for (let j = left; j <= right && count < stride; j++, count++) {
      const w = filter.fn((j + 0.5 - center) / filterScale);
      weights[base + count] = w;
      sum += w;
    }
    if (sum === 0) {
      weights[base] = 1;
      count = 1;
      sum = 1;
    }
    for (let k = 0; k < count; k++) weights[base + k] /= sum;
    starts[i] = left;
    counts[i] = count;
  }

  return { starts, counts, weights, stride };
}

/**
 * High-quality separable resample. Alpha is premultiplied for the duration so
 * transparent edges do not bleed their colour into neighbours.
 */
export function resample(src: Bitmap, dstWidth: number, dstHeight: number, kernel: ResampleKernel): Bitmap {
  const dw = Math.max(1, Math.round(dstWidth));
  const dh = Math.max(1, Math.round(dstHeight));
  if (dw === src.width && dh === src.height) return cloneBitmap(src);

  const filter = FILTERS[kernel] ?? FILTERS.lanczos3;
  const sw = src.width;
  const sh = src.height;

  // Horizontal pass into a float buffer of size dw x sh, premultiplied.
  const hx = buildWeights(sw, dw, filter);
  const tmp = new Float32Array(dw * sh * 4);
  const s = src.data;
  for (let y = 0; y < sh; y++) {
    const rowIn = y * sw * 4;
    const rowOut = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const base = x * hx.stride;
      const start = hx.starts[x];
      const count = hx.counts[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < count; k++) {
        const w = hx.weights[base + k];
        const i = rowIn + (start + k) * 4;
        const alpha = s[i + 3] / 255;
        r += s[i] * alpha * w;
        g += s[i + 1] * alpha * w;
        b += s[i + 2] * alpha * w;
        a += s[i + 3] * w;
      }
      const o = rowOut + x * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = a;
    }
  }

  // Vertical pass, unpremultiplying on the way out.
  const vy = buildWeights(sh, dh, filter);
  const out = createBitmap(dw, dh);
  const d = out.data;
  for (let y = 0; y < dh; y++) {
    const base = y * vy.stride;
    const start = vy.starts[y];
    const count = vy.counts[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < count; k++) {
        const w = vy.weights[base + k];
        const i = ((start + k) * dw + x) * 4;
        r += tmp[i] * w;
        g += tmp[i + 1] * w;
        b += tmp[i + 2] * w;
        a += tmp[i + 3] * w;
      }
      const o = (y * dw + x) * 4;
      const alpha = a / 255;
      if (alpha > 0.0001) {
        d[o] = r / alpha;
        d[o + 1] = g / alpha;
        d[o + 2] = b / alpha;
      } else {
        d[o] = 0;
        d[o + 1] = 0;
        d[o + 2] = 0;
      }
      d[o + 3] = a;
    }
  }

  return out;
}

export const KERNEL_OPTIONS: { value: ResampleKernel; label: string; hint: string }[] = [
  { value: 'lanczos3', label: 'Lanczos 3', hint: 'Sharpest; best for photos' },
  { value: 'mitchell', label: 'Mitchell', hint: 'Smooth, low ringing' },
  { value: 'bilinear', label: 'Bilinear', hint: 'Soft, fast' },
  { value: 'box', label: 'Box / average', hint: 'Clean integer downscales' },
  { value: 'nearest', label: 'Nearest', hint: 'Pixel art, no blending' },
];
