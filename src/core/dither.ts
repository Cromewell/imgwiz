import { getThresholdMatrix } from './noise';
import { isGrayPalette, resolvePalette } from './palettes';
import { createBitmap, type Bitmap, type DitherParams } from './types';

interface Tap {
  dx: number;
  dy: number;
  w: number;
}

/** Error-diffusion kernels, weights pre-divided by their denominator. */
const KERNELS: Record<string, Tap[]> = {
  'floyd-steinberg': taps([[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]], 16),
  'false-floyd-steinberg': taps([[1, 0, 3], [0, 1, 3], [1, 1, 2]], 8),
  jarvis: taps(
    [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
     [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]], 48),
  stucki: taps(
    [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
     [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]], 42),
  atkinson: taps([[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]], 8),
  burkes: taps([[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]], 32),
  sierra3: taps(
    [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
     [-1, 2, 2], [0, 2, 3], [1, 2, 2]], 32),
  sierra2: taps([[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]], 16),
  'sierra-lite': taps([[1, 0, 2], [0, 1, 1], [1, 1, 1]], 4),
};

function taps(rows: number[][], div: number): Tap[] {
  return rows.map(([dx, dy, w]) => ({ dx, dy, w: w / div }));
}

/** How a palette can be searched: analytically, or by brute force. */
type Quantizer =
  | { kind: 'gray-ramp'; levels: number }
  | { kind: 'rgb-cube'; levels: number }
  | { kind: 'list'; colors: Uint8Array; gray: boolean };

function pickQuantizer(p: DitherParams): Quantizer {
  if (p.palette === 'mono') return { kind: 'gray-ramp', levels: 2 };
  if (p.palette === 'gray') return { kind: 'gray-ramp', levels: Math.max(2, Math.min(256, p.levels)) };
  if (p.palette === 'rgb') return { kind: 'rgb-cube', levels: Math.max(2, Math.min(8, p.levels)) };
  const colors = resolvePalette(p.palette, p.levels);
  return { kind: 'list', colors, gray: isGrayPalette(colors) };
}

function quantizeLevel(v: number, levels: number): number {
  const step = 255 / (levels - 1);
  const idx = Math.round(v / step);
  return Math.round(Math.min(levels - 1, Math.max(0, idx)) * step);
}

function nearestInList(colors: Uint8Array, r: number, g: number, b: number, out: number[]): void {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < colors.length; i += 3) {
    const dr = r - colors[i];
    const dg = g - colors[i + 1];
    const db = b - colors[i + 2];
    // Weighted to roughly track perceived difference without a full Lab round-trip.
    const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  out[0] = colors[best];
  out[1] = colors[best + 1];
  out[2] = colors[best + 2];
}

/** Box-average downsample by an integer factor, for chunky-pixel output. */
function downsample(src: Bitmap, factor: number): Bitmap {
  const w = Math.max(1, Math.floor(src.width / factor));
  const h = Math.max(1, Math.floor(src.height / factor));
  const out = createBitmap(w, h);
  const s = src.data;
  const d = out.data;
  for (let y = 0; y < h; y++) {
    const y0 = y * factor;
    const y1 = Math.min(src.height, y0 + factor);
    for (let x = 0; x < w; x++) {
      const x0 = x * factor;
      const x1 = Math.min(src.width, x0 + factor);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += s[i];
          g += s[i + 1];
          b += s[i + 2];
          a += s[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      d[o] = r / n;
      d[o + 1] = g / n;
      d[o + 2] = b / n;
      d[o + 3] = a / n;
    }
  }
  return out;
}

/** Nearest-neighbour upscale back to a target size, keeping hard pixel edges. */
function upsampleNearest(src: Bitmap, width: number, height: number): Bitmap {
  const out = createBitmap(width, height);
  const s = src.data;
  const d = out.data;
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const ry = Math.min(src.height - 1, (y * sy) | 0);
    for (let x = 0; x < width; x++) {
      const rx = Math.min(src.width - 1, (x * sx) | 0);
      const si = (ry * src.width + rx) * 4;
      const di = (y * width + x) * 4;
      d[di] = s[si];
      d[di + 1] = s[si + 1];
      d[di + 2] = s[si + 2];
      d[di + 3] = s[si + 3];
    }
  }
  return out;
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Quantize to a palette, optionally shaping the error so the eye averages the
 * result back to the original tone. Returns a new bitmap of the same size.
 */
export function applyDither(src: Bitmap, p: DitherParams): Bitmap {
  const factor = Math.max(1, Math.min(32, Math.round(p.pixelSize)));
  const work = factor > 1 ? downsample(src, factor) : src;
  const quant = pickQuantizer(p);
  const kernel = KERNELS[p.method];
  const matrix = getThresholdMatrix(p.method);
  const bias = (p.threshold / 100) * 255;
  const strength = Math.max(0, Math.min(100, p.strength)) / 100;

  const w = work.width;
  const h = work.height;
  const out = createBitmap(w, h);
  const srcData = work.data;
  const outData = out.data;

  const scalar = quant.kind === 'gray-ramp' || (quant.kind === 'list' && quant.gray);
  const channels = scalar ? 1 : 3;
  const buf = new Float32Array(w * h * channels);

  // Seed the working buffer, folding in inversion and the threshold bias.
  for (let i = 0, pi = 0; i < srcData.length; i += 4, pi += channels) {
    let r = srcData[i];
    let g = srcData[i + 1];
    let b = srcData[i + 2];
    if (p.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    if (scalar) {
      buf[pi] = luma(r, g, b) + bias;
    } else {
      buf[pi] = r + bias;
      buf[pi + 1] = g + bias;
      buf[pi + 2] = b + bias;
    }
    outData[i + 3] = srcData[i + 3];
  }

  const rgbOut = [0, 0, 0];
  const errRGB = new Float32Array(3);

  const emit = (px: number, py: number, vals: Float32Array, offset: number) => {
    const di = (py * w + px) * 4;
    if (scalar) {
      const v = vals[offset];
      let q: number;
      if (quant.kind === 'gray-ramp') {
        q = quantizeLevel(v, quant.levels);
        outData[di] = q;
        outData[di + 1] = q;
        outData[di + 2] = q;
      } else {
        nearestInList((quant as { colors: Uint8Array }).colors, v, v, v, rgbOut);
        q = rgbOut[0];
        outData[di] = rgbOut[0];
        outData[di + 1] = rgbOut[1];
        outData[di + 2] = rgbOut[2];
      }
      return v - q;
    }
    const r = vals[offset];
    const g = vals[offset + 1];
    const b = vals[offset + 2];
    if (quant.kind === 'rgb-cube') {
      rgbOut[0] = quantizeLevel(r, quant.levels);
      rgbOut[1] = quantizeLevel(g, quant.levels);
      rgbOut[2] = quantizeLevel(b, quant.levels);
    } else {
      nearestInList((quant as { colors: Uint8Array }).colors, r, g, b, rgbOut);
    }
    outData[di] = rgbOut[0];
    outData[di + 1] = rgbOut[1];
    outData[di + 2] = rgbOut[2];
    errRGB[0] = r - rgbOut[0];
    errRGB[1] = g - rgbOut[1];
    errRGB[2] = b - rgbOut[2];
    return 0;
  };

  if (kernel) {
    // Error diffusion: push the quantization residual onto unvisited neighbours.
    for (let y = 0; y < h; y++) {
      const reverse = p.serpentine && (y & 1) === 1;
      for (let step = 0; step < w; step++) {
        const x = reverse ? w - 1 - step : step;
        const offset = (y * w + x) * channels;
        const scalarErr = emit(x, y, buf, offset);
        if (strength === 0) continue;
        for (const t of kernel) {
          const nx = x + (reverse ? -t.dx : t.dx);
          const ny = y + t.dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = (ny * w + nx) * channels;
          const weight = t.w * strength;
          if (scalar) {
            buf[ni] += scalarErr * weight;
          } else {
            buf[ni] += errRGB[0] * weight;
            buf[ni + 1] += errRGB[1] * weight;
            buf[ni + 2] += errRGB[2] * weight;
          }
        }
      }
    }
  } else {
    // Point methods: ordered matrix, white noise, or a plain hard threshold.
    const amp = quant.kind === 'gray-ramp' || quant.kind === 'rgb-cube'
      ? (255 / (quant.levels - 1)) * strength
      : 255 * strength * 0.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const offset = (y * w + x) * channels;
        let noise = 0;
        if (matrix) {
          noise = (matrix.values[(y % matrix.size) * matrix.size + (x % matrix.size)] - 0.5) * amp;
        } else if (p.method === 'random') {
          noise = (Math.random() - 0.5) * amp;
        }
        if (noise !== 0) {
          buf[offset] += noise;
          if (!scalar) {
            buf[offset + 1] += noise;
            buf[offset + 2] += noise;
          }
        }
        emit(x, y, buf, offset);
      }
    }
  }

  return factor > 1 ? upsampleNearest(out, src.width, src.height) : out;
}

export const DITHER_METHODS: { value: string; label: string; group: string }[] = [
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg', group: 'Error diffusion' },
  { value: 'false-floyd-steinberg', label: 'Floyd–Steinberg (light)', group: 'Error diffusion' },
  { value: 'atkinson', label: 'Atkinson', group: 'Error diffusion' },
  { value: 'jarvis', label: 'Jarvis–Judice–Ninke', group: 'Error diffusion' },
  { value: 'stucki', label: 'Stucki', group: 'Error diffusion' },
  { value: 'burkes', label: 'Burkes', group: 'Error diffusion' },
  { value: 'sierra3', label: 'Sierra (3 row)', group: 'Error diffusion' },
  { value: 'sierra2', label: 'Sierra (2 row)', group: 'Error diffusion' },
  { value: 'sierra-lite', label: 'Sierra Lite', group: 'Error diffusion' },
  { value: 'bayer2', label: 'Bayer 2x2', group: 'Ordered' },
  { value: 'bayer4', label: 'Bayer 4x4', group: 'Ordered' },
  { value: 'bayer8', label: 'Bayer 8x8', group: 'Ordered' },
  { value: 'cluster4', label: 'Halftone 4x4', group: 'Ordered' },
  { value: 'cluster8', label: 'Halftone 8x8', group: 'Ordered' },
  { value: 'bluenoise', label: 'Blue noise 64x64', group: 'Ordered' },
  { value: 'random', label: 'White noise', group: 'Point' },
  { value: 'none', label: 'Hard threshold', group: 'Point' },
];
