import type { Bitmap, Op } from '../core/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** Omit that distributes over a union, so each request variant keeps its shape. */
type RequestBody = WorkerRequest extends infer T ? (T extends WorkerRequest ? Omit<T, 'id'> : never) : never;

interface Pending {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
}

/** Promise-shaped wrapper around the processing worker. */
export class ImageProcessor {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data);
      else entry.reject(new Error(event.data.error));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Image worker crashed.');
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  private send(request: RequestBody, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = ++this.seq;
    const message = { ...request, id } as WorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }

  /** Hand the full-resolution pixels to the worker. The buffer is transferred. */
  async load(bitmap: Bitmap, previewBudget: number): Promise<{ preview: Bitmap; previewScale: number }> {
    const res = await this.send({ kind: 'load', bitmap, previewBudget }, [bitmap.data.buffer]);
    if (!res.ok || res.kind !== 'load') throw new Error('Unexpected worker reply.');
    return { preview: res.preview, previewScale: res.previewScale };
  }

  async process(ops: Op[], quality: 'preview' | 'full'): Promise<Bitmap> {
    const res = await this.send({ kind: 'process', ops, quality });
    if (!res.ok || res.kind !== 'process') throw new Error('Unexpected worker reply.');
    return res.bitmap;
  }

  async dispose(): Promise<void> {
    await this.send({ kind: 'dispose' });
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
