import { applyAdjust } from './adjust';
import { applyDither } from './dither';
import { applyGeometry, geometrySize, isGeometryNeutral } from './geometry';
import { resample } from './resample';
import { cloneBitmap, type Bitmap, type Op } from './types';

export interface RunOptions {
  /**
   * Scale of the incoming bitmap relative to the full-resolution original.
   * Absolute pixel parameters (resize targets, dither pixel size) are scaled by
   * this so a preview looks like a smaller copy of the export, not a different
   * image.
   */
  scale: number;
}

/** Final pixel dimensions a set of ops would produce at full resolution. */
export function pipelineSize(src: { width: number; height: number }, ops: Op[]): { width: number; height: number } {
  let size = { width: src.width, height: src.height };
  for (const op of ops) {
    if (op.type === 'geometry') size = geometrySize(size, op.params);
    else if (op.type === 'resize') {
      size = { width: Math.max(1, Math.round(op.params.width)), height: Math.max(1, Math.round(op.params.height)) };
    }
  }
  return size;
}

/** Run the op list in order. The input bitmap is never mutated. */
export function runPipeline(src: Bitmap, ops: Op[], opts: RunOptions = { scale: 1 }): Bitmap {
  let current: Bitmap | null = null;

  for (const op of ops) {
    switch (op.type) {
      case 'geometry': {
        if (isGeometryNeutral(op.params)) break;
        current = applyGeometry(current ?? src, op.params);
        break;
      }
      case 'resize': {
        const input = current ?? src;
        const w = Math.max(1, Math.round(op.params.width * opts.scale));
        const h = Math.max(1, Math.round(op.params.height * opts.scale));
        if (w === input.width && h === input.height) break;
        current = resample(input, w, h, op.params.kernel);
        break;
      }
      case 'adjust': {
        current = current ?? cloneBitmap(src);
        applyAdjust(current, op.params);
        break;
      }
      case 'dither': {
        const input = current ?? src;
        const pixelSize = Math.max(1, Math.round(op.params.pixelSize * opts.scale));
        current = applyDither(input, { ...op.params, pixelSize });
        break;
      }
    }
  }

  return current ?? cloneBitmap(src);
}
