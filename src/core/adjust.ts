import type { AdjustParams, Bitmap } from './types';

/** sRGB transfer function, forward and inverse. */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Collapse every per-channel tonal operation into one 256-entry lookup table.
 * Exposure happens in linear light, the rest in display space — which is how
 * darkroom-style controls are expected to behave.
 */
export function buildToneLut(p: AdjustParams): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const black = Math.min(p.blacks, p.whites - 1) / 100;
  const white = Math.max(p.whites, p.blacks + 1) / 100;
  const span = white - black || 1e-6;
  const expGain = Math.pow(2, p.exposure);
  const slope = p.contrast >= 0 ? 1 + p.contrast / 50 : 1 + p.contrast / 100;
  const lift = p.brightness / 100;
  const invGamma = 1 / Math.max(0.01, p.gamma);

  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v = (v - black) / span;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (expGain !== 1) v = linearToSrgb(srgbToLinear(v) * expGain);
    if (slope !== 1) v = (v - 0.5) * slope + 0.5;
    if (lift !== 0) v += lift;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (invGamma !== 1) v = Math.pow(v, invGamma);
    if (p.invert) v = 1 - v;
    lut[i] = Math.round(v * 255);
  }
  return lut;
}

export function isAdjustNeutral(p: AdjustParams): boolean {
  return (
    p.exposure === 0 &&
    p.brightness === 0 &&
    p.contrast === 0 &&
    p.gamma === 1 &&
    p.blacks === 0 &&
    p.whites === 100 &&
    p.saturation === 0 &&
    !p.grayscale &&
    !p.invert
  );
}

/** Apply tone, saturation and monochrome conversion in place. */
export function applyAdjust(bmp: Bitmap, p: AdjustParams): void {
  if (isAdjustNeutral(p)) return;

  const lut = buildToneLut(p);
  const data = bmp.data;
  const len = data.length;

  if (p.grayscale) {
    // Mix channels in linear light so the result matches real B&W filters.
    let [wr, wg, wb] = p.mix;
    const sum = wr + wg + wb;
    if (Math.abs(sum) < 1e-6) {
      wr = 0.2126;
      wg = 0.7152;
      wb = 0.0722;
    } else {
      wr /= sum;
      wg /= sum;
      wb /= sum;
    }
    for (let i = 0; i < len; i += 4) {
      const lin = SRGB_TO_LINEAR[data[i]] * wr + SRGB_TO_LINEAR[data[i + 1]] * wg + SRGB_TO_LINEAR[data[i + 2]] * wb;
      const g = lut[Math.round(linearToSrgb(lin < 0 ? 0 : lin) * 255)];
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
    }
    return;
  }

  if (p.saturation !== 0) {
    const sat = 1 + p.saturation / 100;
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      data[i] = lut[clamp255(luma + (r - luma) * sat)];
      data[i + 1] = lut[clamp255(luma + (g - luma) * sat)];
      data[i + 2] = lut[clamp255(luma + (b - luma) * sat)];
    }
    return;
  }

  for (let i = 0; i < len; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Classic B&W contrast filters, expressed as channel-mixer weights. */
export const BW_FILTERS: { id: string; label: string; mix: [number, number, number]; hint: string }[] = [
  { id: 'neutral', label: 'Neutral (Rec. 709)', mix: [0.2126, 0.7152, 0.0722], hint: 'Matches perceived brightness' },
  { id: 'flat', label: 'Flat (equal weights)', mix: [1 / 3, 1 / 3, 1 / 3], hint: 'Classic average, lighter reds' },
  { id: 'red', label: 'Red filter', mix: [0.8, 0.15, 0.05], hint: 'Dark skies, dramatic clouds' },
  { id: 'orange', label: 'Orange filter', mix: [0.6, 0.35, 0.05], hint: 'Portrait skin, softer than red' },
  { id: 'yellow', label: 'Yellow filter', mix: [0.45, 0.45, 0.1], hint: 'Gentle sky separation' },
  { id: 'green', label: 'Green filter', mix: [0.1, 0.75, 0.15], hint: 'Foliage, landscapes' },
  { id: 'blue', label: 'Blue filter', mix: [0.05, 0.25, 0.7], hint: 'Haze, cold high-key look' },
];

/** Histogram over luma, 256 buckets — used by the exposure tool's readout. */
export function lumaHistogram(bmp: Bitmap): Uint32Array {
  const hist = new Uint32Array(256);
  const data = bmp.data;
  for (let i = 0; i < data.length; i += 4) {
    hist[(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) | 0]++;
  }
  return hist;
}
