/**
 * Core data model. Everything here is plain, structured-cloneable data so the
 * same code can run on the main thread or inside a Web Worker.
 */

/** A raw RGBA8 bitmap. Shape-compatible with ImageData but DOM-free. */
export interface Bitmap {
  width: number;
  height: number;
  /**
   * RGBA, 4 bytes per pixel, non-premultiplied, sRGB. Pinned to ArrayBuffer
   * (not ArrayBufferLike) so it is accepted by ImageData and by postMessage
   * transfer lists without a cast.
   */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneBitmap(src: Bitmap): Bitmap {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

/** Normalized rectangle (0..1 of the source), so crops survive any resolution. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_RECT: NormRect = { x: 0, y: 0, w: 1, h: 1 };

export type Rotation = 0 | 90 | 180 | 270;

export interface GeometryParams {
  crop: NormRect;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
}

export const defaultGeometry = (): GeometryParams => ({
  crop: { ...FULL_RECT },
  rotate: 0,
  flipH: false,
  flipV: false,
});

/** Tonal and color adjustments. Neutral values are all "do nothing". */
export interface AdjustParams {
  /** Exposure in stops, applied in linear light. -4..4 */
  exposure: number;
  /** Additive lift in output space. -100..100 */
  brightness: number;
  /** Tone slope around mid grey. -100..100 */
  contrast: number;
  /** Mid-tone gamma. 0.1..4, 1 = neutral */
  gamma: number;
  /** Black point, 0..90 (percent of range) */
  blacks: number;
  /** White point, 10..100 (percent of range) */
  whites: number;
  /** Chroma scale. -100..100, -100 = fully desaturated */
  saturation: number;
  /** Convert to monochrome using the channel mixer below. */
  grayscale: boolean;
  /** Channel weights for the monochrome mix; normalized at apply time. */
  mix: [number, number, number];
  invert: boolean;
}

export const defaultAdjust = (): AdjustParams => ({
  exposure: 0,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  blacks: 0,
  whites: 100,
  saturation: 0,
  grayscale: false,
  mix: [0.2126, 0.7152, 0.0722],
  invert: false,
});

export type DitherMethod =
  | 'none'
  | 'random'
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'cluster4'
  | 'cluster8'
  | 'bluenoise'
  | 'floyd-steinberg'
  | 'false-floyd-steinberg'
  | 'jarvis'
  | 'stucki'
  | 'atkinson'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra-lite';

export interface DitherParams {
  method: DitherMethod;
  /** Palette id from core/palettes, or 'mono' / 'gray' / 'rgb' for generated ones. */
  palette: string;
  /** Quantization steps per channel for the generated 'gray' and 'rgb' palettes. */
  levels: number;
  /** Diffusion / ordered-noise amplitude in percent. 0..100 */
  strength: number;
  /** Alternate scan direction per row — kills directional worming. */
  serpentine: boolean;
  /** Downsample factor before dithering, for chunky retro pixels. 1..16 */
  pixelSize: number;
  /** Threshold bias in percent. -50..50 */
  threshold: number;
  invert: boolean;
}

export const defaultDither = (): DitherParams => ({
  method: 'floyd-steinberg',
  palette: 'mono',
  levels: 2,
  strength: 100,
  serpentine: true,
  pixelSize: 1,
  threshold: 0,
  invert: false,
});

export type ResampleKernel = 'lanczos3' | 'mitchell' | 'bilinear' | 'box' | 'nearest';

export interface ResizeParams {
  width: number;
  height: number;
  kernel: ResampleKernel;
}

export type Op =
  | { type: 'geometry'; params: GeometryParams }
  | { type: 'resize'; params: ResizeParams }
  | { type: 'adjust'; params: AdjustParams }
  | { type: 'dither'; params: DitherParams };

export type ExportFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif';

export interface ExportParams {
  format: ExportFormat;
  /** 1..100, ignored by PNG. */
  quality: number;
  /** Flattening color for formats without alpha. */
  background: string;
}

export const defaultExport = (): ExportParams => ({
  format: 'image/png',
  quality: 90,
  background: '#ffffff',
});
