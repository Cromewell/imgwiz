/// <reference lib="webworker" />
import { runPipeline } from '../core/pipeline';
import { resample } from '../core/resample';
import { cloneBitmap, type Bitmap } from '../core/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * The worker owns the full-resolution pixels for the whole session: the main
 * thread hands them over once, then only ever exchanges small previews. That
 * keeps the UI thread free and avoids a second copy of a large image.
 */
let full: Bitmap | null = null;
let preview: Bitmap | null = null;
let previewScale = 1;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

/** Downscale the source once to a size that can be re-processed interactively. */
function buildPreview(src: Bitmap, budget: number): { bitmap: Bitmap; scale: number } {
  const longest = Math.max(src.width, src.height);
  if (longest <= budget) return { bitmap: cloneBitmap(src), scale: 1 };
  const scale = budget / longest;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  return { bitmap: resample(src, w, h, 'mitchell'), scale: w / src.width };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.kind) {
      case 'load': {
        full = msg.bitmap;
        const built = buildPreview(full, msg.previewBudget);
        preview = built.bitmap;
        previewScale = built.scale;
        // Send a copy out; the worker keeps its own preview for processing.
        const copy = cloneBitmap(preview);
        post(
          {
            id: msg.id,
            ok: true,
            kind: 'load',
            preview: copy,
            previewScale,
            width: full.width,
            height: full.height,
          },
          [copy.data.buffer],
        );
        break;
      }
      case 'process': {
        const source = msg.quality === 'full' ? full : preview;
        if (!source) throw new Error('No image loaded.');
        const scale = msg.quality === 'full' ? 1 : previewScale;
        const result = runPipeline(source, msg.ops, { scale });
        post({ id: msg.id, ok: true, kind: 'process', bitmap: result }, [result.data.buffer]);
        break;
      }
      case 'dispose': {
        full = null;
        preview = null;
        previewScale = 1;
        post({ id: msg.id, ok: true, kind: 'dispose' });
        break;
      }
    }
  } catch (error) {
    post({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
