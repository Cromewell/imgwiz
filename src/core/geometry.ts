import { createBitmap, type Bitmap, type GeometryParams, type NormRect } from './types';

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a normalized rect to the unit square with at least one pixel of area. */
export function rectToPixels(rect: NormRect, width: number, height: number): PixelRect {
  const x = Math.min(Math.max(0, Math.round(rect.x * width)), Math.max(0, width - 1));
  const y = Math.min(Math.max(0, Math.round(rect.y * height)), Math.max(0, height - 1));
  const w = Math.max(1, Math.min(width - x, Math.round(rect.w * width)));
  const h = Math.max(1, Math.min(height - y, Math.round(rect.h * height)));
  return { x, y, w, h };
}

/** Output size after crop plus rotation, without doing the work. */
export function geometrySize(src: { width: number; height: number }, p: GeometryParams): { width: number; height: number } {
  const r = rectToPixels(p.crop, src.width, src.height);
  return p.rotate === 90 || p.rotate === 270 ? { width: r.h, height: r.w } : { width: r.w, height: r.h };
}

export function isGeometryNeutral(p: GeometryParams): boolean {
  return (
    p.rotate === 0 &&
    !p.flipH &&
    !p.flipV &&
    p.crop.x === 0 &&
    p.crop.y === 0 &&
    p.crop.w === 1 &&
    p.crop.h === 1
  );
}

/**
 * Crop, flip and rotate in a single gather pass: for each destination pixel we
 * invert the transform chain to find its source, so nothing is copied twice.
 */
export function applyGeometry(src: Bitmap, p: GeometryParams): Bitmap {
  const r = rectToPixels(p.crop, src.width, src.height);
  const swap = p.rotate === 90 || p.rotate === 270;
  const ow = swap ? r.h : r.w;
  const oh = swap ? r.w : r.h;

  const out = createBitmap(ow, oh);
  const s = src.data;
  const d = out.data;
  const sw = src.width;

  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      // Undo the rotation to land in cropped coordinates.
      let cx: number;
      let cy: number;
      switch (p.rotate) {
        case 90:
          cx = oy;
          cy = r.h - 1 - ox;
          break;
        case 180:
          cx = r.w - 1 - ox;
          cy = r.h - 1 - oy;
          break;
        case 270:
          cx = r.w - 1 - oy;
          cy = ox;
          break;
        default:
          cx = ox;
          cy = oy;
      }
      // Undo the mirrors, then shift into the source image.
      if (p.flipH) cx = r.w - 1 - cx;
      if (p.flipV) cy = r.h - 1 - cy;

      const si = ((r.y + cy) * sw + (r.x + cx)) * 4;
      const di = (oy * ow + ox) * 4;
      d[di] = s[si];
      d[di + 1] = s[si + 1];
      d[di + 2] = s[si + 2];
      d[di + 3] = s[si + 3];
    }
  }

  return out;
}

/** Largest rect of a given aspect ratio that fits inside the unit square. */
export function fitAspect(aspect: number, current: NormRect, imageAspect: number): NormRect {
  // Work in pixel-proportional space so the ratio means what the user expects.
  const targetW = Math.min(1, aspect / imageAspect);
  const targetH = Math.min(1, imageAspect / aspect);
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  const x = Math.min(Math.max(0, cx - targetW / 2), 1 - targetW);
  const y = Math.min(Math.max(0, cy - targetH / 2), 1 - targetH);
  return { x, y, w: targetW, h: targetH };
}
